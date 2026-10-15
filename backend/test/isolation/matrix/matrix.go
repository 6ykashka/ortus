// Package matrix is the isolation matrix of Ortus: the format of backend/test/isolation/<module>.yaml
// (endpoint × actor × object → expected result), its checks, and the runner of its rows against a target API.
//
// Rule 3 of plan 27: every endpoint adds rows, the suite blocks merge, rows are written before the handler.
// A row whose handler does not exist yet carries «pending: <WS>»: it passes on 501 from the target or when the
// operation gateway already answers what the row expects (401/403/404 before the handler), and a 2xx to a positive
// row tells to remove pending. Built with the tag isolation_pending it checks its real expectations only (red
// until the handler lands).
package matrix

import (
	"bytes"
	"errors"
	"fmt"
	"path/filepath"
	"regexp"
	"slices"
	"strings"

	"go.yaml.in/yaml/v3"

	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures"
)

// File is one <module>.yaml.
type File struct {
	Module    string     `yaml:"module"`
	Endpoints []Endpoint `yaml:"endpoints"`
}

// Endpoint is one operation of the API and its rows.
type Endpoint struct {
	Op      string `yaml:"op"`     // operationId (OpenAPI)
	Method  string `yaml:"method"` // GET | POST | PUT | PATCH | DELETE
	Path    string `yaml:"path"`   // /api/v1/…, {param} placeholders
	Channel string `yaml:"channel,omitempty"`
	Pending string `yaml:"pending,omitempty"` // WS that adds the handler; until then 501 is accepted
	Rows    []Row  `yaml:"rows"`
}

// Row is one line of the matrix: an actor requests an object and gets an expected result.
type Row struct {
	Actor   string            `yaml:"actor"`            // fixtures actor key or anonymous
	Params  map[string]string `yaml:"params,omitempty"` // path parameter → fixture reference
	Status  int               `yaml:"status"`
	Code    string            `yaml:"code,omitempty"`    // Problem.code of an error answer (errors.yaml); "" — any
	Present []string          `yaml:"present,omitempty"` // references whose ids must be in the body
	Absent  []string          `yaml:"absent,omitempty"`  // references whose ids must not be in the body
	Body    string            `yaml:"body,omitempty"`    // JSON request body; {{reference}} → id
	Note    string            `yaml:"note,omitempty"`
}

// Channels of 15-quality-security.md. Only ChannelHTTP is run so far; the others are added with their owners
// (Data Hub, export, search, files — W1.04 and the modules; notifications, realtime — W1.07, W1.10; audit — W1.01).
const ChannelHTTP = "http"

var (
	channels  = []string{ChannelHTTP, "data", "export", "search", "files", "notifications", "realtime", "audit"}
	supported = []string{ChannelHTTP}
	methods   = []string{"GET", "POST", "PUT", "PATCH", "DELETE"}
	statuses  = []int{200, 201, 204, 401, 403, 404, 409}
	// Modules whose generated file would collide with the hand-written files of the suite.
	reserved = []string{"main", "target", "fixtures", "suite", "doc"}

	moduleRe  = regexp.MustCompile(`^[a-z][a-z0-9]*(_[a-z0-9]+)*$`)
	opRe      = regexp.MustCompile(`^[a-z][A-Za-z0-9]*$`)
	pendingRe = regexp.MustCompile(`^W\d+\.\d{2}$`)
	codeRe    = regexp.MustCompile(`^[a-z][a-z0-9]*(_[a-z0-9]+)*$`)
	paramRe   = regexp.MustCompile(`\{([A-Za-z][A-Za-z0-9]*)\}`)
)

// ErrInvalid wraps every format error of Parse.
var ErrInvalid = errors.New("invalid isolation matrix")

// IsNegative reports whether a row checks a denial or a leak: 401/403/404 or ids that must be absent.
func (r Row) IsNegative() bool {
	return r.Status == 401 || r.Status == 403 || r.Status == 404 || len(r.Absent) > 0
}

// PathParams returns the {param} names of a path in order.
func PathParams(path string) []string {
	var out []string
	for _, m := range paramRe.FindAllStringSubmatch(path, -1) {
		out = append(out, m[1])
	}
	return out
}

// Parse decodes and checks one matrix file. name is the file name (<module>.yaml); references and actors
// are checked against cat. Every problem is reported, each with its location.
func Parse(name string, data []byte, cat fixtures.Catalog) (File, error) {
	var f File
	dec := yaml.NewDecoder(bytes.NewReader(data))
	dec.KnownFields(true)
	if err := dec.Decode(&f); err != nil {
		return File{}, fmt.Errorf("%w: %s: %w", ErrInvalid, name, err)
	}
	for i := range f.Endpoints {
		if f.Endpoints[i].Channel == "" {
			f.Endpoints[i].Channel = ChannelHTTP
		}
	}
	c := checker{name: name, cat: cat}
	c.file(f)
	if len(c.errs) > 0 {
		return File{}, fmt.Errorf("%w:\n%w", ErrInvalid, errors.Join(c.errs...))
	}
	return f, nil
}

type checker struct {
	name string
	cat  fixtures.Catalog
	errs []error
}

func (c *checker) fail(at, format string, args ...any) {
	loc := c.name
	if at != "" {
		loc += ": " + at
	}
	c.errs = append(c.errs, fmt.Errorf("%s: %s", loc, fmt.Sprintf(format, args...)))
}

func (c *checker) file(f File) {
	base := strings.TrimSuffix(filepath.Base(c.name), ".yaml")
	switch {
	case !moduleRe.MatchString(f.Module):
		c.fail("", "module name %q must match %s", f.Module, moduleRe)
	case slices.Contains(reserved, f.Module):
		c.fail("", "module name %q is reserved (%v)", f.Module, reserved)
	case f.Module != base:
		c.fail("", "module %q must equal the file name %q", f.Module, base)
	}
	if len(f.Endpoints) == 0 {
		c.fail("", "no endpoints")
	}
	ops := map[string]bool{}
	for i, ep := range f.Endpoints {
		at := fmt.Sprintf("endpoints[%d]", i)
		if ops[ep.Op] {
			c.fail(at, "duplicate op %q", ep.Op)
		}
		ops[ep.Op] = true
		c.endpoint(at, ep)
	}
}

func (c *checker) endpoint(at string, ep Endpoint) {
	if !opRe.MatchString(ep.Op) {
		c.fail(at, "op %q must be an operationId (%s)", ep.Op, opRe)
	}
	if !slices.Contains(methods, ep.Method) {
		c.fail(at, "method %q is not one of %v", ep.Method, methods)
	}
	if !strings.HasPrefix(ep.Path, "/api/v1/") {
		c.fail(at, "path %q must start with /api/v1/", ep.Path)
	}
	switch {
	case !slices.Contains(channels, ep.Channel):
		c.fail(at, "channel %q is not one of %v", ep.Channel, channels)
	case !slices.Contains(supported, ep.Channel):
		c.fail(at, "channel %q is not supported yet (runner: %v); its owner adds it to matrix.Check", ep.Channel, supported)
	}
	if ep.Pending != "" && !pendingRe.MatchString(ep.Pending) {
		c.fail(at, "pending %q must be a WS id like W0.09", ep.Pending)
	}
	if len(ep.Rows) == 0 {
		c.fail(at, "no rows")
		return
	}
	params := PathParams(ep.Path)
	seen := map[string]bool{}
	negative := false
	for j, r := range ep.Rows {
		rat := fmt.Sprintf("%s.rows[%d]", at, j)
		key := r.Actor + "|" + paramKey(r.Params)
		if seen[key] {
			c.fail(rat, "duplicate row: actor %s with the same params", r.Actor)
		}
		seen[key] = true
		negative = negative || r.IsNegative()
		c.row(rat, params, r)
	}
	if !negative {
		c.fail(at, "no negative row: an isolation endpoint needs a 401/403/404 row or a row with absent ids")
	}
}

func (c *checker) row(at string, params []string, r Row) {
	if r.Actor != fixtures.Anonymous && !c.cat.HasActor(r.Actor) {
		c.fail(at, "unknown actor %q", r.Actor)
	}
	if !slices.Contains(statuses, r.Status) {
		c.fail(at, "status %d is not one of %v", r.Status, statuses)
	}
	if r.Status >= 400 && len(r.Present) > 0 {
		c.fail(at, "present ids make no sense with status %d (an error body names no objects)", r.Status)
	}
	c.code(at, r)
	for _, p := range params {
		if _, ok := r.Params[p]; !ok {
			c.fail(at, "path param %q has no value", p)
		}
	}
	for p, ref := range r.Params {
		if !slices.Contains(params, p) {
			c.fail(at, "param %q is not in the path", p)
		}
		c.ref(at, "params."+p, ref)
	}
	for _, ref := range r.Present {
		c.ref(at, "present", ref)
	}
	for _, ref := range r.Absent {
		c.ref(at, "absent", ref)
	}
	for _, ref := range BodyRefs(r.Body) {
		c.ref(at, "body", ref)
	}
}

// code checks the expected Problem code of a row: only with an error status, in the snake_case of errors.yaml.
func (c *checker) code(at string, r Row) {
	switch {
	case r.Code == "":
	case r.Status < 400:
		c.fail(at, "code %q needs an error status, not %d", r.Code, r.Status)
	case !codeRe.MatchString(r.Code):
		c.fail(at, "code %q must be a Problem code like function_blocked (%s)", r.Code, codeRe)
	}
}

func (c *checker) ref(at, field, ref string) {
	if _, err := c.cat.ID(ref); err != nil {
		c.fail(at, "%s: unknown reference %q", field, ref)
	}
}

func paramKey(p map[string]string) string {
	keys := make([]string, 0, len(p))
	for k := range p {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	var b strings.Builder
	for _, k := range keys {
		b.WriteString(k + "=" + p[k] + ";")
	}
	return b.String()
}
