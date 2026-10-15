package fleetrules

// Типы автопарка и рейса (types.ts W0.12 = mock-data.js:189–229 14.10). JSON-имена — как у
// клиента; рейс несёт только поля, нужные правилам.

// TempRange — диапазон температуры кузова или груза, °C: [от, до].
type TempRange [2]float64

// Vehicle — машина автопарка.
type Vehicle struct {
	ID       string       `json:"id"`
	Unit     string       `json:"unit"`
	Model    string       `json:"model"`
	Plate    string       `json:"plate"`
	Body     string       `json:"body"`
	PayloadT float64      `json:"payloadT"`
	VolumeM3 float64      `json:"volumeM3"`
	LengthM  float64      `json:"lengthM"`
	Temp     *TempRange   `json:"temp"`
	Odometer float64      `json:"odometer"`
	State    VehicleState `json:"state"`
	Depot    string       `json:"depot"`
	// Note — пояснение к состоянию («Плановое ТО до 03.10»).
	Note string `json:"note,omitempty"`
	// HeldBy — рейс, за которым машина забронирована.
	HeldBy *string `json:"heldBy,omitempty"`
}

// Cargo — груз рейса.
type Cargo struct {
	WeightT  float64    `json:"weightT"`
	VolumeM3 float64    `json:"volumeM3"`
	LengthM  float64    `json:"lengthM"`
	Temp     *TempRange `json:"temp"`
	Kind     string     `json:"kind"`
}

// StopOp — операция на остановке.
type StopOp string

// Операции на остановке.
const (
	StopLoad   StopOp = "load"
	StopUnload StopOp = "unload"
)

// Stop — остановка рейса: масса W, т, и объём V, м³, которые грузят или выгружают.
type Stop struct {
	Time string  `json:"time"`
	Name string  `json:"name"`
	Op   StopOp  `json:"op"`
	W    float64 `json:"w"`
	V    float64 `json:"v"`
}

// Trip — рейс (поля, нужные правилам).
type Trip struct {
	ID    string `json:"id"`
	Cargo Cargo  `json:"cargo"`
	Stops []Stop `json:"stops"`
}
