// Package inventory is the stock of «Склад и материалы» (W5.10, D-20 of the kit): warehouses of org units, the
// nomenclature with its base unit and optional lots, lots with an expiry date, immutable movements (receipt, issue,
// transfer, adjustment, reversal), reservations for source objects and FEFO — an issue without a lot takes the lots
// with the earliest expiry first, lots without expiry last, and never an expired lot. The stock never goes below
// zero; a mistake is corrected by a reversal (once). Quantities are exact: millionths of the base unit as integers,
// numeric(18, 6) in tenant 0043.
//
// Access: inventory.items.read (warehouses, items, balances), inventory.movements.read (movements, reservations),
// inventory.movements.post (every posting and reservation; adjustments and reversals also need
// inventory.consumption.override, Q-W5.10-1), inventory.items.manage and inventory.warehouses.manage over the unit.
// A grant on a warehouse (scope kind warehouse) reaches that warehouse; a grant on a unit reaches its warehouses and
// items. A warehouse out of the scope answers like a missing one (404, AC-01).
//
// Every command is one transaction of the tenant DB with the warehouses locked in id order; the outcome of a command
// under an Idempotency-Key is stored with it. Consumers of stock — the visit of SPA (W5.20) and the supply of repairs
// (W6.13) — post movements and reservations with their object as the source.
package inventory
