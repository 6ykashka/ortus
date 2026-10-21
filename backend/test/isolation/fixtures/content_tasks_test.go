package fixtures

import (
	"errors"
	"maps"
	"slices"
	"strings"
	"testing"
)

// W4.11: the content of tasks — «Автопарк» limited and «Стройка» closed in both tenants, three tasks and a rule each,
// with references task:<t>.<key> and automation:<t>.<key>.
func TestTaskContent(t *testing.T) {
	t.Parallel()
	c := Default()
	refs := c.Refs()
	for _, ref := range []string{"task:a.fleet-1", "task:a.fleet-2", "task:a.build-1", "automation:a.fleet-rule",
		"task:b.fleet-1", "task:b.fleet-2", "task:b.build-1", "automation:b.fleet-rule"} {
		if !slices.Contains(refs, ref) {
			t.Errorf("Refs() has no %s", ref)
		}
	}
	if slices.Contains(refs, "task:a.nope") {
		t.Error("an unknown task resolves")
	}
	if ids := c.TenantIDs(TenantB); !slices.Contains(ids, nameID("task:b.fleet-1")) || slices.Contains(ids, nameID("task:a.fleet-1")) {
		t.Error("the tasks of B belong to B only")
	}
	a := c.Tenants[0].Content
	levels := map[string]string{}
	for _, p := range a.Projects {
		levels[p.Object] = p.Level
	}
	if levels[projectFleet] != LevelLimited || levels[projectBuild] != LevelClosed {
		t.Errorf("levels %v: «Автопарк» limited, «Стройка» closed (TP-03)", levels)
	}
}

// W4.11 возврат 1: the attachments of tasks for the rows of listFiles and getFile — file:<t>.fleet-1 on the task
// fleet-1 of «Автопарк», file:<t>.build-1 on the task build-1 of the closed «Стройка», in both tenants.
func TestTaskFiles(t *testing.T) {
	t.Parallel()
	c := Default()
	refs := c.Refs()
	for _, ref := range []string{"file:a.fleet-1", "file:a.build-1", "file:b.fleet-1", "file:b.build-1"} {
		if !slices.Contains(refs, ref) {
			t.Errorf("Refs() has no %s", ref)
		}
	}
	for _, tn := range c.Tenants {
		got := map[string]string{}
		for _, f := range tn.Content.Files {
			if f.Task != "" {
				if f.Vehicle != "" || f.Name == "" {
					t.Errorf("file %s.%s: a task file names no vehicle and has a name", tn.Key, f.Key)
				}
				got[f.Key] = f.Task
			}
		}
		if want := map[string]string{"fleet-1": "fleet-1", "build-1": "build-1"}; !maps.Equal(got, want) {
			t.Errorf("task files of %s: %v, want %v", tn.Key, got, want)
		}
	}
}

func TestValidateTaskFiles(t *testing.T) {
	t.Parallel()
	for name, tc := range map[string]struct {
		edit func(*Catalog)
		want string
	}{
		"file of no task": {func(c *Catalog) {
			c.Tenants[0].Content.Files = append(c.Tenants[0].Content.Files, FileDef{Key: "x", Task: "nope", Name: "x.pdf"})
		},
			"unknown task"},
		"file of a vehicle and a task": {func(c *Catalog) {
			c.Tenants[0].Content.Files = append(c.Tenants[0].Content.Files, FileDef{Key: "x", Vehicle: uMsk1, Task: "fleet-1", Name: "x.pdf"})
		}, "a vehicle or a task"},
	} {
		c := Default()
		tc.edit(&c)
		err := c.Validate()
		if !errors.Is(err, ErrInvalid) || !strings.Contains(err.Error(), tc.want) {
			t.Errorf("%s: %v, want %q", name, err, tc.want)
		}
	}
}

func TestValidateTaskContent(t *testing.T) {
	t.Parallel()
	for name, tc := range map[string]struct {
		edit func(*Catalog)
		want string
	}{
		"project of no object":  {func(c *Catalog) { c.Tenants[0].Content.Projects[0].Object = "nope" }, "no object project"},
		"bad level":             {func(c *Catalog) { c.Tenants[0].Content.Projects[0].Level = "secret" }, "level"},
		"task of no project":    {func(c *Catalog) { c.Tenants[0].Content.Tasks[0].Project = "nope" }, "unknown project"},
		"assignee of no tenant": {func(c *Catalog) { c.Tenants[0].Content.Tasks[0].Assignee = "b.owner" }, "unknown project or people"},
		"rule without author":   {func(c *Catalog) { c.Tenants[0].Content.Rules[0].Author = "" }, "unknown project or author"},
	} {
		c := Default()
		tc.edit(&c)
		err := c.Validate()
		if !errors.Is(err, ErrInvalid) || !strings.Contains(err.Error(), tc.want) {
			t.Errorf("%s: %v, want %q", name, err, tc.want)
		}
	}
}
