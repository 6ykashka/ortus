package inventory

import (
	"cmp"
	"errors"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Qty is a quantity in millionths of the base unit: numeric(18, 6) of tenant 0043 as an exact integer (no float).
type Qty int64

const microUnit = 1_000_000

// quantityRE is Quantity of the contract (a nonnegative decimal, at most six digits after the point) with the
// integer part cut to what numeric(18, 6) holds: twelve digits.
var quantityRE = regexp.MustCompile(`^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$`)

// ErrQuantity is a text that is not a quantity.
var ErrQuantity = errors.New("inventory: not a quantity")

// ParseQuantity reads a quantity of the contract exactly.
func ParseQuantity(s string) (Qty, error) {
	if !quantityRE.MatchString(s) {
		return 0, ErrQuantity
	}
	whole, frac, _ := strings.Cut(s, ".")
	w, err := strconv.ParseInt(whole, 10, 64)
	if err != nil {
		return 0, ErrQuantity
	}
	var f int64
	if frac != "" {
		if f, err = strconv.ParseInt((frac + "000000")[:6], 10, 64); err != nil {
			return 0, ErrQuantity
		}
	}
	return Qty(w*microUnit + f), nil
}

// String is the quantity as the contract writes it: no trailing zeros, no point for a whole number.
func (q Qty) String() string {
	whole, frac := int64(q)/microUnit, int64(q)%microUnit
	if frac == 0 {
		return strconv.FormatInt(whole, 10)
	}
	f := strings.TrimRight(strconv.FormatInt(frac+microUnit, 10)[1:], "0")
	return strconv.FormatInt(whole, 10) + "." + f
}

// Lot is a lot of an item in a warehouse with what may still be taken from it (on hand minus reserved).
type Lot struct {
	ID         uuid.UUID // uuid.Nil: stock of an item without lots
	ExpiresOn  *time.Time
	ReceivedAt time.Time
	Available  Qty
}

// Take is a quantity taken from a lot of an item.
type Take struct {
	Item  uuid.UUID
	LotID uuid.UUID
	Qty   Qty
}

// Refusals of the allocation (409 invalid_transition with the reason).
var (
	ErrInsufficient = errors.New("inventory: insufficient stock")
	ErrLotExpired   = errors.New("inventory: lot expired")
)

// compareFEFO orders lots for taking: by expiry (none last), then by receipt, then by id.
func compareFEFO(a, b Lot) int {
	switch {
	case a.ExpiresOn == nil && b.ExpiresOn != nil:
		return 1
	case a.ExpiresOn != nil && b.ExpiresOn == nil:
		return -1
	case a.ExpiresOn != nil && !a.ExpiresOn.Equal(*b.ExpiresOn):
		return a.ExpiresOn.Compare(*b.ExpiresOn)
	}
	if c := a.ReceivedAt.Compare(b.ReceivedAt); c != 0 {
		return c
	}
	return cmp.Compare(a.ID.String(), b.ID.String())
}

// AllocateFEFO takes want from lots in the order of D-20: the earliest expiry first, lots without expiry last, then the
// earliest received and the lowest id (a stable order). A lot is good through its expiry date; a lot that expired
// before today is left alone (a zero today leaves none): when only the expired lots cover the rest, the refusal is
// ErrLotExpired, otherwise ErrInsufficient.
func AllocateFEFO(lots []Lot, today time.Time, want Qty) ([]Take, error) {
	sorted := slices.Clone(lots)
	slices.SortFunc(sorted, compareFEFO)
	var (
		takes      []Take
		left       = want
		expiredSum Qty
	)
	for _, l := range sorted {
		if l.Available <= 0 {
			continue
		}
		if l.ExpiresOn != nil && l.ExpiresOn.Before(today) {
			expiredSum += l.Available
			continue
		}
		if left == 0 {
			continue
		}
		n := min(l.Available, left)
		takes = append(takes, Take{LotID: l.ID, Qty: n})
		left -= n
	}
	switch {
	case left == 0:
		return takes, nil
	case expiredSum >= left:
		return nil, ErrLotExpired
	}
	return nil, ErrInsufficient
}

// Totals sums the quantities of takes by item.
func Totals(takes []Take) map[uuid.UUID]Qty {
	out := map[uuid.UUID]Qty{}
	for _, t := range takes {
		out[t.Item] += t.Qty
	}
	return out
}
