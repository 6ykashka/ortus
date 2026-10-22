package forms

import (
	"time"

	fapi "github.com/ortus/ortus-crm/backend/internal/api/forms"
)

// Access of a form (forms.forms.access).
const (
	accessMembers = "members"
	accessPublic  = "public"
)

// retainDefault is «Хранить ответы» by default — «1 год».
const retainDefault = 365

// settings are the settings of a form (Q-W4.00-forms-2): those the server applies at submission are columns of
// forms.forms (access, accept_until, response_limit, one_per_member, retain_days), the others — forms.forms.settings.
type settings struct {
	access        string
	acceptUntil   *time.Time // the last day of acceptance (a date)
	responseLimit *int
	onePerMember  bool
	retainDays    int
	extra         extraSettings
}

// extraSettings are forms.forms.settings (jsonb).
type extraSettings struct {
	AllowEditBeforeReview bool   `json:"allowEditBeforeReview"`
	ConfirmationText      string `json:"confirmationText"`
	Scoring               bool   `json:"scoring"`
	PassScore             *int   `json:"passScore"`
	ShowScore             bool   `json:"showScore"`
	ProgressBar           bool   `json:"progressBar"`
	BackButton            bool   `json:"backButton"`
	ShowLogo              bool   `json:"showLogo"`
	// Shortened is the retention before it was shortened and the moment of the change: the older responses keep it for
	// a grace period (Q-W4.00-forms-22); nil — not shortened.
	Shortened *shortened `json:"shortened,omitempty"`
}

// shortened is a shortening of the retention of responses.
type shortened struct {
	Days int       `json:"days"`
	At   time.Time `json:"at"`
}

// defaultSettings are FORM_SETTINGS of the prototype (models.js:85).
func defaultSettings() settings {
	return settings{access: accessMembers, retainDays: retainDefault, extra: extraSettings{
		AllowEditBeforeReview: true, ConfirmationText: textThanks, ShowScore: true, ProgressBar: true, BackButton: true,
		ShowLogo: true,
	}}
}

// api is FormSettings of the contract.
func (s settings) api() fapi.FormSettings {
	out := fapi.FormSettings{
		Access: fapi.FormSettingsAccess(s.access), ResponseLimit: s.responseLimit, OnePerMember: s.onePerMember,
		AllowEditBeforeReview: s.extra.AllowEditBeforeReview, ConfirmationText: s.extra.ConfirmationText,
		Scoring: s.extra.Scoring, PassScore: s.extra.PassScore, ShowScore: s.extra.ShowScore, ProgressBar: s.extra.ProgressBar,
		BackButton: s.extra.BackButton, ShowLogo: s.extra.ShowLogo, RetainResponsesDays: fapi.FormSettingsRetainResponsesDays(s.retainDays),
	}
	if s.acceptUntil != nil {
		alloc(&out.AcceptUntil).Time = *s.acceptUntil
	}
	return out
}
