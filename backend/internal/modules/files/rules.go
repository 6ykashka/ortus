// Package files is the module of tenant files and storage (W1.09, S1-20…S1-22; FILE-01…03, PLAT-06…08): upload
// sessions (quota reservation → presigned PUT → complete → scan → ready/rejected), downloads that check the parent
// object on every request, the list of files the actor may open and the data of the «Хранилище» screen.
package files

import (
	"fmt"
	"math"
	"mime"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// Limits of the contract (UploadTicket, getFileDownload) and of the mock (W0.13).
const (
	MaxBytes          int64 = 20 << 20 // UploadTicket.maxBytes
	TicketTTL               = 15 * time.Minute
	SessionTTL              = time.Hour
	DownloadTTL             = time.Minute // getFileDownload: issued URLs last at most 60 seconds
	QuoteTTL                = time.Hour
	DefaultQuotaBytes int64 = 100 << 30 // DEFAULT_QUOTA of the mock until the quota is synchronised with billing
	PriceMinorPerGiB  int64 = 1000      // 10 ₽ per GiB per month (requestStorageChange/ok)
	Currency                = "RUB"
	maxFileName             = 255
	gib                     = 1 << 30
)

// Problem codes of the module (api/errors.yaml).
const (
	codeValidation   = "validation_failed"
	codeTooLarge     = "payload_too_large"
	codeQuota        = "quota_exceeded"
	codeDowngrade    = "downgrade_below_usage"
	codeTransition   = "invalid_transition"
	codeNotReady     = "photo_not_ready"
	codeNotFound     = problem.CodeNotFound
	codeDependency   = problem.CodeDependencyUnavailable
	codeMalformed    = problem.CodeMalformedRequest
	codeForbidden    = problem.CodeForbiddenAction
	codeFunctionDeny = "function_blocked"
)

// Purpose is UploadCreate.purpose, stored verbatim in files.objects.purpose.
type Purpose string

// Purposes of the contract.
const (
	PurposeInspection          Purpose = "inspection"
	PurposeExpenseReceipt      Purpose = "expense_receipt"
	PurposeKnowledgeAttachment Purpose = "knowledge_attachment"
	PurposeFormAttachment      Purpose = "form_attachment"
	PurposeRepairEvidence      Purpose = "repair_evidence"
)

// MIME types accepted by the server (FILE-02): photos, receipts and documents.
const (
	mimeJPEG = "image/jpeg"
	mimePNG  = "image/png"
	mimeWebP = "image/webp"
	mimeHEIC = "image/heic"
	mimePDF  = "application/pdf"
	mimeDOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	mimeXLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	mimeText = "text/plain"
	mimeCSV  = "text/csv"
)

var (
	photos    = []string{mimeJPEG, mimePNG, mimeWebP, mimeHEIC}
	receipts  = append(slices.Clone(photos), mimePDF)
	documents = append(slices.Clone(receipts), mimeDOCX, mimeXLSX, mimeText, mimeCSV)
	// allowedMIME lists the declared types each purpose accepts: evidence photos are photos only.
	allowedMIME = map[Purpose][]string{
		PurposeInspection:          photos,
		PurposeRepairEvidence:      photos,
		PurposeExpenseReceipt:      receipts,
		PurposeKnowledgeAttachment: documents,
		PurposeFormAttachment:      documents,
	}
	sha256RE = regexp.MustCompile(`^[a-f0-9]{64}$`)
	moduleRE = regexp.MustCompile(`^[a-z][a-z0-9_-]{1,49}$`) // ObjectRef.moduleKey
	entityRE = regexp.MustCompile(`^[a-z][a-z0-9_]{1,49}$`)  // ObjectRef.entityType
)

// Ref is the parent object of a file (ObjectRef).
type Ref struct {
	Module string
	Entity string
	ID     uuid.UUID
}

// Kind is «module.entity», the files.objects.owner_type of the parent.
func (r Ref) Kind() string { return r.Module + "." + r.Entity }

// Upload is the body of initiateUpload.
type Upload struct {
	FileName    string
	ContentType string
	SizeBytes   int64
	SHA256      string
	Purpose     Purpose
	Owner       Ref
}

func invalid(detail string) error { return problem.New(codeValidation, detail) }

// ValidateUpload applies the server limits of FILE-02: 413 payload_too_large above MaxBytes, 422 for an empty
// file, an unsupported or not allowed MIME type, an unsafe display name or a malformed checksum.
func ValidateUpload(u Upload) error {
	allowed, known := allowedMIME[u.Purpose]
	switch {
	case u.SizeBytes > MaxBytes:
		return problem.New(codeTooLarge, "Файл больше 20 МБ.")
	case u.SizeBytes < 1:
		return invalid("Файл пустой.")
	case !known:
		return invalid("Неизвестное назначение файла.")
	case !slices.Contains(allowed, u.ContentType):
		return invalid("Этот тип файла здесь загрузить нельзя.")
	case !sha256RE.MatchString(u.SHA256):
		return invalid("Контрольная сумма должна быть SHA-256 в нижнем регистре.")
	case !moduleRE.MatchString(u.Owner.Module) || !entityRE.MatchString(u.Owner.Entity) || u.Owner.ID == uuid.Nil:
		return invalid("Не указан объект, к которому относится файл.")
	}
	return validName(u.FileName)
}

// validName accepts a display name, never a path (FILE-01: the name is not an object key).
func validName(name string) error {
	trimmed := strings.TrimSpace(name)
	switch {
	case trimmed == "" || trimmed == "." || trimmed == "..":
		return invalid("Укажите имя файла.")
	case !utf8.ValidString(name) || utf8.RuneCountInString(name) > maxFileName:
		return invalid("Имя файла длиннее 255 символов.")
	case strings.ContainsAny(name, `/\`) || strings.ContainsFunc(name, unicode.IsControl):
		return invalid("Имя файла не может содержать путь или управляющие символы.")
	}
	return nil
}

// QuarantineKey is the object key of an upload until its check (FILE-01: formed by the server).
func QuarantineKey(tenant, file uuid.UUID) string {
	return "quarantine/" + tenant.String() + "/" + file.String()
}

// VerifiedKey is the copy of a quarantined upload that one completeUpload attempt verifies and the worker checks.
// No upload ticket covers it: a PUT through the ticket after completeUpload changes the quarantined object only.
func VerifiedKey(tenant, file, attempt uuid.UUID) string {
	return QuarantineKey(tenant, file) + "." + attempt.String()
}

// FileKey is the object key of a checked file.
func FileKey(tenant, file uuid.UUID) string { return "files/" + tenant.String() + "/" + file.String() }

// EncodeMIME stores the display name in the «name» parameter of the declared MIME type (RFC 2045, RFC 2231 for
// non-ASCII names) until files.objects has a column for it.
func EncodeMIME(contentType, fileName string) string {
	if fileName == "" {
		return contentType
	}
	if v := mime.FormatMediaType(contentType, map[string]string{"name": fileName}); v != "" {
		return v
	}
	return contentType
}

// DecodeMIME splits a stored declared MIME type into the content type and the display name.
func DecodeMIME(stored string) (contentType, fileName string) {
	ct, params, err := mime.ParseMediaType(stored)
	if err != nil {
		return stored, ""
	}
	return ct, params["name"]
}

// apiStatus is File.status of files.objects.state.
var apiStatus = map[string]string{
	"reserved": "pending_upload", "uploaded": "pending_upload", "scanning": "quarantined",
	"ready": "ready", "rejected": "rejected",
}

// APIStatus maps files.objects.state to File.status.
func APIStatus(state string) string { return apiStatus[state] }

// dbStates are the files.objects states of a File.status filter.
func dbStates(status string) []string {
	var out []string
	for db, api := range apiStatus {
		if api == status {
			out = append(out, db)
		}
	}
	slices.Sort(out)
	return out
}

// gbText is «46,2»: GiB with one decimal, integers without a fraction (gbText of the mock).
func gbText(bytes int64) string {
	v := math.Round(float64(bytes)/gib*10) / 10
	return strings.Replace(strconv.FormatFloat(v, 'f', -1, 64), ".", ",", 1)
}

// DowngradeDetail is the text of downgrade_below_usage (example requestStorageChange/downgrade_below_usage).
func DowngradeDetail(requested, used int64) string {
	return fmt.Sprintf("Новая квота %s ГБ меньше занятых %s ГБ. Освободите %s ГБ.",
		gbText(requested), gbText(used), gbText(used-requested))
}

// QuoteCharge is the monthly charge of a quota in minor units: whole GiB × PriceMinorPerGiB.
func QuoteCharge(bytes int64) int64 {
	return int64(math.Round(float64(bytes)/gib)) * PriceMinorPerGiB
}

// quoteSpace is the UUID v5 namespace of storage quotes.
var quoteSpace = uuid.NewSHA1(uuid.NameSpaceURL, []byte("ortus:files:storage-quote"))

// QuoteID is the id of the quote of requested bytes at the current quota, issued in the minute of at. There is no
// table of quotes: a commit recomputes the id (QuoteValid).
func QuoteID(tenant uuid.UUID, requested, quota int64, at time.Time) uuid.UUID {
	name := fmt.Sprintf("quote|%s|%d|%d|%d", tenant, requested, quota, at.Unix()/60)
	return uuid.NewSHA1(quoteSpace, []byte(name))
}

// QuoteExpiresAt is the end of validity of a quote issued at.
func QuoteExpiresAt(at time.Time) time.Time { return at.Truncate(time.Minute).Add(QuoteTTL) }

// QuoteValid reports whether id is a quote of the last QuoteTTL for these values.
func QuoteValid(id, tenant uuid.UUID, requested, quota int64, now time.Time) bool {
	for m := range int(QuoteTTL / time.Minute) {
		if QuoteID(tenant, requested, quota, now.Add(-time.Duration(m)*time.Minute)) == id {
			return true
		}
	}
	return false
}

// ChangeID is the id of the storage change of a quote.
func ChangeID(quote uuid.UUID) uuid.UUID {
	return uuid.NewSHA1(quoteSpace, []byte("change|"+quote.String()))
}
