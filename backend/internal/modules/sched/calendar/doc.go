// Package calendar is the calendar of resources (W4.40, CAL-01…05; contract 0.7.0-stage4 of W4.06, tag Calendar;
// prototype pg.calendar, calVM, busySpan, bookingConflicts, freeSlots, moveBooking): the resources of a tenant
// (sched.resources — members, rooms, vehicles, equipment, tenant 0021), the bookings of a day or a week
// (sched.bookings with their reservations in sched.reservations), the reschedule that rechecks every resource of a
// booking with its buffers in one transaction, and the free slots for all resources of a booking.
//
// Visibility follows the descriptions of the contract and the mock (msw/calendar): a resource is seen through
// calendar.bookings.read over its org unit, self — the own resource of the member and the resources booked together
// with it; a vehicle only while the module fleet is active and with fleet.vehicles.read over it. A booking of a module
// (a trip, a visit) is listed only when the member may read its object; it keeps its resources busy for conflicts and
// slots anyway, and a conflict never names it then. The holds of logistics (bundles of sched.reservations of W2.02
// without a row in sched.bookings) are projected into the calendar as bookings of a trip.
//
// Every request runs in one transaction of the tenant DB of the request (AC-02) and the evaluator of W1.04 reads
// through it (authz.TxSource, W1.47): the reschedule locks the booking, then its resources in the order of their ids,
// the order of sched.Hold, so it queues behind a hold of logistics instead of deadlocking.
package calendar
