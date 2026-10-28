package repairs

// Values of the columns the module meets in several places: the units of volume, the kinds of the price list, the kinds
// of the documents, the states of the rows and the sections of the starter price list.
const (
	unitHour  = "hour"
	unitM2    = "m2"
	unitM3    = "m3"
	unitM     = "m"
	unitPiece = "piece"
	unitSet   = "set"
	unitTrip  = "trip"
	unitMesh  = "mesh"
	unitLiter = "liter"

	kindWork     = "work"
	kindMaterial = "material"

	docContract  = "contract"
	docAct       = "act"
	docHandOver  = "handover_act"
	docWarranty  = "warranty"
	docAgreement = "agreement"
	docInvoice   = "invoice"

	stateSigned   = "signed"
	statePaid     = "paid"
	stateRejected = "rejected"

	rejectAlready   = "already_in_estimate"
	rejectRefused   = "client_refused"
	rejectWarranty  = "warranty"
	rejectNotAgreed = "not_agreed_with_client"

	secDemolition = "Демонтаж"
	secElectrics  = "Электрика"
	secWalls      = "Стены"
	secFloors     = "Полы"
	secPlumbing   = "Сантехника"
	secMaterials  = "Материалы"
)
