package kit

import "github.com/ortus/ortus-crm/backend/internal/platform/audit"

// Sensitivity levels of the permission catalog (api/permissions.yaml «sensitivity»): normal — a level toggle of the
// role editor turns it on; sensitive — a separate checkbox; restricted — a separate block, closed to the work
// function driver, never in default templates (AUTH-03). The editor keeps them apart; the server never adds them
// implicitly and records a change of a role with the highest level of its keys.
const (
	Normal     = audit.Normal
	Sensitive  = audit.Sensitive
	Restricted = audit.Restricted
)

// sensitivity is the level of every non-normal tenant action of the catalog (TestSensitivityMatchesCatalog guards it).
var sensitivity = map[string]string{
	"billing.read": Sensitive, "cash.accounts.manage": Sensitive, "cash.advance.issue": Sensitive,
	"cash.balance.read": Sensitive, "cash.export": Sensitive, "cash.period.close": Sensitive, "cash.refund": Sensitive,
	"cash.reverse": Sensitive, "cash.transfer": Sensitive, "inventory.consumption.override": Sensitive,
	"chat.ephemeral.send": Sensitive, "chat.export": Sensitive, "chat.external": Sensitive,
	"chat.members.manage": Sensitive, "chat.retention.manage": Sensitive, "data.export": Sensitive,
	"fleet.driver_transfers.approve": Sensitive, "forms.publish_public": Sensitive,
	"knowledge.access.manage": Sensitive, "knowledge.automation.manage": Sensitive,
	"knowledge.members.manage": Sensitive, "members.invite": Sensitive,
	"members.manage": Sensitive, "modules.settings.manage": Sensitive, "org_units.manage": Sensitive,
	"roles.assign": Sensitive, "roles.manage": Sensitive, "tasks.automation.manage": Sensitive,
	"tasks.members.manage": Sensitive,

	"cash.payroll.post": Restricted, "cash.reports.finance": Restricted, "chat.audit.read": Restricted,
	"chat.pdn.read": Restricted, "fleet.earnings.manage": Restricted,
	"fleet.earnings.read": Restricted, "repairs.estimates.edit": Restricted, "repairs.finance.read": Restricted,
}

// Sensitivity returns the level of an action.
func Sensitivity(action string) string {
	if s, ok := sensitivity[action]; ok {
		return s
	}
	return Normal
}

// MaxSensitivity returns the highest level of actions.
func MaxSensitivity(actions []string) string {
	out := Normal
	for _, a := range actions {
		switch Sensitivity(a) {
		case Restricted:
			return Restricted
		case Sensitive:
			out = Sensitive
		}
	}
	return out
}

// SplitSensitivity returns the sensitive and the restricted actions of actions, in their order.
func SplitSensitivity(actions []string) (sensitive, restricted []string) {
	for _, a := range actions {
		switch Sensitivity(a) {
		case Sensitive:
			sensitive = append(sensitive, a)
		case Restricted:
			restricted = append(restricted, a)
		}
	}
	return sensitive, restricted
}
