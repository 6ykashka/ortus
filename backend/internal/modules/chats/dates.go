package chats

import (
	"time"

	openapi_types "github.com/oapi-codegen/runtime/types" //nolint:depguard // the date type of the generated contract (format: date): no other way to build it
)

// apiDate is a date of the contract (a field of format date).
type apiDate = openapi_types.Date

// dateOf makes the date of the contract from an instant.
func dateOf(t time.Time) *apiDate { return &apiDate{Time: t} }
