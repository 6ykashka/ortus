package main

import (
	"time"

	"github.com/google/uuid"
)

// scopePlatform is the id scope of control DB entities; tenant entities use the prototype tenant id
// (t-alta, t-lotos): «ID участников намеренно совпадают… идентификаторы живут внутри своей БД» (mock-data.js:41).
const scopePlatform = "platform"

// Prototype ids and statuses used across the data files.
const (
	protoAlta  = "t-alta"
	protoLotos = "t-lotos"
	regionMsk  = "r-msk"
	stActive   = "active"
	stInvited  = "invited"
)

// seedID is the deterministic UUID of a prototype entity (PD-30): UUID v5 in the RFC 4122 URL namespace
// of the name «ortus:<scope>:<prototype id>». Synthetic entities (operator accounts, memberships, sentinels)
// use a «<kind>:…» prototype id, e.g. «membership:t-alta:acc-1».
func seedID(scope, proto string) uuid.UUID {
	return uuid.NewSHA1(uuid.NameSpaceURL, []byte("ortus:"+scope+":"+proto))
}

// msk is the prototype clock zone (Europe/Moscow, UTC+3 without DST).
var msk = time.FixedZone("MSK", 3*60*60)

// protoTime parses the prototype «DD.MM HH:MM» (year 2026, MSK); "" → nil.
func protoTime(s string) *time.Time {
	if s == "" {
		return nil
	}
	t, err := time.ParseInLocation("02.01 15:04", s, msk)
	if err != nil {
		panic("seed: bad prototype time " + s) // data is compiled in; covered by tests
	}
	t = t.AddDate(2026-t.Year(), 0, 0)
	return &t
}
