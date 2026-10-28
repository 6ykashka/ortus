package fixtures

import (
	"strconv"
	"time"

	"github.com/google/uuid"
)

// The content of the rows of «Ремонт и стройка» (W6.11, возврат 1): TenantDef.InTenant of tenant A with the foremen and
// their role marked InTenant. Load writes it only WithInTenant — the module repairs is installed in A then and only
// then (the integration tests of the modules count the installed modules and the people of A); tenant B has no module:
// the rows of the gate answer «не подключён у организации B» (repairs_w600_gate.yaml). References resolve always.
//
// Tenant A gets two active objects, each with its foreman (a grant on the object itself, the scope repair_project):
// «Квартира на Лесной» (ObjectRepairProject «flat») and «Дом на Речной» («other»). «Лесная» has a work and a mark on
// acceptance; the foreman of «Речной» sees nothing of it (404 as a missing object, AC-01).

const (
	roleRepairsForeman = "repairs_foreman" // inside
	moduleRepairs      = "repairs"

	actorRepairsForeman    = "a.repairs-foreman"
	actorRepairsForemanTwo = "a.repairs-foreman-two"

	repairsManifest = "0.12" // manifest_version of the module (the gate does not read it)
)

// foremanActions: the foreman of an object reads it and his marks, sends marks, reads and moves the schedule (W6.14); no repairs.finance.read — he sees
// neither the sum of the contract nor the phone of the client (D-17, «прораб без цен»).
var foremanActions = []string{"repairs.projects.read", "repairs.work_logs.read", "repairs.work_logs.submit", "repairs.schedule.read", "repairs.schedule.shift", "repairs.changes.submit", "repairs.measurements.edit"}

// RepairProjectDef is an active repair object (repairs.projects) of an object of the catalog (ObjectRepairProject,
// the key is the one of the object, the id is the one of the reference repair_project:<t>.<key>) with its foreman.
type RepairProjectDef struct {
	Key, Unit, Name, Address string
	Foreman                  string // an actor with a membership in the tenant
	BudgetMinor              int64
	ClientPhone              string
	Work                     *RepairWorkDef // a work of the object with one mark on acceptance
}

// RepairWorkDef is a work of an object with a mark of its foreman on acceptance (repairs.works, repairs.work_logs).
type RepairWorkDef struct {
	Name, Unit string
	PlanQty    float64
	MarkQty    float64
}

// The ids of the work, of the mark and of the photo of an object are derived from its key (contentID); the tests that need them read the DB.
const (
	refRepairWork = "repair_work"
	refRepairLog  = "repair_work_log"
	refRepairShot = "repair_photo"
	refRepairCrew = "repair_worker"
)

// repairsInside is the inside content of tenant A of the rows of repairs.
func repairsInside() []RepairProjectDef {
	return []RepairProjectDef{
		{Key: "flat", Unit: uMsk1, Name: "Квартира на Лесной", Address: "Москва, Лесная, 7", Foreman: actorRepairsForeman,
			BudgetMinor: 120_000_000, ClientPhone: "+7 900 000-11-22",
			Work: &RepairWorkDef{Name: "Штукатурка стен", Unit: "m2", PlanQty: 40, MarkQty: 12}},
		{Key: "other", Unit: uMsk1, Name: "Дом на Речной", Address: "Москва, Речная, 3", Foreman: actorRepairsForemanTwo,
			BudgetMinor: 80_000_000, ClientPhone: "+7 900 000-33-44"},
	}
}

// validateRepairs checks the objects of repairs of the content of t: an object of the catalog, a unit, a foreman who is
// a member of the tenant, a name.
func (c Catalog) validateRepairs(t TenantDef, fail failFunc) {
	for _, p := range t.Content.RepairProjects {
		if !t.hasObject(ObjectRepairProject, p.Key) || !t.hasUnit(p.Unit) || p.Name == "" {
			fail("repair project %s.%s: no object of the catalog, unknown unit or no name", t.Key, p.Key)
		}
		if !c.hasRef(memberRef(refPerson, p.Foreman, t.Key)) {
			fail("repair project %s.%s: foreman %q has no membership in tenant %s", t.Key, p.Key, p.Foreman, t.Key)
		}
	}
}

// repairs installs the module (only when the content has objects) and writes the objects with the works and the marks.
func (l *tenantLoader) repairs() error {
	if len(l.t.Content.RepairProjects) == 0 {
		return nil
	}
	if err := l.exec("module repairs", `insert into modules.installations (module_key, state, manifest_version, updated_by)
		values ($1, 'enabled', $2, $3)`, moduleRepairs, repairsManifest, l.owner); err != nil {
		return err
	}
	at := l.now.Add(-contentAge)
	for i, p := range l.t.Content.RepairProjects {
		id := l.kbObjectID(ObjectRepairProject, p.Key)
		if err := l.exec("repair project "+p.Key, `insert into repairs.projects (id, org_unit_id, name, address, status, foreman_id,
			client_name, client_phone, budget_minor, created_by, created_at, updated_at)
			values ($1, $2, $3, $4, 'active', $5, 'Заказчик', $6, $7, $8, $9, $9)`,
			id, l.unitID(p.Unit), p.Name, p.Address, l.personID(p.Foreman), p.ClientPhone, p.BudgetMinor, l.owner, at); err != nil {
			return err
		}
		if p.Work != nil {
			if err := l.repairWork(i, id, p, at); err != nil {
				return err
			}
		}
	}
	return nil
}

func (l *tenantLoader) repairWork(n int, project uuid.UUID, p RepairProjectDef, at time.Time) error {
	work, logID := l.contentID(refRepairWork, p.Key), l.contentID(refRepairLog, p.Key)
	if err := l.exec("repair work "+p.Key, `insert into repairs.works (id, project_id, name, unit, plan_qty, sort)
		values ($1, $2, $3, $4, $5, 1)`, work, project, p.Work.Name, p.Work.Unit, p.Work.PlanQty); err != nil {
		return err
	}
	if err := l.exec("repair work log "+p.Key, `insert into repairs.work_logs (id, number, project_id, submitted_by, work_date,
		time_zone, status, evidence_file_ids, created_at) values ($1, $2, $3, $4, $5, $6, 'submitted', $7, $8)`,
		logID, "WL-"+strconv.Itoa(9001+n), project, l.personID(p.Foreman), at.Format(time.DateOnly), zoneMoscow,
		[]uuid.UUID{l.contentID(refRepairShot, p.Key)}, at); err != nil {
		return err
	}
	if err := l.exec("repair crew "+p.Key, `insert into repairs.workers (id, project_id, display_name, trade) values ($1, $2, 'Иван', 'Маляр')`,
		l.contentID(refRepairCrew, p.Key), project); err != nil {
		return err
	}
	return l.exec("repair work log line "+p.Key, `insert into repairs.work_log_lines (work_log_id, line_no, work_id, quantity, unit)
		values ($1, 1, $2, $3, $4)`, logID, work, p.Work.MarkQty, p.Work.Unit)
}
