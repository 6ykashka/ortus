package fleetrules

import (
	"math"
	"strconv"
)

// PhotoState — состояние фото на устройстве водителя.
type PhotoState string

// Состояния фото.
const (
	PhotoEmpty     PhotoState = "empty"
	PhotoQueued    PhotoState = "queued"
	PhotoUploading PhotoState = "uploading"
	PhotoReady     PhotoState = "ready"
	PhotoError     PhotoState = "error"
)

// Photo — фото осмотра или чека.
type Photo struct {
	State PhotoState `json:"state"`
}

// counts сообщает, засчитывается ли фото: готово или стоит в очереди отправки.
func (p *Photo) counts() bool {
	return p != nil && (p.State == PhotoReady || p.State == PhotoQueued)
}

// InspectionKind — вид осмотра: выезд или сдача.
type InspectionKind string

// Виды осмотра. Любой вид, кроме выезда, проверяется по чек-листу сдачи, как в эталоне.
const (
	InspectionDeparture InspectionKind = "dep"
	InspectionReturn    InspectionKind = "ret"
)

// InspectionDraft — черновик осмотра (выезд или сдача): фото по ракурсам, пробег, уровень
// топлива (пустая строка — не выбран) и отмеченные пункты чек-листа.
type InspectionDraft struct {
	Photos   map[string]*Photo `json:"photos"`
	Odometer FormValue         `json:"odometer"`
	Fuel     string            `json:"fuel"`
	Checks   map[string]bool   `json:"checks"`
}

// odoWarnKm — насколько пробег может превысить начальный без предупреждения.
const odoWarnKm = 3000

// InspMissing перечисляет, чего не хватает, чтобы отправить осмотр (inspMissing эталона):
// «N фото», «пробег» или «пробег не меньше N км», «уровень топлива», «N пунктов чек-листа».
// Пустой список — осмотр можно отправить.
func InspMissing(d InspectionDraft, kind InspectionKind, minOdo float64) []string {
	miss := make([]string, 0, 4)
	have := 0
	for _, s := range photoSides {
		if d.Photos[s.Key].counts() {
			have++
		}
	}
	if have < len(photoSides) {
		miss = append(miss, strconv.Itoa(len(photoSides)-have)+" фото")
	}
	odo := toNumber(d.Odometer.jsString())
	switch {
	case d.Odometer == Text("") || math.IsNaN(odo) || math.IsInf(odo, 0):
		miss = append(miss, "пробег")
	case odo < minOdo:
		miss = append(miss, "пробег не меньше "+formatInt(minOdo)+" км")
	}
	if d.Fuel == "" {
		miss = append(miss, "уровень топлива")
	}
	list := retChecks
	if kind == InspectionDeparture {
		list = depChecks
	}
	left := 0
	for _, c := range list {
		if !d.Checks[c.Key] {
			left++
		}
	}
	if left > 0 {
		miss = append(miss, strconv.Itoa(left)+" "+plural(left, "пункт", "пункта", "пунктов")+" чек-листа")
	}
	return miss
}

// OdoError возвращает ошибку поля «Пробег» (odoError эталона) или пустую строку: меньше
// начального — ошибка, больше начального на 3000 км и более — предупреждение «проверьте показания».
func OdoError(value string, minOdo float64) string {
	if value == "" {
		return ""
	}
	n := toNumber(value)
	switch {
	case math.IsNaN(n) || math.IsInf(n, 0):
		return "Введите число"
	case n < minOdo:
		return "Пробег не может быть меньше " + formatInt(minOdo) + " км"
	case n > minOdo+odoWarnKm:
		return "Больше начального на " + formatInt(n-minOdo) + " км — проверьте показания"
	}
	return ""
}
