package main

import (
	dataapi "github.com/ortus/ortus-crm/backend/internal/api/data"
	"github.com/ortus/ortus-crm/backend/internal/modules/data"
	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/csv"
)

// withExport overlays the CSV export of W2.50 on the server of the tag Data (exportDataset, D-11 комплекта «выгрузка
// CSV расходов и рейсов», fleet/csv): the catalog comes from base, the rows from the same service whose evaluator
// narrows the scope of the dataset permission by the scope of data.export.
func withExport(base data.Server) dataapi.StrictServerInterface {
	rows := *base.S
	rows.Authz = csv.ExportScope{Scoper: base.S.Authz}
	return csv.NewDataServer(base, &csv.Export{Catalog: base, Rows: data.Server{S: &rows}, Pools: base.S.Pools, Now: base.S.Now})
}
