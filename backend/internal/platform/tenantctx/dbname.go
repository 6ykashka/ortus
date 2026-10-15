package tenantctx

import (
	"errors"
	"fmt"
	"regexp"
	"slices"
)

// ErrDatabaseName marks a tenant_routing.database_name that is not the name of a tenant database.
var ErrDatabaseName = errors.New("not a tenant database name")

// tenantDatabase is the shape of a tenant database name: a lower-case identifier that needs no quoting, at most
// 63 bytes (NAMEDATALEN − 1).
var tenantDatabase = regexp.MustCompile(`^[a-z_][a-z0-9_]{0,62}$`)

// serviceDatabases are never tenant databases: the maintenance and template databases of the cluster and the
// control DB of the stand (deploy/compose/.env.example).
var serviceDatabases = []string{"postgres", "template0", "template1", "ortus_control"}

// CheckDatabaseName rejects a database name a tenant pool or the migration controller must never open: an empty
// name (a DSN path «/» means the default database of the role), a service database, or a name outside the
// identifier shape. There is no fallback database (S1-02, 02-architecture §3).
func CheckDatabaseName(name string, reserved ...string) error {
	switch {
	case name == "":
		return fmt.Errorf("%w: empty", ErrDatabaseName)
	case slices.Contains(serviceDatabases, name) || slices.Contains(reserved, name):
		return fmt.Errorf("%w: %q is a service database", ErrDatabaseName, name)
	case !tenantDatabase.MatchString(name):
		return fmt.Errorf("%w: %q", ErrDatabaseName, name)
	}
	return nil
}
