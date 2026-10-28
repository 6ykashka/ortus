package service

import (
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"

	api "github.com/ortus/ortus-crm/backend/internal/api/service"
)

// FormatPhone is a Russian number as the prototype shows it («+7 916 204-44-12»); another number is returned as it is.
func FormatPhone(p string) string {
	d := digitsOf(p)
	if len(d) != 11 || d[0] != '7' {
		return p
	}
	return "+7 " + d[1:4] + " " + d[4:7] + "-" + d[7:9] + "-" + d[9:]
}

func digitsOf(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// NormalizePhone is the number of the database («+79162044412»): 8… and a number without the country code are Russian.
func NormalizePhone(p string) string {
	d := digitsOf(p)
	switch {
	case len(d) == 10:
		d = "7" + d
	case len(d) == 11 && d[0] == '8':
		d = "7" + d[1:]
	}
	return "+" + d
}

func hhmm(m int) string { return fmt.Sprintf("%02d:%02d", m/60, m%60) }

func i64(n int) *int64 {
	v := int64(n)
	return &v
}

func opt(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func ref(names map[uuid.UUID]string, id uuid.UUID) *api.ServiceMemberRef {
	if id == uuid.Nil {
		return nil
	}
	return &api.ServiceMemberRef{MemberId: id, DisplayName: names[id]}
}

func calendarDTO(c Calendar) api.ServiceWorkCalendar {
	days := make([]int64, 0, len(c.Days))
	for _, d := range c.Days {
		days = append(days, int64(d+1))
	}
	out := api.ServiceWorkCalendar{Days: days, From: hhmm(c.From), To: hhmm(c.To), TimeZone: c.loc().String()}
	if c.Label != "" {
		out.Label = &c.Label
	}
	if out.TimeZone == "MSK" {
		out.TimeZone = "Europe/Moscow"
	}
	if out.TimeZone == "SAMT" {
		out.TimeZone = "Europe/Samara"
	}
	return out
}

func directionDTO(d Direction, names map[uuid.UUID]string, team []uuid.UUID, canContacts bool) api.ServiceDirection {
	members := make([]api.ServiceMemberRef, 0, len(team))
	for _, m := range team {
		members = append(members, api.ServiceMemberRef{MemberId: m, DisplayName: names[m]})
	}
	out := api.ServiceDirection{Id: d.ID, Key: d.Key, Name: d.Name, Color: d.Color, ModuleKey: d.ModuleKey, AreaLabel: d.AreaLabel,
		OrgUnitId: d.OrgUnitID, ProjectId: d.ProjectID, Calendar: calendarDTO(d.Calendar), Next: int64(d.Next), Team: members,
		CanContacts: canContacts, Version: int64(d.Version)}
	if d.LeadID != nil {
		out.Lead = ref(names, *d.LeadID)
	}
	return out
}

func typeDTO(t Type) api.ServiceRequestType {
	var first, resolve, legal *int64
	if t.Goals.First != nil {
		first = i64(*t.Goals.First)
	}
	if t.Goals.Resolve != nil {
		resolve = i64(*t.Goals.Resolve)
	}
	if t.Goals.Legal != nil {
		legal = i64(*t.Goals.Legal)
	}
	return api.ServiceRequestType{Id: t.ID, DirectionId: t.DirectionID, Kind: api.ServiceRequestTypeKind(t.Kind), Name: t.Name,
		FirstMinutes: first, ResolveMinutes: resolve, LegalDays: legal, Priority: api.ServiceRequestTypePriority(t.Priority)}
}

func slaDTO(x *Request, cal Calendar, now time.Time) api.ServiceSla {
	items := SLAOf(x.sla(), cal, now)
	out := api.ServiceSla{}
	for _, p := range []struct {
		key string
		t   *Timer
		set func(*api.ServiceSlaTarget)
	}{
		{targetFirst, x.SLA.First, func(v *api.ServiceSlaTarget) { out.First = v }},
		{targetRes, x.SLA.Resolve, func(v *api.ServiceSlaTarget) { out.Resolve = v }},
		{targetLegal, x.SLA.Legal, func(v *api.ServiceSlaTarget) { out.Legal = v }},
	} {
		i := slices.IndexFunc(items, func(it SLAItem) bool { return it.Key == p.key })
		if p.t == nil || i < 0 {
			continue
		}
		p.set(targetDTO(p.key, *p.t, items[i]))
	}
	return out
}

func targetDTO(key string, t Timer, it SLAItem) *api.ServiceSlaTarget {
	out := &api.ServiceSlaTarget{DueAt: t.Due.UTC(), State: api.ServiceSlaTargetState(it.State), Label: it.Label, Text: it.Text, Until: it.Until}
	if key != targetLegal {
		out.GoalMinutes = i64(t.Goal)
	}
	if t.Stopped != nil {
		s := t.Stopped.UTC()
		out.StoppedAt = &s
	}
	switch it.State {
	case stateLate:
		out.OverMinutes = i64(int(max(0, roundF(it.Over))))
	case stateRisk, stateNorm, stateLegal:
		out.LeftMinutes = i64(int(max(0, roundF(it.Left))))
	}
	return out
}

func roundF(f float64) float64 {
	if f < 0 {
		return -float64(int(-f + 0.5))
	}
	return float64(int(f + 0.5))
}

func headDTO(h SLAHead) api.ServiceSlaHead {
	out := api.ServiceSlaHead{State: api.ServiceSlaHeadState(h.State), Label: h.Label, Text: h.Text, Until: h.Until, Rank: float32(h.Rank)}
	if h.Key != "" {
		k := api.ServiceSlaHeadKey(h.Key)
		out.Key = &k
	}
	return out
}

func linkDTO(l *Link) *api.ServiceLink {
	if l == nil {
		return nil
	}
	out := &api.ServiceLink{Label: l.Label, Lines: l.Lines}
	if out.Lines == nil {
		out.Lines = []string{}
	}
	if l.Kind != "" {
		k := api.ServiceLinkKind(l.Kind)
		out.Kind = &k
	}
	if l.Object != nil {
		out.Object = &api.ObjectRef{ModuleKey: l.Object.ModuleKey, EntityType: l.Object.EntityType, EntityId: l.Object.EntityID}
	}
	return out
}

// viewer is who looks at a request: the phone is whole only to those it was shown to.
type viewer struct{ person uuid.UUID }

func (v viewer) sees(x *Request) bool {
	return v.person != uuid.Nil && (slices.Contains(x.Details.Shown, v.person) || x.Details.Author == v.person)
}

func clientDTO(x *Request, v viewer) api.ServiceClient {
	since := x.Details.ClientSince
	if since == "" {
		since = textNewClient
	}
	out := api.ServiceClient{Name: x.Client.Name, Company: opt(x.Client.Company), PhoneMasked: MaskPhone(x.Client.Phone), Since: since}
	if v.sees(x) {
		p := FormatPhone(x.Client.Phone)
		out.Phone = &p
	}
	return out
}

// summaryDTO is the row of the queue.
func summaryDTO(x *Request, cal Calendar, names map[uuid.UUID]string, v viewer, now time.Time) api.ServiceRequestSummary {
	out := api.ServiceRequestSummary{Id: x.ID, Key: x.Key, DirectionId: x.DirectionID, Kind: api.ServiceRequestSummaryKind(x.Kind),
		Title: x.Title, Status: api.ServiceRequestSummaryStatus(x.Status), Priority: api.ServiceRequestSummaryPriority(x.Priority),
		Assignee: ref(names, x.Assignee), CreatedAt: x.CreatedAt.UTC(), Channel: api.ServiceRequestSummaryChannel(x.Channel),
		Client: clientDTO(x, v), Link: linkDTO(x.Link), Sla: slaDTO(x, cal, now), Head: headDTO(SLAHeadOf(x.sla(), cal, now)),
		Labels: x.Labels, TaskCount: int64(len(x.Details.Tasks))}
	if len(x.OldKeys) > 0 {
		keys := slices.Clone(x.OldKeys)
		out.OldKeys = &keys
	}
	if x.FromRating > 0 {
		out.FromRating = i64(x.FromRating)
	}
	if x.Outcome != "" {
		out.Outcome = &x.Outcome
	}
	if x.ResolvedAt != nil {
		t := x.ResolvedAt.UTC()
		out.ResolvedAt = &t
	}
	return out
}

func messageDTO(m Message, x *Request, names map[uuid.UUID]string) api.ServiceMessage {
	files := []api.ServiceFile{}
	for _, f := range x.Details.Files[m.ID.String()] {
		files = append(files, api.ServiceFile{Id: f.ID, FileName: f.FileName, SizeBytes: f.SizeBytes, Status: api.Ready})
	}
	out := api.ServiceMessage{Id: m.ID, Kind: api.ServiceMessageKind(m.Kind), At: m.At.UTC(), Text: m.Text, Files: files}
	if m.Author != uuid.Nil && m.Kind != msgClient && m.Kind != "rating" {
		out.Author = ref(names, m.Author)
	}
	if m.Channel != "" {
		c := api.ServiceMessageChannel(m.Channel)
		out.Channel = &c
	}
	if m.Auto {
		out.Auto = &m.Auto
	}
	if m.Delivery != "" {
		d := api.ServiceMessageDelivery(m.Delivery)
		out.Delivery = &d
	}
	if m.Score > 0 {
		out.Score = i64(m.Score)
	}
	if m.Kind == "rating" {
		reasons := m.Reasons
		if reasons == nil {
			reasons = []string{}
		}
		out.Reasons = &reasons
		c := m.Contact
		out.Contact = &c
	}
	return out
}

func ratingDTO(x Rating) api.ServiceRating {
	out := api.ServiceRating{Id: x.ID, DirectionId: x.DirectionID, ClientName: x.ClientName, Score: int64(x.Score), Reasons: x.Reasons, Comment: x.Comment,
		At: x.At.UTC(), Work: x.Work, Status: api.ServiceRatingStatus(x.Status)}
	if out.Reasons == nil {
		out.Reasons = []string{}
	}
	if x.RequestID != uuid.Nil {
		id := x.RequestID
		out.RequestId = &id
	}
	return out
}

func countsDTO(counts map[string]int) api.ServiceQueueCounts {
	items := make([]api.ServiceQueueCount, 0, 8)
	for _, q := range Queues() {
		it := api.ServiceQueueCount{Key: api.ServiceQueueCountKey(q.Key), Label: q.Label, Count: int64(counts[q.Key])}
		if q.Tone != "" && counts[q.Key] > 0 {
			t := api.ServiceQueueCountTone(q.Tone)
			it.Tone = &t
		}
		items = append(items, it)
	}
	n := int64(counts[QueueNoReply])
	return api.ServiceQueueCounts{Items: items, NoReplyCount: &n}
}
