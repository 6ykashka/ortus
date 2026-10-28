package service

import (
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Queue keys of the navigation (QUEUES of Обращения.dc.html).
const (
	QueueOpen    = ratingOpen
	QueueNoReply = "noreply"
	QueueMine    = "mine"
	QueueRisk    = stateRisk
	QueueLate    = stateLate
	QueueWait    = "wait"
	QueueLow     = "low"
	QueueDone    = "done"
)

// QueueDef is a queue of the navigation: the label, the icon and the tone of a counter that is not zero.
type QueueDef struct{ Key, Label, Icon, Tone string }

// Queues are the eight queues in the order of the navigation.
func Queues() []QueueDef {
	return []QueueDef{
		{QueueOpen, "Открытые", "inbox", ""},
		{QueueNoReply, "Без ответа", "mark_email_unread", ""},
		{QueueMine, "Мои", "person", ""},
		{QueueRisk, "Срок под угрозой", "schedule", "warn"},
		{QueueLate, "Срок нарушен", "error", "danger"},
		{QueueWait, "Ждут клиента", "hourglass_top", ""},
		{QueueLow, "Низкие оценки", "sentiment_dissatisfied", ""},
		{QueueDone, "Решено и закрыто", "task_alt", ""},
	}
}

// Source is what the queues are counted over: the visible requests with the calendars of their directions and the
// low ratings.
type Source struct {
	Requests  []*Request
	Calendars map[uuid.UUID]Calendar // direction → calendar
	Ratings   []Rating
}

// QueueQuery selects a queue.
type QueueQuery struct {
	Queue     string // unknown: open
	Direction uuid.UUID
	Kind      string
	Channel   string
	Q         string
	Me        uuid.UUID
	Now       time.Time
}

// Row is a row of the queue with the main term.
type Row struct {
	Request *Request
	Head    SLAHead
}

func (s Source) heads(now time.Time) map[uuid.UUID]SLAHead {
	out := make(map[uuid.UUID]SLAHead, len(s.Requests))
	for _, r := range s.Requests {
		if cal, ok := s.Calendars[r.DirectionID]; ok {
			out[r.ID] = SLAHeadOf(r.sla(), cal, now)
		}
	}
	return out
}

func inDirection(dir, x uuid.UUID) bool { return dir == uuid.Nil || dir == x }

func predicate(key string, heads map[uuid.UUID]SLAHead, me uuid.UUID) func(*Request) bool {
	state := func(r *Request) string { return heads[r.ID].State }
	switch key {
	case QueueNoReply:
		return func(r *Request) bool { return IsOpen(r.Status) && r.SLA.First != nil && r.SLA.First.Stopped == nil }
	case QueueMine:
		return func(r *Request) bool { return IsOpen(r.Status) && me != uuid.Nil && r.Assignee == me }
	case QueueRisk:
		return func(r *Request) bool { return IsOpen(r.Status) && state(r) == stateRisk }
	case QueueLate:
		return func(r *Request) bool { return IsOpen(r.Status) && state(r) == stateLate }
	case QueueWait:
		return func(r *Request) bool { return r.Status == StatusWait }
	case QueueDone:
		return func(r *Request) bool { return !IsOpen(r.Status) }
	}
	return func(r *Request) bool { return IsOpen(r.Status) }
}

func (s Source) lowRatings(dir uuid.UUID) []Rating {
	var out []Rating
	for _, x := range s.Ratings {
		if inDirection(dir, x.DirectionID) && x.Status == ratingOpen {
			out = append(out, x)
		}
	}
	return out
}

// Counts are the counters of the queues for a direction (uuid.Nil: all) without the filters of kind, channel and search.
func (s Source) Counts(dir, me uuid.UUID, now time.Time) map[string]int {
	heads := s.heads(now)
	out := make(map[string]int, 8)
	for _, q := range Queues() {
		out[q.Key] = 0
		if q.Key == QueueLow {
			out[q.Key] = len(s.lowRatings(dir))
			continue
		}
		pred := predicate(q.Key, heads, me)
		for _, r := range s.Requests {
			if inDirection(dir, r.DirectionID) && pred(r) {
				out[q.Key]++
			}
		}
	}
	return out
}

// DirectionCounts are the open requests by direction (not by the selected one).
func (s Source) DirectionCounts() map[uuid.UUID]int {
	out := map[uuid.UUID]int{}
	for _, r := range s.Requests {
		if IsOpen(r.Status) {
			out[r.DirectionID]++
		}
	}
	return out
}

func matches(r *Request, q string) bool {
	hay := strings.ToLower(strings.Join(append([]string{r.Key, r.Title, r.Client.Name, r.Client.Company}, r.OldKeys...), " "))
	return strings.Contains(hay, q)
}

// Queue is the rows of a queue sorted by the urgency; the queue «low» has ratings and no rows.
func (s Source) Queue(q QueueQuery) ([]Row, []Rating) {
	if q.Queue == QueueLow {
		return nil, s.lowRatings(q.Direction)
	}
	heads := s.heads(q.Now)
	pred := predicate(q.Queue, heads, q.Me)
	needle := strings.ToLower(strings.TrimSpace(q.Q))
	var rows []Row
	for _, r := range s.Requests {
		head, ok := heads[r.ID]
		switch {
		case !ok, !inDirection(q.Direction, r.DirectionID), !pred(r):
		case q.Kind != "" && r.Kind != q.Kind, q.Channel != "" && r.Channel != q.Channel:
		case needle != "" && !matches(r, needle):
		default:
			rows = append(rows, Row{Request: r, Head: head})
		}
	}
	sort.SliceStable(rows, func(i, j int) bool { return rows[i].Head.Rank < rows[j].Head.Rank })
	return rows, nil
}

// Takeable reports whether «Взять себе» is shown: open, no assignee, the right to reply and a member of the team.
func Takeable(r *Request, team []uuid.UUID, me uuid.UUID, canReply bool) bool {
	if r.Assignee != uuid.Nil || !IsOpen(r.Status) || !canReply {
		return false
	}
	return slices.Contains(team, me)
}
