package files_test

import (
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/modules/files" //nolint:depguard // the package under test
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

const sha = "a3f1c9e2b7d4058e6c1f2a9b3d7e4c5f8a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d"

func upload() files.Upload {
	return files.Upload{
		FileName: "Р-208 · спереди.jpg", ContentType: "image/jpeg", SizeBytes: 2457600, SHA256: sha,
		Purpose: files.PurposeInspection, Owner: files.Ref{Module: "fleet", Entity: "reservation", ID: uuid.New()},
	}
}

// FILE-02: the server applies the limits of size and MIME; the example of initiateUpload passes.
func TestValidateUpload(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		edit func(*files.Upload)
		code string
	}{
		{"пример контракта", func(*files.Upload) {}, ""},
		{"ровно 20 МиБ", func(u *files.Upload) { u.SizeBytes = files.MaxBytes }, ""},
		{"больше 20 МиБ", func(u *files.Upload) { u.SizeBytes = files.MaxBytes + 1 }, "payload_too_large"},
		{"пустой файл", func(u *files.Upload) { u.SizeBytes = 0 }, "validation_failed"},
		{"исполняемый файл", func(u *files.Upload) { u.ContentType = "application/x-msdownload" }, "validation_failed"},
		{"PDF как фото осмотра", func(u *files.Upload) { u.ContentType = "application/pdf" }, "validation_failed"},
		{"PDF чека", func(u *files.Upload) {
			u.ContentType, u.Purpose = "application/pdf", files.PurposeExpenseReceipt
		}, ""},
		{"документ вложения формы", func(u *files.Upload) {
			u.ContentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
			u.Purpose = files.PurposeFormAttachment
		}, ""},
		{"тип с параметрами", func(u *files.Upload) { u.ContentType = "image/jpeg; name=x" }, "validation_failed"},
		{"неизвестное назначение", func(u *files.Upload) { u.Purpose = "avatar" }, "validation_failed"},
		{"пустое имя", func(u *files.Upload) { u.FileName = " " }, "validation_failed"},
		{"имя с путём", func(u *files.Upload) { u.FileName = "../../etc/passwd" }, "validation_failed"},
		{"имя с управляющим символом", func(u *files.Upload) { u.FileName = "a\x00.jpg" }, "validation_failed"},
		{"имя длиннее 255", func(u *files.Upload) { u.FileName = strings.Repeat("я", 256) }, "validation_failed"},
		{"sha256 не hex", func(u *files.Upload) { u.SHA256 = strings.ToUpper(sha) }, "validation_failed"},
		{"родитель без id", func(u *files.Upload) { u.Owner.ID = uuid.Nil }, "validation_failed"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			u := upload()
			tc.edit(&u)
			err := files.ValidateUpload(u)
			switch {
			case tc.code == "" && err != nil:
				t.Fatalf("unexpected error %v", err)
			case tc.code != "" && !problem.Is(err, tc.code):
				t.Fatalf("error %v, want %s", err, tc.code)
			}
		})
	}
}

// FILE-01: the server forms object keys; quarantine and the permanent space are different prefixes.
func TestObjectKeys(t *testing.T) {
	t.Parallel()
	tenant := uuid.MustParse("11111111-1111-4111-8111-111111111111")
	file := uuid.MustParse("0a5af2d5-52c6-5a8a-84aa-8eda2fa9c7d2")
	if got := files.QuarantineKey(tenant, file); got != "quarantine/11111111-1111-4111-8111-111111111111/0a5af2d5-52c6-5a8a-84aa-8eda2fa9c7d2" {
		t.Errorf("QuarantineKey = %s", got)
	}
	if got := files.FileKey(tenant, file); got != "files/11111111-1111-4111-8111-111111111111/0a5af2d5-52c6-5a8a-84aa-8eda2fa9c7d2" {
		t.Errorf("FileKey = %s", got)
	}
}

// Until a display-name column exists, the name travels in the «name» parameter of the declared MIME type.
func TestEncodeDecodeMIME(t *testing.T) {
	t.Parallel()
	for _, name := range []string{"Р-208 · спереди.jpg", `a "quoted"; name.pdf`, "plain.png", "100% чек.pdf"} {
		stored := files.EncodeMIME("image/jpeg", name)
		ct, got := files.DecodeMIME(stored)
		if ct != "image/jpeg" || got != name {
			t.Errorf("%q → %q → (%q, %q)", name, stored, ct, got)
		}
	}
	if ct, name := files.DecodeMIME("image/png"); ct != "image/png" || name != "" {
		t.Errorf("legacy value: (%q, %q)", ct, name)
	}
}

func TestAPIStatus(t *testing.T) {
	t.Parallel()
	want := map[string]string{
		"reserved": "pending_upload", "uploaded": "pending_upload", "scanning": "quarantined",
		"ready": "ready", "rejected": "rejected",
	}
	for db, api := range want {
		if got := files.APIStatus(db); got != api {
			t.Errorf("APIStatus(%s) = %s, want %s", db, got, api)
		}
	}
}

// The text of requestStorageChange/downgrade_below_usage: «Новая квота 25 ГБ меньше занятых 46,2 ГБ. Освободите
// 21,2 ГБ.».
func TestDowngradeDetail(t *testing.T) {
	t.Parallel()
	got := files.DowngradeDetail(25<<30, 49606872269)
	if want := "Новая квота 25 ГБ меньше занятых 46,2 ГБ. Освободите 21,2 ГБ."; got != want {
		t.Fatalf("detail %q, want %q", got, want)
	}
}

// requestStorageChange/ok: 150 ГиБ → 1 500 ₽ в месяц (10 ₽ за ГиБ, как MSW W0.13).
func TestQuoteCharge(t *testing.T) {
	t.Parallel()
	if got := files.QuoteCharge(161061273600); got != 150000 {
		t.Fatalf("charge %d, want 150000", got)
	}
}

// A quote is a deterministic id: the same tenant, volume, current quota and minute give the same id; anything
// else — another id.
func TestQuoteID(t *testing.T) {
	t.Parallel()
	tenant := uuid.New()
	at := time.Date(2026, 10, 1, 7, 30, 15, 0, time.UTC)
	q := files.QuoteID(tenant, 150<<30, 100<<30, at)
	if files.QuoteID(tenant, 150<<30, 100<<30, at.Add(30*time.Second)) != q {
		t.Error("same minute, another id")
	}
	for name, other := range map[string]uuid.UUID{
		"tenant":  files.QuoteID(uuid.New(), 150<<30, 100<<30, at),
		"volume":  files.QuoteID(tenant, 151<<30, 100<<30, at),
		"quota":   files.QuoteID(tenant, 150<<30, 101<<30, at),
		"minute":  files.QuoteID(tenant, 150<<30, 100<<30, at.Add(time.Minute)),
		"changes": files.ChangeID(q),
	} {
		if other == q {
			t.Errorf("%s: same id", name)
		}
	}
	if !files.QuoteValid(q, tenant, 150<<30, 100<<30, at.Add(59*time.Minute)) {
		t.Error("a quote of the last hour is valid")
	}
	if files.QuoteValid(q, tenant, 150<<30, 100<<30, at.Add(61*time.Minute)) {
		t.Error("a quote older than an hour is valid")
	}
	if files.QuoteValid(q, tenant, 150<<30, 120<<30, at) {
		t.Error("a quote of another quota is valid")
	}
}
