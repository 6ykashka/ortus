package migrations

import "net/url"

// TenantDSN derives the DSN of tenant database db from a control DSN (normally MIGRATOR_DB_URL): the same
// credentials and options, host replaced by host (TENANT_DB_HOST) when it is not empty.
func TenantDSN(control, host, db string) (string, error) {
	u, err := url.Parse(control)
	if err != nil {
		return "", err
	}
	if host != "" {
		u.Host = host
	}
	u.Path = "/" + db
	u.RawPath = ""
	return u.String(), nil
}
