// Package csv holds the cheap substitutes of the integrations of stage 2 (W2.50, D-11 комплекта, ADR 0012: «ни
// одной интеграции в S2 — импорт CSV машин, выгрузка CSV расходов и рейсов, deeplink навигатора»).
//
// The CSV import of vehicles (createVehicleImport, getVehicleImport, commitVehicleImport) follows the import of
// people (W1.05, S1-10): the file is parsed and every row is checked without changing data, the preview lives a day,
// the commit checks the rows again against the current data and the scope of fleet.vehicles.manage of the actor and
// applies them in one transaction by If-Match. A company outside the scope and an unknown one are the same row error,
// a vehicle outside the scope is a row error that names neither the vehicle nor its company (Q-W2.52-17). The first
// period of fleet.vehicle_assignments of a new vehicle is opened by the database (Q-W2.52-19).
//
// The CSV export (exportDataset of the tag Data) reads the rows of a dataset by pages of queryDataset of W2.08 with
// the scope of the dataset permission narrowed by the scope of data.export, and writes the file of the contract:
// «;», CRLF, RFC 4180, labels of choices, a decimal comma, ДД.ММ.ГГГГ and an apostrophe before a formula only in
// text cells (Q-W2.52-11, Q-W2.52-18).
package csv
