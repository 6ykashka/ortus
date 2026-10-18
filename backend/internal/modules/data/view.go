package data

import (
	"slices"

	dataapi "github.com/ortus/ortus-crm/backend/internal/api/data"
)

// view is a dataset as one member sees it: its visible fields, the labels of the closed ones, the export flag and the
// permission version of the tenant.
type view struct {
	module  string
	spec    Spec
	fields  []Field  // visible fields in the order of the catalog
	hidden  []string // labels of the fields closed by the rights of the member
	export  bool     // data.export and the dataset permission
	version string   // access.policy_state.policy_version
}

// field returns the visible field key.
func (v view) field(key string) (Field, bool) {
	i := slices.IndexFunc(v.fields, func(f Field) bool { return f.Key == key })
	if i < 0 {
		return Field{}, false
	}
	return v.fields[i], true
}

// Operators of the fields by value type (MSW W2.51, example listDatasets/ok); a nullable field adds is_null.
var (
	textOperators = []dataapi.FieldDescriptorFilterOperators{
		dataapi.FieldDescriptorFilterOperatorsEq, dataapi.FieldDescriptorFilterOperatorsNe,
		dataapi.FieldDescriptorFilterOperatorsIn, dataapi.FieldDescriptorFilterOperatorsContains,
	}
	choiceOperators = []dataapi.FieldDescriptorFilterOperators{
		dataapi.FieldDescriptorFilterOperatorsEq, dataapi.FieldDescriptorFilterOperatorsNe, dataapi.FieldDescriptorFilterOperatorsIn,
	}
	orderedOperators = []dataapi.FieldDescriptorFilterOperators{
		dataapi.FieldDescriptorFilterOperatorsEq, dataapi.FieldDescriptorFilterOperatorsNe,
		dataapi.FieldDescriptorFilterOperatorsLt, dataapi.FieldDescriptorFilterOperatorsLte,
		dataapi.FieldDescriptorFilterOperatorsGt, dataapi.FieldDescriptorFilterOperatorsGte,
	}
	// aggregations are the functions of every dataset of stage 2.
	aggregations = []dataapi.DatasetAllowedAggregations{
		dataapi.DatasetAllowedAggregationsCount, dataapi.DatasetAllowedAggregationsSum, dataapi.DatasetAllowedAggregationsAvg,
		dataapi.DatasetAllowedAggregationsMin, dataapi.DatasetAllowedAggregationsMax,
	}
)

// operators returns the filter operators of f.
func operators(f Field) []dataapi.FieldDescriptorFilterOperators {
	var ops []dataapi.FieldDescriptorFilterOperators
	switch f.Type {
	case Text:
		ops = slices.Clone(textOperators)
	case Choices:
		ops = slices.Clone(choiceOperators)
	case Decimal, Money, Date:
		ops = slices.Clone(orderedOperators)
	}
	if f.Nullable {
		ops = append(ops, dataapi.FieldDescriptorFilterOperatorsIsNull)
	}
	return ops
}

// aggregatable reports whether sum, avg, min and max apply to f.
func aggregatable(f Field) bool { return f.Type == Decimal || f.Type == Money }

func descriptor(f Field) dataapi.FieldDescriptor {
	d := dataapi.FieldDescriptor{
		Key: f.Key, Label: f.Label, ValueType: dataapi.FieldDescriptorValueType(f.Type), Nullable: f.Nullable,
		FilterOperators: operators(f), Sortable: true, Aggregatable: aggregatable(f),
		Sensitivity: dataapi.FieldDescriptorSensitivity(SensitivityStandard),
	}
	if f.Sensitivity != "" {
		d.Sensitivity = dataapi.FieldDescriptorSensitivity(f.Sensitivity)
	}
	if len(f.Options) > 0 {
		opts := make([]dataapi.ChoiceOption, 0, len(f.Options))
		for _, o := range f.Options {
			opts = append(opts, dataapi.ChoiceOption{Key: o.Key, Label: o.Label})
		}
		d.Options = &opts
	}
	return d
}

// dataset is the Dataset of the catalog of the member.
func (v view) dataset() dataapi.Dataset {
	fields := make([]dataapi.FieldDescriptor, 0, len(v.fields))
	for _, f := range v.fields {
		fields = append(fields, descriptor(f))
	}
	hidden := append([]string{}, v.hidden...)
	sorts := make([]dataapi.QuerySort, 0, len(v.spec.DefaultSort))
	for _, s := range v.spec.DefaultSort {
		sorts = append(sorts, dataapi.QuerySort{FieldKey: s.Field, Direction: direction(s.Desc)})
	}
	perm, entity, export := v.spec.Permission, v.spec.EntityType, v.export
	return dataapi.Dataset{
		Id: v.spec.ID, ModuleKey: v.module, Name: v.spec.Name, Fields: fields, AllowedAggregations: slices.Clone(aggregations),
		PermissionVersion: v.version, PermissionKey: &perm, EntityType: &entity, ExportAllowed: &export,
		HiddenFieldLabels: &hidden, DefaultSort: &sorts,
	}
}

func direction(desc bool) dataapi.QuerySortDirection {
	if desc {
		return dataapi.Desc
	}
	return dataapi.Asc
}
