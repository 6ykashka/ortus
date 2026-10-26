package cash

import (
	"errors"
	"testing"
	"time"

	cashapi "github.com/ortus/ortus-crm/backend/internal/api/cash"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

func wantProblem(t *testing.T, err error, code string) {
	t.Helper()
	pe, ok := errors.AsType[*problem.Error](err)
	if !ok || pe.Code != code {
		t.Fatalf("error %v, want code %s", err, code)
	}
}

func rub(minor int) cashapi.Money { return cashapi.Money{AmountMinor: minor, Currency: "RUB"} }

// TestCheckAmount: сумма — целые копейки больше нуля, рубли, не больше предела (sum() эталона: «укажите число больше
// нуля»).
func TestCheckAmount(t *testing.T) {
	t.Parallel()
	if v, err := checkAmount(rub(150000)); err != nil || v != 150000 {
		t.Fatalf("checkAmount(1500 ₽) = %d, %v", v, err)
	}
	for name, m := range map[string]cashapi.Money{
		"ноль":       rub(0),
		"минус":      rub(-100),
		"валюта":     {AmountMinor: 100, Currency: "USD"},
		"без валюты": {AmountMinor: 100},
	} {
		if _, err := checkAmount(m); err == nil {
			t.Errorf("%s: want error", name)
		} else if name != "валюта" && name != "без валюты" {
			wantProblem(t, err, "amount_invalid")
		}
	}
	if _, err := checkAmount(rub(maxMinor + 1)); err == nil {
		t.Error("выше предела: want error")
	}
}

// TestMethodAllowed: METHODS_OF эталона — ящик, сейф и подотчёт принимают наличные, терминал — карту и СБП, счёт —
// безналичный.
func TestMethodAllowed(t *testing.T) {
	t.Parallel()
	cases := []struct {
		kind, method string
		ok           bool
	}{
		{"cash_drawer", "cash", true}, {"cash_drawer", "card", false}, {"safe", "cash", true},
		{"advance", "cash", true}, {"advance", "sbp", false},
		{"acquiring", "card", true}, {"acquiring", "sbp", true}, {"acquiring", "cash", false},
		{"bank", "transfer", true}, {"bank", "cash", false}, {"virtual", "transfer", true},
	}
	for _, c := range cases {
		if got := methodAllowed(c.kind, c.method); got != c.ok {
			t.Errorf("methodAllowed(%s, %s) = %v, want %v", c.kind, c.method, got, c.ok)
		}
	}
	if defaultMethod("acquiring") != "card" || defaultMethod("cash_drawer") != "cash" || defaultMethod("bank") != "transfer" {
		t.Error("defaultMethod: первый способ вида")
	}
}

// TestOperationKind: тип, направление и статья согласованы; возврат — расход со статьёй «refund»; «Ввод остатка» — приход
// opening_balance.
func TestOperationKind(t *testing.T) {
	t.Parallel()
	typ := func(s cashapi.CashOperationCreateType) *cashapi.CashOperationCreateType { return &s }
	cases := []struct {
		name         string
		b            cashapi.CashOperationCreate
		wantType     string
		wantDir      string
		wantCategory string
		bad          bool
	}{
		{"приход", cashapi.CashOperationCreate{Direction: "in", Category: "service_payment"}, "in", "in", "service_payment", false},
		{"расход", cashapi.CashOperationCreate{Direction: "out", Category: "expense"}, "out", "out", "expense", false},
		{"возврат по категории", cashapi.CashOperationCreate{Direction: "out", Category: "refund"}, "refund", "out", "refund", false},
		{"возврат явно", cashapi.CashOperationCreate{Type: typ("refund"), Direction: "out", Category: "refund"}, "refund", "out", "refund", false},
		{"ввод остатка", cashapi.CashOperationCreate{Type: typ("opening"), Direction: "in", Category: "opening_balance"}, "opening", "in", "opening_balance", false},
		{"приход как расход", cashapi.CashOperationCreate{Type: typ("in"), Direction: "out", Category: "service_payment"}, "", "", "", true},
		{"расход со статьёй прихода", cashapi.CashOperationCreate{Direction: "out", Category: "service_payment"}, "", "", "", true},
		{"возврат приходом", cashapi.CashOperationCreate{Type: typ("refund"), Direction: "in", Category: "refund"}, "", "", "", true},
		{"корректировка не вносится вручную", cashapi.CashOperationCreate{Direction: "in", Category: "adjustment"}, "", "", "", true},
	}
	for _, c := range cases {
		typeOut, dir, cat, err := operationKind(c.b)
		if c.bad {
			if err == nil {
				t.Errorf("%s: want error", c.name)
			} else {
				wantProblem(t, err, "validation_failed")
			}
			continue
		}
		if err != nil || typeOut != c.wantType || dir != c.wantDir || cat != c.wantCategory {
			t.Errorf("%s: %s %s %s %v, want %s %s %s", c.name, typeOut, dir, cat, err, c.wantType, c.wantDir, c.wantCategory)
		}
	}
}

// TestCheckBasis: основание — не короче трёх знаков («Укажите основание: за что и кому»).
func TestCheckBasis(t *testing.T) {
	t.Parallel()
	if got, err := checkBasis(new("  вода для кабинетов ")); err != nil || got != "вода для кабинетов" {
		t.Fatalf("checkBasis = %q, %v", got, err)
	}
	for _, s := range []*string{nil, new(""), new("  "), new("аб")} {
		_, err := checkBasis(s)
		if err == nil {
			t.Errorf("checkBasis(%v): want error", s)
			continue
		}
		wantProblem(t, err, "validation_failed")
	}
}

// TestCheckReceipt: чек ККТ вручную обязателен для прихода и возврата в кассе с ККТ: № ФД — цифры до 20 знаков, смена ККТ;
// «чек не пробивали» — с причиной; чек продавца — расход.
func TestCheckReceipt(t *testing.T) { //nolint:gocyclo // a table of the checks of a receipt
	t.Parallel()
	at := time.Date(2026, 10, 1, 13, 4, 0, 0, time.UTC)
	fd := cashapi.CashReceipt{FdNumber: new("4520"), KktShift: new("118"), ReceiptAt: &at}
	r, err := checkReceipt(true, "in", &fd)
	if err != nil || r.Fd != "4520" || r.KktShift != "118" || r.None || r.At == nil || !r.At.Equal(at) {
		t.Fatalf("чек с № ФД: %+v, %v", r, err)
	}
	none := cashapi.CashReceipt{None: new(true), Reason: new("ККТ не работала, чек пробьём позже")}
	if r, err = checkReceipt(true, "refund", &none); err != nil || !r.None || r.Reason == "" {
		t.Fatalf("чек не пробивали: %+v, %v", r, err)
	}
	seller := cashapi.CashReceipt{SellerMemberId: nil, None: nil}
	if r, err = checkReceipt(false, "out", &seller); err != nil || r.Fd != "" || r.None {
		t.Fatalf("без ККТ чек не нужен: %+v, %v", r, err)
	}
	bad := map[string]*cashapi.CashReceipt{
		"нет чека":                      nil,
		"пустой":                        {},
		"не цифры":                      {FdNumber: new("45a0"), KktShift: new("1")},
		"слишком длинный":               {FdNumber: new("123456789012345678901"), KktShift: new("1")},
		"нет смены ККТ":                 {FdNumber: new("4520")},
		"не пробивали без причины":      {None: new(true)},
		"не пробивали, причина коротка": {None: new(true), Reason: new("аб")},
	}
	for name, rc := range bad {
		_, err := checkReceipt(true, "in", rc)
		if err == nil {
			t.Errorf("%s: want error", name)
			continue
		}
		wantProblem(t, err, "validation_failed")
	}
	// расход чек ККТ не требует, чек продавца допустим
	if _, err := checkReceipt(true, "out", nil); err != nil {
		t.Errorf("расход без чека: %v", err)
	}
}

// TestCheckParts: оплата по частям (cashPostProposal): сумма частей равна к оплате, каждая часть больше нуля, способ
// допустим.
func TestCheckParts(t *testing.T) {
	t.Parallel()
	ok := []cashapi.CashProposalPostPart{{Amount: rub(200000), Method: "cash"}, {Amount: rub(120000), Method: "card"}}
	if got, err := checkParts(ok, 320000); err != nil || got != 320000 {
		t.Fatalf("checkParts = %d, %v", got, err)
	}
	for name, parts := range map[string][]cashapi.CashProposalPostPart{
		"пусто":    nil,
		"меньше":   {{Amount: rub(100000), Method: "cash"}},
		"больше":   {{Amount: rub(200000), Method: "cash"}, {Amount: rub(200000), Method: "sbp"}},
		"нулевая":  {{Amount: rub(320000), Method: "cash"}, {Amount: rub(0), Method: "card"}},
		"странный": {{Amount: rub(320000), Method: "gold"}},
	} {
		_, err := checkParts(parts, 320000)
		if err == nil {
			t.Errorf("%s: want error", name)
			continue
		}
		wantProblem(t, err, "validation_failed")
	}
}

// TestOverLimit: сверх лимита — заявка; null — без лимита, 0 — всегда с согласованием (cash.js :77–80).
func TestOverLimit(t *testing.T) {
	t.Parallel()
	lim := func(v int64) *int64 { return &v }
	cases := []struct {
		limit  *int64
		amount int64
		over   bool
	}{
		{nil, 99_999_999, false}, {lim(100000), 100000, false}, {lim(100000), 100001, true}, {lim(0), 1, true},
	}
	for _, c := range cases {
		if got := overLimit(c.limit, c.amount); got != c.over {
			t.Errorf("overLimit(%v, %d) = %v", c.limit, c.amount, got)
		}
	}
}

// TestLimitOf: лимит вида операции берётся из лимитов роли.
func TestLimitOf(t *testing.T) {
	t.Parallel()
	o, r, a := int64(1000), int64(3000), int64(0)
	l := Limits{Out: &o, Refund: &r, Advance: &a}
	if got := l.of("out"); got == nil || *got != 1000 {
		t.Error("out")
	}
	if got := l.of("refund"); got == nil || *got != 3000 {
		t.Error("refund")
	}
	if got := l.of("issue"); got == nil || *got != 0 {
		t.Error("issue")
	}
	if l.of("in") != nil {
		t.Error("приход без лимита")
	}
}

// TestCountCash: пересчёт по номиналам (DENOMS эталона 5000…50 ₽) и монеты дают посчитанное в копейках.
func TestCountCash(t *testing.T) {
	t.Parallel()
	got, kept, err := countCash(map[string]int{"5000": 2, "1000": 3, "500": 4, "50": 0}, rub(24000))
	if err != nil || got != 1_500_000+24000 {
		t.Fatalf("countCash = %d, %v", got, err)
	}
	if len(kept) != 3 {
		t.Errorf("сохраняются номиналы с ненулевым числом штук: %v", kept)
	}
	if _, ok := kept["50"]; ok {
		t.Error("номинал с нулём штук не сохраняется")
	}
	if _, _, err := countCash(map[string]int{"777": 1}, rub(0)); err == nil {
		t.Error("неизвестный номинал: want error")
	} else {
		wantProblem(t, err, "validation_failed")
	}
	if _, _, err := countCash(map[string]int{"100": -1}, rub(0)); err == nil {
		t.Error("отрицательное число штук: want error")
	}
	if got, _, err := countCash(nil, rub(0)); err != nil || got != 0 {
		t.Errorf("пустой пересчёт = %d, %v", got, err)
	}
}

// TestCloseMath: ожидаемое, расхождение и статус закрытия смены (cashShiftClose): в допуске — closed с автоматической
// корректировкой, выше допуска — review; сверка с Z-отчётом и терминалом.
func TestCloseMath(t *testing.T) { //nolint:gocyclo // a table of the reconciliations of a shift
	t.Parallel()
	facts := shiftFacts{Balance: 3_134_000, RevCash: 800_000, RevCard: 540_000, Card: 400_000, Sbp: 140_000}
	z := &zTotals{Number: "Z-118", Cash: 800_000, Card: 540_000}
	term := &termTotals{Card: 400_000, Sbp: 150_000}

	// сошлось
	m := closeMath(facts, closeInput{Counted: 3_134_000, Z: z, Term: term, Tolerance: 10_000})
	if m.Status != "closed" || m.DiffCash != 0 || m.KktCash != 0 || m.KktCard != 0 || m.Term != 10_000 {
		t.Fatalf("сошлось: %+v", m)
	}
	if m.Expected.Cash != 3_134_000 || m.Expected.RevCash != 800_000 || m.Expected.Card != 400_000 || m.Expected.Sbp != 140_000 {
		t.Fatalf("ожидаемое: %+v", m.Expected)
	}
	if m.Adjust != 0 {
		t.Errorf("без расхождения корректировки нет: %d", m.Adjust)
	}

	// недостача в допуске: закрыта, корректировка вниз
	m = closeMath(facts, closeInput{Counted: 3_130_000, Z: z, Term: term, Tolerance: 10_000})
	if m.Status != "closed" || m.DiffCash != -4_000 || m.Adjust != -4_000 {
		t.Fatalf("в допуске: %+v", m)
	}
	if m.Reason != "В пределах допуска 100 ₽" {
		t.Errorf("причина = %q", m.Reason)
	}

	// выше допуска: ждёт решения, корректировки нет
	m = closeMath(facts, closeInput{Counted: 3_100_000, Z: z, Term: term, Tolerance: 10_000})
	if m.Status != "review" || m.DiffCash != -34_000 || m.Adjust != 0 {
		t.Fatalf("выше допуска: %+v", m)
	}

	// без расхождений — причина «Без расхождений»; без Z и терминала сверка ККТ и терминала нулевая
	m = closeMath(facts, closeInput{Counted: 3_134_000})
	if m.Reason != "Без расхождений" || m.KktCash != 0 || m.KktCard != 0 || m.Term != 0 {
		t.Fatalf("без Z и терминала: %+v", m)
	}

	// излишек выше допуска нулевого допуска
	m = closeMath(facts, closeInput{Counted: 3_134_100})
	if m.Status != "review" || m.DiffCash != 100 {
		t.Fatalf("нулевой допуск: %+v", m)
	}
}

// TestDiffBounds: расхождение Z-отчёта с журналом (kktCash) считается как Z минус журнал.
func TestKktDiff(t *testing.T) {
	t.Parallel()
	facts := shiftFacts{Balance: 100, RevCash: 700_000, RevCard: 500_000}
	m := closeMath(facts, closeInput{Counted: 100, Z: &zTotals{Number: "1", Cash: 650_000, Card: 520_000}})
	if m.KktCash != -50_000 || m.KktCard != 20_000 {
		t.Fatalf("kkt: %+v", m)
	}
}

// TestKeepFloat: размен на следующую смену — не больше посчитанного; по умолчанию размен кассы; в сейф уходит остальное.
func TestKeepFloat(t *testing.T) {
	t.Parallel()
	v := func(n int64) *int64 { return &n }
	if keep, err := keepFloat(nil, 500_000, 3_000_000); err != nil || keep != 500_000 {
		t.Fatalf("по умолчанию = размен кассы: %d, %v", keep, err)
	}
	if keep, _ := keepFloat(nil, 500_000, 200_000); keep != 200_000 {
		t.Errorf("размен не больше посчитанного: %d", keep)
	}
	if keep, err := keepFloat(v(100_000), 500_000, 3_000_000); err != nil || keep != 100_000 {
		t.Errorf("явный размен: %d, %v", keep, err)
	}
	if _, err := keepFloat(v(4_000_000), 500_000, 3_000_000); err == nil {
		t.Error("размен больше посчитанного: want error")
	} else {
		wantProblem(t, err, "validation_failed")
	}
}

// TestDuplicateWindow: «похоже на дубль» — та же касса, сумма, способ и тип в пределах ±10 минут (Q-W4.00-cash-6).
func TestDuplicateWindow(t *testing.T) {
	t.Parallel()
	at := time.Date(2026, 10, 1, 13, 0, 0, 0, time.UTC)
	from, to := duplicateWindow(at)
	if !from.Equal(at.Add(-10*time.Minute)) || !to.Equal(at.Add(10*time.Minute)) {
		t.Fatalf("окно %v…%v", from, to)
	}
}

// TestSourceKey: ключ предложения — «вид:источник»; ключ идемпотентности — он же.
func TestSourceKey(t *testing.T) {
	t.Parallel()
	for _, k := range []string{"tx:7f1c", "ap:01J9", "pr:pr-2"} {
		if !validProposalKey(k) {
			t.Errorf("validProposalKey(%q) = false", k)
		}
	}
	for _, k := range []string{"", "tx", "TX:1", "tx:", "tx: 1", "tx:" + string(make([]byte, 120))} {
		if validProposalKey(k) {
			t.Errorf("validProposalKey(%q) = true", k)
		}
	}
}

// TestRefundRoom: возвратов по оплате не больше самой оплаты.
func TestRefundRoom(t *testing.T) {
	t.Parallel()
	if err := checkRefund(320000, 100000, 220000); err != nil {
		t.Errorf("впритык: %v", err)
	}
	err := checkRefund(320000, 100000, 220001)
	if err == nil {
		t.Fatal("больше оплаты: want error")
	}
	wantProblem(t, err, "validation_failed")
}

// TestChangeOpening: «Ввод остатка» — расхождение размена: сумма и знак корректировки.
func TestOpeningAdjust(t *testing.T) {
	t.Parallel()
	if d := openingDiff(500_000, 480_000); d != 20_000 {
		t.Errorf("излишек: %d", d)
	}
	if d := openingDiff(480_000, 500_000); d != -20_000 {
		t.Errorf("недостача: %d", d)
	}
	if d := openingDiff(500_000, 500_000); d != 0 {
		t.Errorf("сошлось: %d", d)
	}
}
