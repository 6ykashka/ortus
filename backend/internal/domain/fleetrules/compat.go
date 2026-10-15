package fleetrules

// CompatKey — ключ проверки совместимости машины с грузом.
type CompatKey string

// Проверки совместимости в порядке эталона.
const (
	CheckAvail   CompatKey = "avail"
	CheckPayload CompatKey = "payload"
	CheckVolume  CompatKey = "volume"
	CheckLength  CompatKey = "length"
	CheckTemp    CompatKey = "temp"
)

// CompatCheck — одна проверка совместимости: что есть у машины (Value) и что нужно грузу (Need).
type CompatCheck struct {
	Key   CompatKey `json:"key"`
	Label string    `json:"label"`
	Icon  string    `json:"icon"`
	OK    bool      `json:"ok"`
	Value string    `json:"value"`
	Need  string    `json:"need,omitempty"`
}

// CompatResult — итог Compat.
type CompatResult struct {
	// Fit — машина подходит грузу (без учёта доступности).
	Fit bool `json:"fit"`
	// OK — подходит и доступна.
	OK     bool          `json:"ok"`
	Checks []CompatCheck `json:"checks"`
	// Reasons — тексты непройденных проверок: «Объём: 9 м³, нужно от 12 м³». Сервер отдаёт их
	// в 409 vehicle_incompatible через «; ».
	Reasons []string `json:"reasons"`
}

// TempLabel возвращает подпись диапазона температуры: «-18…+8 °C».
func TempLabel(t TempRange) string {
	return signed(t[0]) + "…" + signed(t[1]) + " °C"
}

func signed(n float64) string {
	if n > 0 {
		return "+" + jsString(n)
	}
	return jsString(n)
}

// Compat проверяет совместимость машины с грузом рейса (compat эталона): доступность,
// грузоподъёмность, объём, длина кузова, температура. Сумма объёма и массы — не 3D-укладка.
// Машина, забронированная за этим же рейсом, доступна.
func Compat(v Vehicle, trip Trip) CompatResult {
	c := trip.Cargo
	checks := []CompatCheck{
		availCheck(v, trip.ID),
		measureCheck(CheckPayload, "Грузоподъёмность", "scale", v.PayloadT, c.WeightT, " т"),
		measureCheck(CheckVolume, "Объём", "deployed_code", v.VolumeM3, c.VolumeM3, " м³"),
		measureCheck(CheckLength, "Длина кузова", "straighten", v.LengthM, c.LengthM, " м"),
		tempCheck(v.Temp, c.Temp),
	}
	fit := true
	for _, ch := range checks[1:] {
		fit = fit && ch.OK
	}
	reasons := make([]string, 0, len(checks))
	for _, ch := range checks {
		if ch.OK {
			continue
		}
		r := ch.Label + ": " + ch.Value
		if ch.Need != "" {
			r += ", нужно " + ch.Need
		}
		reasons = append(reasons, r)
	}
	return CompatResult{Fit: fit, OK: fit && checks[0].OK, Checks: checks, Reasons: reasons}
}

func availCheck(v Vehicle, tripID string) CompatCheck {
	mine := v.HeldBy != nil && *v.HeldBy == tripID
	st, known := VehicleStateLabel(v.State)
	if !known {
		st.Label = string(v.State) // эталон здесь падает; бриф W2.01 §10 п. 3
	}
	value := "Назначена на этот рейс"
	if !mine {
		value = st.Label
		if v.Note != "" {
			value += " · " + v.Note
		}
	}
	return CompatCheck{
		Key:   CheckAvail,
		Label: "Доступность",
		Icon:  st.Icon,
		OK:    v.State == VehicleFree || mine,
		Value: value,
	}
}

func measureCheck(key CompatKey, label, icon string, have, need float64, unit string) CompatCheck {
	return CompatCheck{
		Key:   key,
		Label: label,
		Icon:  icon,
		OK:    have >= need,
		Value: num(have) + unit,
		Need:  "от " + num(need) + unit,
	}
}

func tempCheck(have, need *TempRange) CompatCheck {
	ch := CompatCheck{Key: CheckTemp, Label: "Температура", Icon: "thermostat"}
	if need == nil {
		ch.OK, ch.Value = true, "не требуется"
		return ch
	}
	ch.Need = TempLabel(*need)
	if have == nil {
		ch.Value = "без охлаждения"
		return ch
	}
	ch.OK = have[0] <= need[0] && have[1] >= need[1]
	ch.Value = TempLabel(*have)
	return ch
}
