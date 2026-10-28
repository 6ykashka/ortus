package repairs

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"math/big"
	"strings"

	"github.com/google/uuid"
)

// Actions of step 6.3 (api/permissions.yaml).
const (
	actChanges = "repairs.changes.submit"
	actMeasure = "repairs.measurements.edit"
	actDocSend = "repairs.documents.send"
)

// Limits of the stored numbers: Money of the contract is within the integer range of JSON, a quantity is numeric(14, 3).
const (
	maxMoney int64 = 9_007_199_254_740_991
	maxQty   milli = 99_999_999_999_999
	currency       = "RUB"
)

// micro is a value in millionths: an area is the product of two quantities in thousandths.
type micro int64

// room is a room of the measurement as it is stored (repairs.measurements.rooms): the sizes are in thousandths of a metre.
type room struct {
	ID         uuid.UUID `json:"id"`
	Name       string    `json:"name"`
	LengthM    milli     `json:"lengthM"`
	WidthM     milli     `json:"widthM"`
	HeightM    milli     `json:"heightM"`
	OpeningsM2 milli     `json:"openingsM2"`
	Wet        bool      `json:"wet"`
}

// totals are the sums of the measurement the formulas of a template take; the wet rooms («санузел…») are counted apart.
type totals struct {
	floor, walls, perimeter          micro
	wetFloor, wetWalls, wetPerimeter micro
}

// wetByName is the default of a room that does not say whether it is wet: the prototype takes the rooms called
// «санузел…» (the regular expression ^санузел of the formulas).
func wetByName(name string) bool {
	return strings.HasPrefix(strings.ToLower(strings.TrimSpace(name)), "санузел")
}

// measureRooms sums the floor, the walls (the perimeter by the height less the openings, never below zero) and the
// perimeter of the rooms; the wet ones are summed again apart.
func measureRooms(rooms []room) totals {
	var t totals
	for _, r := range rooms {
		floor := micro(int64(r.LengthM) * int64(r.WidthM))
		perimeter := 2 * (int64(r.LengthM) + int64(r.WidthM)) // thousandths
		walls := micro(max(0, perimeter*int64(r.HeightM)-int64(r.OpeningsM2)*1000))
		t.floor += floor
		t.walls += walls
		t.perimeter += micro(perimeter * 1000)
		if r.Wet {
			t.wetFloor += floor
			t.wetWalls += walls
			t.wetPerimeter += micro(perimeter * 1000)
		}
	}
	return t
}

// formulas are the formulas of the volumes of a template (api: TemplateLine.formula).
var formulas = []string{"floor", "floor_dry", "walls", "walls_dry", "wet", "perimeter", "perimeter_dry"}

// formulaValue is the volume a formula takes from the measurement.
func formulaValue(f string, t totals) (micro, bool) {
	switch f {
	case "floor":
		return t.floor, true
	case "floor_dry":
		return t.floor - t.wetFloor, true
	case "walls":
		return t.walls, true
	case "walls_dry":
		return t.walls - t.wetWalls, true
	case "wet":
		return t.wetFloor + t.wetWalls, true
	case "perimeter":
		return t.perimeter, true
	case "perimeter_dry":
		return t.perimeter - t.wetPerimeter, true
	}
	return 0, false
}

// roundsUp lists the units counted in whole pieces: pieces, bags, trips, sets and liters round up, the rest to a tenth.
func roundsUp(unit string) bool {
	switch unit {
	case unitPiece, unitMesh, unitTrip, unitSet, unitLiter:
		return true
	}
	return false
}

// volume is the quantity of a line «из замера»: the value of the formula by the coefficient, in whole units for the
// pieces and to a tenth (half up) for the rest (design/docs/19, «Формулы объёмов»). An unknown formula gives zero; a
// volume beyond the column is returned as maxQty+1 for the caller to refuse.
func volume(formula string, coef milli, unit string, t totals) milli {
	v, ok := formulaValue(formula, t)
	if !ok || v <= 0 {
		return 0
	}
	x := new(big.Int).Mul(big.NewInt(int64(v)), big.NewInt(int64(coef))) // thousandths of millionths
	var out *big.Int
	if roundsUp(unit) {
		out = x.Add(x, big.NewInt(999_999_999)).Div(x, big.NewInt(1_000_000_000))
		out.Mul(out, big.NewInt(1000))
	} else {
		out = x.Add(x, big.NewInt(50_000_000)).Div(x, big.NewInt(100_000_000))
		out.Mul(out, big.NewInt(100))
	}
	if !out.IsInt64() || out.Int64() > int64(maxQty) {
		return maxQty + 1
	}
	return milli(out.Int64())
}

// lineSum is the sum of a line: the price in kopecks by the quantity, rounded half up. ok is false beyond the integer
// range of the contract.
func lineSum(price int64, qty milli) (int64, bool) {
	x := new(big.Int).Mul(big.NewInt(price), big.NewInt(int64(qty)))
	x.Add(x, big.NewInt(500)).Div(x, big.NewInt(1000))
	if !x.IsInt64() || x.Int64() > maxMoney {
		return 0, false
	}
	return x.Int64(), true
}

// estimateTotal sums the lines and takes the discount (percent of the sum, half up).
func estimateTotal(sums []int64, pct int) (sub, discount, total int64) {
	for _, s := range sums {
		sub += s
	}
	q, r := sub/100, sub%100
	discount = q*int64(pct) + (r*int64(pct)+50)/100
	return sub, discount, sub - discount
}

// lineVer is a line of a version as the comparison reads it.
type lineVer struct {
	key        uuid.UUID
	name       string
	qty        milli
	price, sum int64
}

// diffRow is a row of the comparison: a line of the version a, of the version b or of both.
type diffRow struct {
	change string // added | removed | changed | same
	a, b   *lineVer
}

func (d diffRow) name() string {
	if d.b != nil {
		return d.b.name
	}
	return d.a.name
}

// delta is the change of the sum of the line from a to b.
func (d diffRow) delta() int64 {
	var from, to int64
	if d.a != nil {
		from = d.a.sum
	}
	if d.b != nil {
		to = d.b.sum
	}
	return to - from
}

// diffLines compares two versions by the key of the line: what is only in a is removed, what is only in b is added, a
// changed volume or price is changed. A replaced position has another key: «убрано» plus «добавлено» (design/docs/19).
// The rows follow the order of a, the added ones follow in the order of b.
func diffLines(a, b []lineVer) []diffRow {
	inB := make(map[uuid.UUID]*lineVer, len(b))
	for i := range b {
		inB[b[i].key] = &b[i]
	}
	inA := make(map[uuid.UUID]bool, len(a))
	rows := make([]diffRow, 0, len(a)+len(b))
	for i := range a {
		inA[a[i].key] = true
		l, ok := inB[a[i].key]
		switch {
		case !ok:
			rows = append(rows, diffRow{"removed", &a[i], nil})
		case l.qty != a[i].qty || l.price != a[i].price:
			rows = append(rows, diffRow{"changed", &a[i], l})
		default:
			rows = append(rows, diffRow{"same", &a[i], l})
		}
	}
	for i := range b {
		if !inA[b[i].key] {
			rows = append(rows, diffRow{"added", nil, &b[i]})
		}
	}
	return rows
}

// signCodeDigits is the length of the code of a signature by SMS; signRetries the wrong codes that put it out;
// signTTLMinutes its life (Q-W6.12-4).
const (
	signCodeDigits = 6
	signRetries    = 5
	signTTLMinutes = 10
)

// newSignCode draws a code of six digits from r without a bias: a draw above the greatest multiple of a million is
// thrown away.
func newSignCode(r io.Reader) (string, error) {
	const limit = 4_294_000_000 // the greatest multiple of 10^6 within 2^32
	var b [4]byte
	for range 16 {
		if _, err := io.ReadFull(r, b[:]); err != nil {
			return "", fmt.Errorf("repairs: sign code: %w", err)
		}
		n := uint64(b[0])<<24 | uint64(b[1])<<16 | uint64(b[2])<<8 | uint64(b[3])
		if n < limit {
			return fmt.Sprintf("%0*d", signCodeDigits, n%1_000_000), nil
		}
	}
	return "", errors.New("repairs: sign code: the source of randomness is biased")
}

// signHash is what the database keeps of a code: HMAC-SHA256 with the key of the server over the document and the code
// (the code of one document does not sign another).
func signHash(key []byte, doc uuid.UUID, code string) string {
	m := hmac.New(sha256.New, key)
	m.Write([]byte(doc.String() + ":" + code))
	return hex.EncodeToString(m.Sum(nil))
}

// signMatches compares a code with the hash in constant time.
func signMatches(key []byte, doc uuid.UUID, code, hash string) bool {
	if hash == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(signHash(key, doc, code)), []byte(hash)) == 1
}

// maskPhone is the phone the code went to, shown to the office: «+7 *** ***-11-22».
func maskPhone(phone string) string {
	var d []byte
	for _, c := range []byte(phone) {
		if c >= '0' && c <= '9' {
			d = append(d, c)
		}
	}
	if len(d) < 5 {
		return "***"
	}
	if d[0] == '8' && len(d) == 11 {
		d[0] = '7'
	}
	n := len(d)
	return "+" + string(d[0]) + " *** ***-" + string(d[n-4:n-2]) + "-" + string(d[n-2:])
}

// agreementTitle is the name of the document of an additional agreement: «Допсоглашение № 2 · ДР-1, ДР-3».
func agreementTitle(no int, changes []int) string {
	title := fmt.Sprintf("Допсоглашение № %d", no)
	if len(changes) == 0 {
		return title
	}
	parts := make([]string, len(changes))
	for i, n := range changes {
		parts[i] = fmt.Sprintf("ДР-%d", n)
	}
	return title + " · " + strings.Join(parts, ", ")
}
