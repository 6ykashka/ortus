package main

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	spaapi "github.com/ortus/ortus-crm/backend/internal/api/spa"
	"github.com/ortus/ortus-crm/backend/internal/modules/cash"
	"github.com/ortus/ortus-crm/backend/internal/modules/inventory"
	spamodule "github.com/ortus/ortus-crm/backend/internal/modules/spa"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
)

// visitOffers hands the price of a completed visit to the proposals of the cash desks in the transaction of the
// completion (CASH-03): «visit:<id>» is the key of idempotency, an offer repeated is dropped by the cash desk, and
// nothing moves until a person posts the proposal.
type visitOffers struct{ cash *cash.Service }

// OfferVisit implements spamodule.CashOffers.
func (o visitOffers) OfferVisit(ctx context.Context, tx pgx.Tx, v spamodule.VisitOffer) error {
	label := "Визит"
	_, err := o.cash.Offer(ctx, tx, cash.Offer{Key: "visit:" + v.AppointmentID.String(), Kind: "visit", Title: v.Title, Amount: v.AmountMinor,
		Direction: "in", SourceKind: "appointment", SourceID: v.AppointmentID, SourceLabel: &label})
	return err
}

// newSpa is the server of the tag Spa (W5.20, contract 0.12.0-stage5): services with their recipes, visits booked on the
// practitioner, the room and the equipment with the buffers of the service (sched.bookings), the fact of the treatment
// apart from the accounting, and the one-time consumption of the recipe from the stock in the transaction of the
// completion — over the tenant pools (tenant 0044), the evaluator of W1.04 (scopes unit and self, the warehouse of the
// consumption), the stock of W5.10, the proposals of the cash desks of W5.31 and the clock of the application
// (APP_FIXED_NOW outside prod).
func newSpa(pools spamodule.Pools, ev *authz.Evaluator, now func() time.Time) spaapi.StrictServerInterface {
	stock := &inventory.Service{Pools: pools, Authz: ev, Now: now}
	offers := visitOffers{cash: &cash.Service{Pools: pools, Authz: ev, Now: now}}
	return spamodule.Server{S: &spamodule.Service{Pools: pools, Authz: ev, Stock: stock, Offers: offers, Now: now}}
}
