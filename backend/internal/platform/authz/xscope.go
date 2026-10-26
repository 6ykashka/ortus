package authz

import "slices"

// admission is how an operation's x-scope admits grants at the gateway, before the handler knows the object.
type admission struct {
	kinds     []string // scope kinds whose grants count
	any       bool     // the handler checks the owning object (files, datasets): grants of every kind count
	ownerOnly bool     // only an owner (x-scope tenant-owner)
}

var (
	tenantOnly  = []string{KindTenant}
	territorial = []string{KindTenant, KindUnit}
	withSelf    = []string{KindTenant, KindUnit, KindSelf}
	withProject = []string{KindTenant, KindUnit, KindProject}
	projectSelf = []string{KindTenant, KindUnit, KindProject, KindSelf}
)

// xScopes maps every x-scope of tenant operations (catalog.Operations) to its admission; TestEveryTenant-
// OperationScopeIsKnown keeps it complete. «assigned», «assigned-driver», «assigned-foreman» are relations of the
// subject to the object, the kind self; «*-manager-or-owner» — a responsible manager (tenant or unit) or the
// owner; «account» — a cash account (W4.01). The kinds of stages 4–7 count only where an x-scope names them (PD-53).
var xScopes = map[string]admission{
	"tenant":                                   {kinds: tenantOnly},
	"tenant-owner":                             {ownerOnly: true},
	"tenant-owner-or-billing-manager":          {kinds: tenantOnly},
	"tenant-or-org-unit":                       {kinds: territorial},
	"tenant-org-unit":                          {kinds: territorial},
	"tenant-org-unit-self":                     {kinds: withSelf},
	"tenant-org-unit-assigned-driver":          {kinds: withSelf},
	"tenant-org-unit-project":                  {kinds: withProject},
	"tenant-org-unit-project-self":             {kinds: projectSelf},
	"tenant-org-unit-project-assigned":         {kinds: projectSelf},
	"tenant-org-unit-project-assigned-foreman": {kinds: projectSelf},
	"tenant-org-unit-resource-pool":            {kinds: []string{KindTenant, KindUnit, KindResource}},
	"tenant-org-unit-warehouse":                {kinds: []string{KindTenant, KindUnit, KindWarehouse}},
	"tenant-org-unit-account":                  {kinds: []string{KindTenant, KindUnit, KindAccount}},
	"tenant-org-unit-account-self":             {kinds: []string{KindTenant, KindUnit, KindAccount, KindSelf}}, // W5.00: подотчёт — «своё»
	// W6.00: «Ремонт и стройка» — объект ремонта (repair_project, RS-08; project остаётся за «Задачами») и связь с
	// записью: прораб объекта, менеджер заявки, замерщик (Q-W4.00-repair-2, PD-53).
	"tenant-org-unit-repair-project": {kinds: []string{KindTenant, KindUnit, KindRepairProject, KindRelation}},
	// W4.04: «База знаний» — узел и пространство: роли области (и «своё» — открытые пространства всей организации,
	// Q-W4.00-knowledge-15), роли пространства и страницы, связь; управление пространством — роли области и
	// пространства.
	"knowledge-space-node": {kinds: []string{KindTenant, KindUnit, KindSelf, KindProject, KindSpace, KindPage, KindRelation}},
	"knowledge-space":      {kinds: []string{KindTenant, KindUnit, KindSpace}},
	// W7.00: «Чаты» — роли области, чата и связь с записью; «Документы» — роли области, папки, документа и связь;
	// «Обращения» — направление есть служебный проект задач (RS-08): роли области и проекта. Публичный контур и
	// межсервисный callback идут без сессии (security: []), в шлюз ролей не попадают: записи для полноты каталога.
	"chat":                              {kinds: []string{KindTenant, KindUnit, KindChat, KindRelation, KindSelf}},
	"docs-folder-doc":                   {kinds: []string{KindTenant, KindUnit, KindFolder, KindDoc, KindRelation, KindSelf}},
	"docs-server-callback":              {kinds: tenantOnly},
	"service-direction":                 {kinds: withProject},
	"public-service-capability":         {kinds: tenantOnly},
	"public-doc-link-capability":        {kinds: tenantOnly},
	"responsible-manager-or-owner":      {kinds: territorial},
	"responsible-manager-or-owner-only": {kinds: territorial},
	"source-manager-or-owner":           {kinds: territorial},
	"target-manager-or-owner":           {kinds: territorial},
	"source-or-target-manager-owner":    {kinds: territorial},
	"owning-object-scope":               {any: true},
	"owning-object-and-field-scope":     {any: true},
	"effective-module-and-field-scopes": {any: true},
}

// admissionOf returns the admission of an x-scope; an unknown one admits tenant grants only (fail-closed).
func admissionOf(xScope string) admission {
	if a, ok := xScopes[xScope]; ok {
		return a
	}
	return admission{kinds: tenantOnly}
}

// admits reports whether grants of kind count for the operation.
func (a admission) admits(kind string) bool { return a.any || slices.Contains(a.kinds, kind) }
