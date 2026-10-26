package cash

import (
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	cashapi "github.com/ortus/ortus-crm/backend/internal/api/cash"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// Problem codes of the module (api/errors.yaml).
const (
	codeValidation        = "validation_failed"
	codeAmount            = "amount_invalid"
	codeInvalidTransition = "invalid_transition"
	codeShiftClosed       = "shift_closed"
	codeDuplicateSource   = "duplicate_source"
	codeDuplicateReceipt  = "duplicate_receipt"
	codeSelfApproval      = "self_approval"
	codeInsufficient      = "insufficient_funds"
	codeRevisionMismatch  = "revision_mismatch"
	codeRevisionRequired  = "revision_required"
	codeIdemInProgress    = "idempotency_in_progress"
)

// Texts of the answers: cash.js 19.10 of the prototype, word for word where the prototype has one.
const (
	textAmount          = "Сумма: укажите число больше нуля"
	textAmountBig       = "Сумма слишком велика — проверьте её"
	textCurrency        = "Касса ведётся в рублях."
	textBasis           = "Укажите основание: за что и кому"
	textReason          = "Укажите причину"
	textReceiptFD       = "Укажите № ФД из чека: цифры, до 20 знаков, и смену ККТ. Если чек не пробивали — отметьте это и укажите причину"
	textReceiptReason   = "Чек не пробивали — укажите причину"
	textNoShift         = "Смена в кассе закрыта — откройте смену, чтобы проводить оплаты"
	textType            = "Тип операции не сходится с направлением и статьёй"
	textAccountNotFound = "Касса не найдена"
	textOpNotFound      = "Операция не найдена"
	textStale           = "Запись изменилась: обновите страницу и повторите."
	textMethod          = "Этот способ оплаты не принимается в кассе"
	textKeep            = "Размен на следующую смену — не больше посчитанного"
	textDenom           = "Неизвестный номинал или число штук"
	textParts           = "Части оплаты не сходятся с суммой к оплате"
)

// maxMinor is the upper bound of one amount: 100 000 000 ₽ in kopecks.
const maxMinor = 100_000_000 * 100

const currencyRUB = "RUB"

// Operation types and statuses (tenant 0040–0042).
const (
	typeIn      = "in"
	typeOut     = "out"
	typeRefund  = "refund"
	typeOpening = "opening"
	typeAdjust  = "adjust"
	typeStorno  = "storno"
	typeMoveIn  = "move_in"
	typeMoveOut = "move_out"

	dirIn  = "in"
	dirOut = "out"

	catServicePayment = "service_payment"
	catExpense        = "expense"
	catOpening        = "opening_balance"
	catRefund         = "refund"
	catAdjustment     = "adjustment"

	// ways of payment, states and modes the module compares with.
	methodCash     = "cash"
	methodCard     = "card"
	methodSbp      = "sbp"
	methodTransfer = "transfer"
	statusOpen     = "open"
	statusClosed   = "closed"
	statusReview   = "review"
	statusRejected = "rejected"
	statusAccepted = "accepted"
	statusApproved = "approved"
	statusPending  = "pending"
	statusPosted   = "posted"
	statusTransit  = "transit"
	statusDone     = "done"
	modeNone       = "none"
	kktManual      = "manual"
	originManual   = "manual"

	// keys of the audit diffs and of the events.
	keyAccount  = "accountId"
	keyAmount   = "amountMinor"
	keyCurrency = "currency"
	keyUnit     = "unitId"
	keyStatus   = "status"
	keyNumber   = "number"
	keyShift    = "shiftId"
	keyRequest  = "requestId"
	keyDiff     = "diffMinor"

	// lockUpdate locks the row a statement reads.
	lockUpdate = " for update"

	kindDrawer    = "cash_drawer"
	kindSafe      = "safe"
	kindAdvance   = "advance"
	kindAcquiring = "acquiring"
	kindBank      = "bank"
	kindVirtual   = "virtual"
)

func invalid(detail string) *problem.Error { return problem.New(codeValidation, detail) }

// checkAmount returns the amount in kopecks: more than zero, rubles, not above maxMinor.
func checkAmount(m cashapi.Money) (int64, error) {
	switch {
	case m.AmountMinor <= 0:
		return 0, problem.New(codeAmount, textAmount)
	case m.Currency != currencyRUB:
		return 0, invalid(textCurrency)
	case m.AmountMinor > maxMinor:
		return 0, problem.New(codeAmount, textAmountBig)
	}
	return int64(m.AmountMinor), nil
}

// methodsOf is METHODS_OF of the prototype: the ways of payment a kind of account takes.
func methodsOf(kind string) []string {
	switch kind {
	case kindAcquiring:
		return []string{methodCard, methodSbp}
	case kindBank, kindVirtual:
		return []string{methodTransfer}
	}
	return []string{methodCash}
}

func methodAllowed(kind, method string) bool { return slices.Contains(methodsOf(kind), method) }

func defaultMethod(kind string) string { return methodsOf(kind)[0] }

// operationKind resolves the type, the direction and the category of a manual operation and checks they agree: a receipt
// is an «in» with the category of a payment, an expense an «out» with an expense, a refund an «out» with «refund», the
// opening balance an «in» with «opening_balance». An adjustment is never entered by hand.
func operationKind(b cashapi.CashOperationCreate) (typ, dir, category string, err error) {
	dir, category = string(b.Direction), string(b.Category)
	if b.Type != nil {
		typ = string(*b.Type)
	} else {
		switch {
		case category == catRefund:
			typ = typeRefund
		case dir == dirIn:
			typ = typeIn
		default:
			typ = typeOut
		}
	}
	want := map[string][2]string{
		typeIn:      {dirIn, catServicePayment},
		typeOut:     {dirOut, catExpense},
		typeRefund:  {dirOut, catRefund},
		typeOpening: {dirIn, catOpening},
	}[typ]
	if want[0] == "" || want[0] != dir || want[1] != category {
		return "", "", "", invalid(textType)
	}
	return typ, dir, category, nil
}

// checkBasis returns the trimmed basis: not shorter than three characters.
func checkBasis(s *string) (string, error) {
	if s == nil || utf8.RuneCountInString(strings.TrimSpace(*s)) < 3 {
		return "", invalid(textBasis)
	}
	v := strings.TrimSpace(*s)
	if utf8.RuneCountInString(v) > 500 {
		return "", invalid("Основание — не длиннее 500 знаков")
	}
	return v, nil
}

// reasonOf returns a reason: not shorter than three characters, not longer than 500.
func reasonOf(s *string, text string) (string, error) {
	if s == nil || utf8.RuneCountInString(strings.TrimSpace(*s)) < 3 {
		return "", invalid(text)
	}
	v := strings.TrimSpace(*s)
	if utf8.RuneCountInString(v) > 500 {
		return "", invalid("Причина — не длиннее 500 знаков")
	}
	return v, nil
}

var fdRE = regexp.MustCompile(`^[0-9]{1,20}$`)

// receiptData is the receipt of an operation as it is stored.
type receiptData struct {
	Fd       string
	KktShift string
	At       *time.Time
	None     bool
	Reason   string
	Seller   *uuid.UUID
	FileID   *uuid.UUID
}

// checkReceipt checks the manual receipt of the KKT: a receipt or a refund in an account with a KKT carries the number
// of the fiscal document with the shift of the KKT, or the mark «not printed» with a reason; other operations need no
// receipt (a seller's receipt is only a mark).
func checkReceipt(fiscalAccount bool, opType string, rc *cashapi.CashReceipt) (receiptData, error) {
	var out receiptData
	if rc != nil {
		out.Seller, out.FileID = rc.SellerMemberId, rc.FileId
	}
	if !fiscalAccount || (opType != typeIn && opType != typeRefund) {
		return out, nil
	}
	if rc == nil {
		return receiptData{}, invalid(textReceiptFD)
	}
	if rc.None != nil && *rc.None {
		reason, err := reasonOf(rc.Reason, textReceiptReason)
		if err != nil {
			return receiptData{}, invalid(textReceiptReason)
		}
		out.None, out.Reason = true, reason
		return out, nil
	}
	fd, shift, err := fiscalNumber(rc)
	if err != nil {
		return receiptData{}, err
	}
	out.Fd, out.KktShift = fd, shift
	if rc.ReceiptAt != nil {
		at := rc.ReceiptAt.UTC()
		out.At = &at
	}
	return out, nil
}

// fiscalNumber returns the number of the fiscal document and the shift of the KKT of a receipt.
func fiscalNumber(rc *cashapi.CashReceipt) (fd, shift string, err error) {
	if rc.FdNumber == nil || rc.KktShift == nil {
		return "", "", invalid(textReceiptFD)
	}
	fd, shift = strings.TrimSpace(*rc.FdNumber), strings.TrimSpace(*rc.KktShift)
	if !fdRE.MatchString(fd) || shift == "" || utf8.RuneCountInString(shift) > 20 {
		return "", "", invalid(textReceiptFD)
	}
	return fd, shift, nil
}

// knownMethods are the ways of payment of the contract.
var knownMethods = []string{methodCash, methodCard, methodSbp, methodTransfer}

// checkParts checks the parts of a payment (cashPostProposal): each more than zero in a known way, the sum equals the
// amount to pay.
func checkParts(parts []cashapi.CashProposalPostPart, total int64) (int64, error) {
	var sum int64
	for _, p := range parts {
		v, err := checkAmount(p.Amount)
		if err != nil {
			return 0, invalid(textParts)
		}
		if !slices.Contains(knownMethods, string(p.Method)) {
			return 0, invalid(textParts)
		}
		sum += v
	}
	if len(parts) == 0 || sum != total {
		return 0, invalid(textParts + ": " + formatRub(sum) + " из " + formatRub(total))
	}
	return sum, nil
}

// overLimit reports whether amount is above the limit of a role: nil is no limit, 0 is «always with approval».
func overLimit(limit *int64, amount int64) bool { return limit != nil && amount > *limit }

// Limits are the limits «limit: amount» of the roles of a subject over an account, in kopecks; nil is no limit
// (cash.js: with several roles the maximum wins and null wins over a number).
type Limits struct {
	Out, Refund, Advance *int64
}

// of returns the limit for a kind of operation: «out», «refund» or «issue» (an advance issue).
func (l Limits) of(kind string) *int64 {
	switch kind {
	case typeOut:
		return l.Out
	case typeRefund:
		return l.Refund
	case "issue":
		return l.Advance
	}
	return nil
}

// denoms are the notes of the count (DENOMS of the prototype), in rubles.
var denoms = map[string]int64{"5000": 5000, "2000": 2000, "1000": 1000, "500": 500, "200": 200, "100": 100, "50": 50}

// countCash returns the counted sum in kopecks of the notes by denomination and the coins, with the denominations that
// have notes.
func countCash(counts map[string]int, coins cashapi.Money) (int64, map[string]int, error) {
	kept := map[string]int{}
	var sum int64
	for k, n := range counts {
		d, ok := denoms[k]
		if !ok || n < 0 || n > 100_000 {
			return 0, nil, invalid(textDenom)
		}
		if n > 0 {
			kept[k] = n
			sum += d * int64(n) * 100
		}
	}
	switch {
	case coins.AmountMinor < 0 || coins.AmountMinor > maxMinor:
		return 0, nil, invalid(textDenom)
	case coins.AmountMinor > 0 && coins.Currency != currencyRUB:
		return 0, nil, invalid(textCurrency)
	}
	return sum + int64(coins.AmountMinor), kept, nil
}

// shiftFacts are the facts of the journal a shift closes against.
type shiftFacts struct {
	Balance int64 // the balance of the drawer
	RevCash int64 // cash receipts of the shift minus cash refunds
	RevCard int64 // card and SBP receipts of the terminal minus refunds
	Card    int64 // card receipts of the terminal, net
	Sbp     int64 // SBP receipts of the terminal, net
}

type zTotals struct {
	Number     string
	Cash, Card int64
}

type termTotals struct{ Card, Sbp int64 }

type closeInput struct {
	Counted   int64
	Z         *zTotals
	Term      *termTotals
	Tolerance int64
}

type expectedTotals struct{ Cash, RevCash, RevCard, Card, Sbp int64 }

// closeResult is the reconciliation of a closing shift (cashShiftClose).
type closeResult struct {
	Expected expectedTotals
	DiffCash int64
	KktCash  int64
	KktCard  int64
	Term     int64
	Status   string // closed | review
	Adjust   int64  // signed correction of the balance for a difference within the tolerance; 0 — none
	Reason   string // automatic reason of a decision, for status closed
}

// closeMath reconciles the count, the Z report and the terminal with the journal: within the tolerance the shift is
// closed with an automatic correction, above it waits for a decision.
func closeMath(f shiftFacts, in closeInput) closeResult {
	r := closeResult{Expected: expectedTotals{Cash: f.Balance, RevCash: f.RevCash, RevCard: f.RevCard, Card: f.Card, Sbp: f.Sbp}}
	r.DiffCash = in.Counted - f.Balance
	if in.Z != nil {
		r.KktCash, r.KktCard = in.Z.Cash-f.RevCash, in.Z.Card-f.RevCard
	}
	if in.Term != nil {
		r.Term = in.Term.Card + in.Term.Sbp - f.RevCard
	}
	if abs(r.DiffCash) > in.Tolerance {
		r.Status = statusReview
		return r
	}
	r.Status = statusClosed
	if r.DiffCash != 0 {
		r.Adjust = r.DiffCash
		r.Reason = "В пределах допуска " + formatRub(in.Tolerance)
	} else {
		r.Reason = "Без расхождений"
	}
	return r
}

func abs(v int64) int64 {
	if v < 0 {
		return -v
	}
	return v
}

// keepFloat is the float left in the drawer for the next shift: by default the float of the account, never more than
// counted; an explicit value must not exceed the count.
func keepFloat(keep *int64, float, counted int64) (int64, error) {
	if keep == nil {
		return min(float, counted), nil
	}
	if *keep < 0 || *keep > counted {
		return 0, invalid(textKeep)
	}
	return *keep, nil
}

// duplicateWindow is the window of «looks like a duplicate»: ±10 minutes around the moment (Q-W4.00-cash-6).
func duplicateWindow(at time.Time) (from, to time.Time) {
	return at.Add(-10 * time.Minute), at.Add(10 * time.Minute)
}

var proposalKeyRE = regexp.MustCompile(`^[a-z][a-z0-9_]*:[A-Za-z0-9_.-]{1,100}$`)

// validProposalKey reports whether k is a key «kind:source» (tenant 0042 cash.proposals.key).
func validProposalKey(k string) bool { return proposalKeyRE.MatchString(k) }

// checkRefund checks that the refunds of a payment do not exceed it: payment, the refunds done and the one asked.
func checkRefund(payment, done, amount int64) error {
	if done+amount > payment {
		return invalid("Возвратов по оплате больше оплаты: доступно " + formatRub(payment-done))
	}
	return nil
}

// openingDiff is the signed difference of the float counted at the opening of a shift against the balance.
func openingDiff(counted, balance int64) int64 { return counted - balance }

// formatRub formats kopecks as rubles with a non-breaking space before the sign, as rub() of the prototype: thousands
// separated by non-breaking spaces, the decimals only when there are kopecks.
func formatRub(minor int64) string {
	neg := minor < 0
	minor = abs(minor)
	whole, frac := minor/100, minor%100
	digits := strconv.FormatInt(whole, 10)
	var b strings.Builder
	for i, c := range digits {
		if i > 0 && (len(digits)-i)%3 == 0 {
			b.WriteString(" ")
		}
		b.WriteRune(c)
	}
	out := b.String()
	if frac != 0 {
		out += "," + strings.TrimRight(strconv.FormatInt(100+frac, 10)[1:], "0")
	}
	if neg {
		out = "−" + out
	}
	return out + " ₽"
}
