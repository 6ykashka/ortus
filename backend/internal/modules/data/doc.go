// Package data is «Данные» of the core (W2.08, S2-16, AC-14): the registry of the datasets the modules provide and
// the typed query of the tag Data (listDatasets, queryDataset) over them.
//
// A module registers a Provider with its datasets (Spec): the rows of a dataset are a SQL source of the tenant DB with
// the columns the scope of the dataset permission filters on, and its fields are SQL expressions over that source. The
// engine never takes SQL from a request: field keys, operators and functions of a query are checked against the
// fields the member may see, values are parameters, and the scope predicate of the evaluator (scopeddb, {{scope}})
// limits the rows before filters, search, sort, grouping and pages. A field closed by the rights of the member
// (Field.Restricted) is not in the catalog of the member — only its label is (hiddenFieldLabels) — and a query naming
// it gets the same 422 as an unknown field.
package data
