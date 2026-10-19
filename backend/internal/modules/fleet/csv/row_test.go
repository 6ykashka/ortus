package csv

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// validValues is a row of a refrigerated vehicle that passes every static check.
func validValues() map[string]string {
	return map[string]string{
		colPlate: "  Х  101 АМ 77 ", colName: "Ford Transit", colBody: "Рефрижератор", colPayload: "1200,5",
		colVolume: "11,25", colLength: "3,2", colWidth: "1.8", colHeight: "1,9", colOdometer: "1500",
		colTempMin: "-18", colTempMax: "+8", colEquipment: "refrigerator", colDepot: " Склад № 1 ",
	}
}

func TestCheckRecordValid(t *testing.T) {
	t.Parallel()
	p, errs := checkRecord(record{Line: 2, Values: validValues()})
	require.Empty(t, errs)
	assert.Equal(t, "Х 101 АМ 77", p.Plate, "trimmed, inner spaces collapsed")
	assert.Equal(t, "Ford Transit", p.Name)
	assert.Equal(t, "reefer", p.Body, "the body of the table")
	assert.Equal(t, "refrigerated", p.BodyType, "the body of the contract")
	assert.Equal(t, []string{"1200.5", "11.25", "3.2", "1.8", "1.9", "1500"},
		[]string{p.Payload, p.Volume, p.Length, p.Width, p.Height, p.Odometer}, "a decimal comma becomes a point")
	require.NotNil(t, p.TempMin)
	require.NotNil(t, p.TempMax)
	assert.Equal(t, "-18", *p.TempMin)
	assert.Equal(t, "8", *p.TempMax, "a leading plus is dropped")
	require.NotNil(t, p.Depot)
	assert.Equal(t, "Склад № 1", *p.Depot)
}

func TestCheckRecordBodiesAndLabels(t *testing.T) {
	t.Parallel()
	for in, want := range map[string]string{
		"van": "van", "BOX": "box", "flatbed": "flatbed", "refrigerated": "reefer", "tent": "tent",
		"Фургон": "van", "борт": "flatbed", "Рефрижератор": "reefer", "ТЕНТ": "tent",
	} {
		v := validValues()
		v[colBody], v[colTempMin], v[colTempMax], v[colEquipment] = in, "", "", ""
		p, errs := checkRecord(record{Line: 2, Values: v})
		assert.Empty(t, errs, in)
		assert.Equal(t, want, p.Body, in)
	}
}

func TestCheckRecordErrors(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		mut  func(v map[string]string)
		want violation
	}{
		{"пустой госномер", func(v map[string]string) { v[colPlate] = " " },
			violation{colPlate, "required", "Обязательное поле"}},
		{"длинное название", func(v map[string]string) { v[colName] = strings.Repeat("я", 201) },
			violation{colName, "too_long", "Не длиннее 200 символов"}},
		{"неизвестный кузов", func(v map[string]string) { v[colBody] = "Самосвал" },
			violation{colBody, "unknown", "Неизвестный тип кузова"}},
		{"нет объёма", func(v map[string]string) { v[colVolume] = "" },
			violation{colVolume, "required", "Обязательное поле"}},
		{"буквы в длине", func(v map[string]string) { v[colLength] = "3 м" },
			violation{colLength, "format", "Число с точкой или запятой"}},
		{"отрицательный пробег", func(v map[string]string) { v[colOdometer] = "-1" },
			violation{colOdometer, "format", "Число с точкой или запятой"}},
		{"нулевая высота", func(v map[string]string) { v[colHeight] = "0" },
			violation{colHeight, "positive", "Должно быть больше нуля"}},
		{"грузоподъёмность округляется до нуля", func(v map[string]string) { v[colPayload] = "0,04" },
			violation{colPayload, "positive", "Должно быть больше нуля"}},
		{"слишком большой объём", func(v map[string]string) { v[colVolume] = "1000000" },
			violation{colVolume, "too_large", "Слишком большое значение"}},
		{"одна температура", func(v map[string]string) { v[colTempMax] = "" },
			violation{colTempMin, "pair", "Укажите обе температуры или ни одной"}},
		{"нижняя выше верхней", func(v map[string]string) { v[colTempMin], v[colTempMax] = "8", "-18" },
			violation{colTempMin, "order", "Нижняя граница температуры выше верхней"}},
		{"неизвестное оборудование", func(v map[string]string) { v[colEquipment] = "refrigerator|crane" },
			violation{colEquipment, "unknown", "Неизвестное оборудование"}},
		{"гидроборт не хранится", func(v map[string]string) { v[colEquipment] = "tail_lift" },
			violation{colEquipment, "not_stored", textEquipment}},
		{"холодильник без режима", func(v map[string]string) { v[colTempMin], v[colTempMax] = "", "" },
			violation{colEquipment, "not_stored", textEquipment}},
		{"длинная площадка", func(v map[string]string) { v[colDepot] = strings.Repeat("я", 201) },
			violation{colDepot, "too_long", "Не длиннее 200 символов"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			v := validValues()
			c.mut(v)
			_, errs := checkRecord(record{Line: 2, Values: v})
			assert.Contains(t, errs, c.want)
		})
	}
	_, errs := checkRecord(record{Line: 2, Values: validValues(), Extra: true})
	assert.Contains(t, errs, violation{"line", "extra_values", "Лишние значения в строке"})
}

func TestPlateKey(t *testing.T) {
	t.Parallel()
	assert.Equal(t, "А 412 МР 77", plateKey("  а  412 мр 77 "))
	assert.Empty(t, plateKey("   "))
}
