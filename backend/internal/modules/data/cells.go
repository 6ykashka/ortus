package data

import (
	"fmt"
	"strconv"
	"time"

	dataapi "github.com/ortus/ortus-crm/backend/internal/api/data"
)

// dateLayout is the text form of a date value (openapi format date).
const dateLayout = "2006-01-02"

// null is the value of an empty cell.
func null() dataapi.FieldValue {
	var v dataapi.FieldValue
	_ = v.FromNullValue(dataapi.NullValue{Type: dataapi.Null}) // a struct of a string and nil always marshals
	return v
}

// cell converts a scanned value of type t to a FieldValue: raw is its text (nil — null), currency the currency of a
// money value (nil for an aggregate over several currencies — the value is null then).
func cell(t ValueType, raw, currency *string) (dataapi.FieldValue, error) {
	if raw == nil || (t == Money && currency == nil) {
		return null(), nil
	}
	var v dataapi.FieldValue
	var err error
	switch t {
	case Text:
		err = v.FromTextValue(dataapi.TextValue{Type: dataapi.TextValueTypeText, Value: *raw})
	case Decimal:
		err = v.FromDecimalValue(dataapi.DecimalValue{Type: dataapi.DecimalValueTypeDecimal, Value: *raw})
	case Choices:
		err = v.FromChoicesValue(dataapi.ChoicesValue{Type: dataapi.ChoicesValueTypeChoices, Value: []string{*raw}})
	case Money:
		var minor int64
		if minor, err = strconv.ParseInt(*raw, 10, 64); err != nil {
			return dataapi.FieldValue{}, fmt.Errorf("data: money %q: %w", *raw, err)
		}
		err = v.FromMoneyValue(dataapi.MoneyValue{Type: dataapi.MoneyValueTypeMoney,
			Value: dataapi.Money{AmountMinor: int(minor), Currency: *currency}})
	case Date:
		var d time.Time
		if d, err = time.Parse(dateLayout, *raw); err != nil {
			return dataapi.FieldValue{}, fmt.Errorf("data: date %q: %w", *raw, err)
		}
		dv := dataapi.DateValue{Type: dataapi.DateValueTypeDate}
		dv.Value.Time = d // openapi_types.Date: depguard keeps the runtime of the generator out of internal/modules
		err = v.FromDateValue(dv)
	default:
		return dataapi.FieldValue{}, fmt.Errorf("data: value type %q", t)
	}
	return v, err
}
