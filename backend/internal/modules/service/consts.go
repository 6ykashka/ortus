package service

// Names the module repeats: the states of a goal, the kinds of messages, the statuses of a rating, the keys of events
// and of audit records.
const (
	stateLate  = "late"
	stateRisk  = "risk"
	stateNorm  = "norm"
	stateLegal = "legal"
	stateDone  = "done"
	statePause = "pause"
	stateNone  = "none"

	msgClient = "client"
	msgPublic = "public"
	msgNote   = "note"
	msgSystem = "system"
	msgRating = "rating"

	ratingOpen    = "open"
	ratingSeen    = "seen"
	ratingRequest = "request"

	entityRequest = "request"
	moduleService = "service"

	keyRequestID   = "requestId"
	keyKey         = "key"
	keyDirectionID = "directionId"
	keyKind        = "kind"
	keyChannel     = "channel"

	textNewClient = "Новый клиент"
)
