package fleetrules

import (
	"encoding/json"
	"testing"
)

func TestDictionaries_Fixture(t *testing.T) {
	t.Parallel()
	var fx map[string]json.RawMessage
	loadFixture(t, "dictionaries", &fx)
	got := map[string]any{
		"vehicleState": VehicleStates(),
		"tripState":    TripStates(),
		"photoSides":   PhotoSides(),
		"depChecks":    DepChecks(),
		"retChecks":    RetChecks(),
		"defectZones":  DefectZones(),
		"fuel":         FuelLevels(),
		"expenseCat":   ExpenseCategories(),
	}
	for key, g := range got {
		want, ok := fx[key]
		if !ok {
			t.Errorf("dictionaries.json: нет %s", key)
			continue
		}
		t.Run(key, func(t *testing.T) {
			t.Parallel()
			assertJSON(t, g, want)
		})
	}
	if len(fx) != len(got)+1 { // + $comment
		t.Errorf("dictionaries.json: %d ключей, проверено %d", len(fx)-1, len(got))
	}
}

func TestStateLabels(t *testing.T) {
	t.Parallel()
	if l, ok := VehicleStateLabel(VehicleUnavailable); !ok || l.Label != "Недоступна" || l.Icon != "block" {
		t.Errorf("VehicleStateLabel(unavailable) = %+v, %v", l, ok)
	}
	if _, ok := VehicleStateLabel("parked"); ok {
		t.Error("VehicleStateLabel(parked): want false")
	}
	if l, ok := TripStateLabel(TripDefectReview); !ok || l.Label != "Дефект на проверке" || l.Tone != ToneDanger {
		t.Errorf("TripStateLabel(defect_review) = %+v, %v", l, ok)
	}
	if _, ok := TripStateLabel("lost"); ok {
		t.Error("TripStateLabel(lost): want false")
	}
}

func TestDictionaries_ReturnCopies(t *testing.T) {
	t.Parallel()
	PhotoSides()[0].Label = "испорчено"
	VehicleStates()[0].Label = "испорчено"
	DefectZones()[0] = "испорчено"
	if PhotoSides()[0].Label != "Спереди" || VehicleStates()[0].Label != "Свободна" ||
		DefectZones()[0] != "Кузов" {
		t.Error("справочники должны возвращать копии")
	}
}
