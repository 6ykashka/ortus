// Package trips is the trip of a driver (W2.05, S2-06, S2-07, S2-09): the start by the reservation (startTrip — one
// online transaction consumes the hold of sched, D-09), the started trip (getTrip, listTrips), «Завершить рейс»
// (finishTripRoute) and «Сдать машину» (returnTrip). The trip card (getTripPlan, listTripPlans) is served by W2.03
// (fleet/routes); Service.Plan projects the same TripPlan for Trip.plan and the answers of the commands.
//
// A trip is one fleet.trips row in any state: the TripPlan of the contract 0.5.0-stage2 projects it from planning to
// acceptance, the 0.1 Trip from the start on, with the same id, revision and ETag. Reads go through scopeddb with the
// scope of fleet.trips.read (the unit of the trip, or «own» — its driver); a member with the work function «Водитель»
// sees and drives only his trips. Commands lock in the order of Q-W2.04-18 (inspection → trip → reservation) and check
// access with the evaluator over their own transaction (authz.TxSource), so a command holds one connection at most.
package trips
