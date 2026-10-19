package data

import "github.com/ortus/ortus-crm/backend/internal/platform/authz"

// ValueType is the type of the values of a field (FieldDescriptor.valueType of the contract).
type ValueType string

// Value types of the datasets of stage 2.
const (
	Text    ValueType = "text"    // SQL text
	Decimal ValueType = "decimal" // SQL numeric, exact
	Money   ValueType = "money"   // SQL bigint in minor units, with Field.Currency
	Date    ValueType = "date"    // SQL date
	Choices ValueType = "choices" // SQL text: the code of one of Field.Options
)

// Sensitivities of a field (FieldDescriptor.sensitivity).
const (
	SensitivityStandard  = "standard"
	SensitivityFinancial = "financial"
	SensitivityPersonal  = "personal"
)

// Placeholders of the statements of a Spec: the engine puts the parameters of the request in their place.
const (
	PersonParam = "{{person}}" // the person of the member (uuid; uuid.Nil without a profile)
	NowParam    = "{{now}}"    // the clock of the application (timestamptz)
)

// Option is a code of a choices field with its label.
type Option struct{ Key, Label string }

// Restriction closes a field to the members who do not hold Permission in any scope (the evaluator also closes an
// action blocked by a work function, AC-05). For the others the value of a row is null outside the scope of
// Permission over Columns.
type Restriction struct {
	Permission string
	Columns    authz.Columns
}

// Field is a column of a dataset.
type Field struct {
	Key, Label  string
	Type        ValueType
	Nullable    bool
	Sensitivity string   // "" — standard
	Options     []Option // the codes of a choices field, in the order of the catalog
	// OptionsSQL is a statement over the tenant DB that returns the codes and labels (two text columns) of a choices
	// field whose codes are a catalogue of the tenant, in its order; when set, it replaces Options for every request
	// (W2.41: the expense categories of fleet.expense_categories). Options stay the codes known without the database.
	OptionsSQL string
	// SQL is the expression of the value over the aliases of Spec.From (see ValueType for its SQL type).
	SQL string
	// Currency is the expression of the currency of a money field (ISO 4217 text); "" — 'RUB'.
	Currency   string
	Restricted *Restriction // nil — the field follows the dataset permission
}

// Sort is an order of rows by a field.
type Sort struct {
	Field string
	Desc  bool
}

// Spec is a dataset of a module: what the catalog shows and where its rows come from.
type Spec struct {
	ID, Name   string
	Permission string // the own read permission of the dataset (fleet.trips.read)
	EntityType string // the entity of DatasetRow.recordId
	// From is the FROM clause of the rows (tables, joins and their aliases); Where — a fixed condition or "". Both may
	// use PersonParam and NowParam.
	From, Where string
	Columns     authz.Columns // the columns the scope of Permission filters the rows on
	RecordID    string        // the expression of the id of a row (any type, sent as text)
	Order       []string      // expressions of the stable order of the rows after the sort of a query
	Fields      []Field
	DefaultSort []Sort
}
