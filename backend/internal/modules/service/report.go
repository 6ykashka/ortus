package service

import (
	"context"
	"encoding/json"
	"slices"
	"sort"
	"time"

	"github.com/google/uuid"

	api "github.com/ortus/ortus-crm/backend/internal/api/service"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// fewAnswers is the number of answers under which a mean score is «мало ответов» (1e).
const fewAnswers = 20

// ReportQuery is the period and the direction of the report.
type ReportQuery struct {
	From, To  time.Time // the days of the period, both included; zero — the last 30 days
	Direction uuid.UUID
}

// The report is built as a plain document and decoded into the type of the contract (its dates and anonymous rows have
// no names to build them by).
type (
	reportDoc struct {
		Period  periodDoc   `json:"period"`
		Rows    []rowDoc    `json:"rows"`
		Reasons []reasonDoc `json:"reasons"`
		Weeks   []weekDoc   `json:"weeks"`
		Staff   []staffDoc  `json:"staff,omitempty"`
	}
	periodDoc struct {
		From string `json:"from"`
		To   string `json:"to"`
	}
	rowDoc struct {
		DirectionID    uuid.UUID `json:"directionId"`
		Requests       int       `json:"requests"`
		ResolvedInTime int       `json:"resolvedInTime"`
		Late           int       `json:"late"`
		AvgScore       *float64  `json:"avgScore,omitempty"`
		Ratings        int       `json:"ratings"`
		FewAnswers     bool      `json:"fewAnswers"`
	}
	reasonDoc struct {
		Reason string `json:"reason"`
		Count  int    `json:"count"`
	}
	weekDoc struct {
		WeekStart string `json:"weekStart"`
		Requests  int    `json:"requests"`
		Late      int    `json:"late"`
	}
	staffDoc struct {
		Member              api.ServiceMemberRef `json:"member"`
		Ratings             int                  `json:"ratings"`
		AvgScore            *float64             `json:"avgScore,omitempty"`
		ComplaintsConfirmed int                  `json:"complaintsConfirmed"`
		Thanks              int                  `json:"thanks"`
	}
)

// late reports whether a goal of the request was missed: stopped after its term, or running past it.
func late(x *Request, now time.Time) bool {
	for _, t := range []*Timer{x.SLA.First, x.SLA.Resolve} {
		switch {
		case t == nil:
		case t.Stopped != nil && t.Stopped.After(t.Due), t.Stopped == nil && IsOpen(x.Status) && x.Status != StatusWait && now.After(t.Due):
			return true
		}
	}
	return false
}

// weekStart is the Monday of the week of t in Moscow.
func weekStart(t time.Time) time.Time {
	t = t.In(Moscow)
	d := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, Moscow)
	return d.AddDate(0, 0, -((int(d.Weekday()) + 6) % 7))
}

// Report is getServiceReport (1e): the directions the actor reads the reports of, the reasons of low ratings, the weeks
// and — with service.reports.staff — the employees (a complaint counts to an employee only with the outcome
// «Подтвердилась», FB-05).
func (s *Service) Report(ctx context.Context, tc tenantctx.TenantContext, q ReportQuery) (api.ServiceReport, error) {
	var out api.ServiceReport
	err := s.run(ctx, tc, func(r *req) error {
		dirs, err := r.visible(ctx, actReports)
		if err != nil {
			return err
		}
		if q.Direction != uuid.Nil {
			d := find(dirs, q.Direction)
			if d == nil {
				return notFound(textDirectionMissing)
			}
			dirs = []Direction{*d}
		}
		from, to := period(q, r.now)
		list, err := r.requests(ctx, "r.direction_id = any($1) and r.created_at >= $2 and r.created_at < $3 and r.about_member_id is distinct from $4",
			idsOf(dirs), from, to, r.meOrNil())
		if err != nil {
			return err
		}
		ratings, err := r.periodRatings(ctx, idsOf(dirs), from, to)
		if err != nil {
			return err
		}
		doc := reportDoc{Period: periodDoc{From: from.Format(time.DateOnly), To: to.AddDate(0, 0, -1).Format(time.DateOnly)},
			Rows: reportRows(dirs, list, ratings, r.now), Reasons: reasons(ratings), Weeks: weeks(list, r.now)}
		if doc.Staff, err = r.staff(ctx, dirs, list); err != nil {
			return err
		}
		b, err := json.Marshal(doc)
		if err != nil {
			return store("report", err)
		}
		return store("report", json.Unmarshal(b, &out))
	})
	return out, err
}

func period(q ReportQuery, now time.Time) (from, to time.Time) {
	day := func(t time.Time) time.Time {
		y, m, d := t.In(Moscow).Date()
		return time.Date(y, m, d, 0, 0, 0, 0, Moscow)
	}
	if q.To.IsZero() {
		to = day(now).AddDate(0, 0, 1)
	} else {
		to = day(q.To).AddDate(0, 0, 1)
	}
	if q.From.IsZero() {
		return to.AddDate(0, 0, -30), to
	}
	return day(q.From), to
}

func (r *req) periodRatings(ctx context.Context, dirs []uuid.UUID, from, to time.Time) ([]Rating, error) {
	all, err := r.ratings(ctx, dirs, "")
	if err != nil {
		return nil, err
	}
	return slices.DeleteFunc(all, func(x Rating) bool { return x.At.Before(from) || !x.At.Before(to) }), nil
}

func mean(sum, n int) *float64 {
	if n == 0 {
		return nil
	}
	v := float64(int(float64(sum)/float64(n)*10+0.5)) / 10
	return &v
}

func reportRows(dirs []Direction, list []*Request, ratings []Rating, now time.Time) []rowDoc {
	rows := make([]rowDoc, 0, len(dirs))
	for _, d := range dirs {
		row := rowDoc{DirectionID: d.ID}
		for _, x := range list {
			if x.DirectionID != d.ID {
				continue
			}
			row.Requests++
			switch {
			case late(x, now):
				row.Late++
			case !IsOpen(x.Status):
				row.ResolvedInTime++
			}
		}
		var sum int
		for _, x := range ratings {
			if x.DirectionID == d.ID {
				row.Ratings++
				sum += x.Score
			}
		}
		row.AvgScore, row.FewAnswers = mean(sum, row.Ratings), row.Ratings < fewAnswers
		rows = append(rows, row)
	}
	return rows
}

func reasons(ratings []Rating) []reasonDoc {
	count := map[string]int{}
	for _, x := range ratings {
		for _, why := range x.Reasons {
			count[why]++
		}
	}
	out := make([]reasonDoc, 0, len(count))
	for why, n := range count {
		out = append(out, reasonDoc{Reason: why, Count: n})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Count != out[j].Count {
			return out[i].Count > out[j].Count
		}
		return out[i].Reason < out[j].Reason
	})
	return out
}

func weeks(list []*Request, now time.Time) []weekDoc {
	by := map[string]*weekDoc{}
	for _, x := range list {
		k := weekStart(x.CreatedAt).Format(time.DateOnly)
		w, ok := by[k]
		if !ok {
			w = &weekDoc{WeekStart: k}
			by[k] = w
		}
		w.Requests++
		if late(x, now) {
			w.Late++
		}
	}
	out := make([]weekDoc, 0, len(by))
	for _, w := range by {
		out = append(out, *w)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].WeekStart < out[j].WeekStart })
	return out
}

// staff are the employees of the report: complaints confirmed, thanks and the ratings the requests about them came from.
// Only for an actor with service.reports.staff in a direction of the report.
func (r *req) staff(ctx context.Context, dirs []Direction, list []*Request) ([]staffDoc, error) {
	ok, err := r.hasAction(ctx, actStaff, dirs)
	if err != nil || !ok {
		return nil, err
	}
	type acc struct{ ratings, sum, confirmed, thanks int }
	by := map[uuid.UUID]*acc{}
	get := func(id uuid.UUID) *acc {
		if by[id] == nil {
			by[id] = &acc{}
		}
		return by[id]
	}
	for _, x := range list {
		if x.About != uuid.Nil {
			a := get(x.About)
			if x.FromRating > 0 {
				a.ratings++
				a.sum += x.FromRating
			}
			if x.Outcome == OutcomeConfirmed {
				a.confirmed++
			}
		}
		if x.Kind == KindThanks && x.Assignee != uuid.Nil {
			get(x.Assignee).thanks++
		}
	}
	ids := make([]uuid.UUID, 0, len(by))
	for id := range by {
		ids = append(ids, id)
	}
	names, err := r.names(ctx, ids)
	if err != nil {
		return nil, err
	}
	out := make([]staffDoc, 0, len(by))
	for id, a := range by {
		out = append(out, staffDoc{Member: api.ServiceMemberRef{MemberId: id, DisplayName: names[id]}, Ratings: a.ratings,
			AvgScore: mean(a.sum, a.ratings), ComplaintsConfirmed: a.confirmed, Thanks: a.thanks})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Member.DisplayName < out[j].Member.DisplayName })
	return out, nil
}
