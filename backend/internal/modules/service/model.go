package service

import (
	"time"

	"github.com/google/uuid"
)

// Direction is a direction of requests (service.directions with its calendar): a service project of «Задачи».
type Direction struct {
	ID         uuid.UUID
	Key, Name  string
	Color      string
	ModuleKey  string
	AreaLabel  string
	OrgUnitID  *uuid.UUID
	ProjectID  uuid.UUID
	CalendarID uuid.UUID
	Calendar   Calendar
	LeadID     *uuid.UUID
	Next       int
	PublicSlug string
	Status     string
	Version    int
}

// Type is a type of requests of a direction with the goals (service.request_types).
type Type struct {
	ID          string
	DirectionID uuid.UUID
	Kind, Name  string
	Goals       TypeGoals
	Priority    string
}

// Client is the client of a request (service.clients); Phone is whole here and never leaves the module unmasked.
type Client struct {
	ID               uuid.UUID
	Name, Company    string
	Phone            string
	OptedOut         bool
	CreatedAt, Since time.Time
}

// ObjectRef is a CRM record a request is about; a reference never grants access.
type ObjectRef struct {
	ModuleKey  string    `json:"moduleKey"`
	EntityType string    `json:"entityType"`
	EntityID   uuid.UUID `json:"entityId"`
}

// Link is the work a request is about: a CRM record or a free text with the lines the module of the work gave.
type Link struct {
	Kind   string     `json:"kind,omitempty"`
	Label  string     `json:"label"`
	Lines  []string   `json:"lines"`
	Object *ObjectRef `json:"object,omitempty"`
}

// Shared is the conclusion shared with the employee a complaint is about.
type Shared struct {
	Text string    `json:"text"`
	At   time.Time `json:"at"`
	By   uuid.UUID `json:"by"`
}

// TaskRef is a task of a request in «Задачи».
type TaskRef struct {
	ID     uuid.UUID `json:"id"`
	Key    string    `json:"key"`
	Title  string    `json:"title"`
	Status string    `json:"status"`
}

// Details is request_details.details: what has no column of its own.
type Details struct {
	ClientSince string               `json:"clientSince,omitempty"`
	Tasks       []TaskRef            `json:"tasks,omitempty"`
	Files       map[string][]FileRef `json:"files,omitempty"`
	Shown       []uuid.UUID          `json:"shown,omitempty"`
	Author      uuid.UUID            `json:"author,omitempty"`
	Warned      []string             `json:"warned,omitempty"`
	Escalated   []string             `json:"escalated,omitempty"`
	Breached    []string             `json:"breached,omitempty"`
	Rated       *int                 `json:"rated,omitempty"`
	ReopenedAt  *time.Time           `json:"reopenedAt,omitempty"`
}

// FileRef is a file of a message with the name the client gave.
type FileRef struct {
	ID        uuid.UUID `json:"id"`
	FileName  string    `json:"fileName"`
	SizeBytes int64     `json:"sizeBytes"`
}

// Request is a request of a client (service.requests with its client, timers and details).
type Request struct {
	ID, DirectionID uuid.UUID
	Number          int
	Key             string
	Kind, TypeID    string
	Title, Status   string
	Priority        string
	Channel         string
	Assignee        uuid.UUID // uuid.Nil: none
	About           uuid.UUID // the employee the complaint is about; uuid.Nil: none
	Client          Client
	Link            *Link
	Labels          []string
	Outcome         string
	Compensation    string
	Shared          *Shared
	FromRating      int
	CreatedAt       time.Time
	ResolvedAt      *time.Time
	UpdatedAt       time.Time
	Revision        int64
	OldKeys         []string
	SLA             SLA
	PausedAt        *time.Time
	Details         Details
}

// sla is the request as the terms are counted from it.
func (r *Request) sla() SLARequest {
	return SLARequest{Status: r.Status, At: r.CreatedAt, SLA: r.SLA, Outcome: r.Outcome, ResolvedAt: r.ResolvedAt}
}

// Message is a message of a request (service.messages).
type Message struct {
	ID, RequestID uuid.UUID
	Kind          string
	Author        uuid.UUID
	Text          string
	Channel       string
	Auto          bool
	Delivery      string
	Score         int
	Reasons       []string
	Contact       bool
	Files         []uuid.UUID
	At            time.Time
}

// Rating is a low rating after a service (service.ratings).
type Rating struct {
	ID, DirectionID uuid.UUID
	RequestID       uuid.UUID
	ClientID        uuid.UUID
	ClientName      string
	Score           int
	Reasons         []string
	Comment, Work   string
	Status          string
	At              time.Time
}

// Template is a template of a reply of a direction.
type Template struct{ ID, Name, Text string }
