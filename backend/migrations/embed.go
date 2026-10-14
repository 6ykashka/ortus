// Package migrations holds the goose SQL migrations of the control DB and of every tenant DB
// (design/docs/db v0.2) and a small runner around goose for cmd/migrate, cmd/seed and test harnesses.
//
// Numbers are issued by the contract steward (plan §3.5); drafts live in tenant/drafts/ and are not embedded.
package migrations

import (
	"embed"
	"fmt"
	"io/fs"
	"strconv"
)

// Kind selects a migration set.
type Kind string

// Migration sets.
const (
	Control Kind = "control"
	Tenant  Kind = "tenant"
)

//go:embed control/*.sql
var controlFS embed.FS

//go:embed tenant/*.sql
var tenantFS embed.FS

// FS returns the embedded migration files of a kind, rooted at the kind directory.
// It panics on an unknown kind: kinds are compile-time constants.
func FS(k Kind) fs.FS {
	var (
		root embed.FS
		dir  string
	)
	switch k {
	case Control:
		root, dir = controlFS, "control"
	case Tenant:
		root, dir = tenantFS, "tenant"
	default:
		panic(fmt.Sprintf("migrations: unknown kind %q", k))
	}
	sub, err := fs.Sub(root, dir)
	if err != nil {
		panic(fmt.Sprintf("migrations: %v", err))
	}
	return sub
}

// Latest returns the newest version of a kind (the NNNN prefix of the last file).
func Latest(k Kind) int64 {
	names, err := fs.Glob(FS(k), "*.sql")
	if err != nil || len(names) == 0 {
		return 0
	}
	v, err := strconv.ParseInt(names[len(names)-1][:4], 10, 64)
	if err != nil {
		return 0
	}
	return v
}
