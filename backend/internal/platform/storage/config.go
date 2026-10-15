package storage

import (
	"errors"
	"fmt"
	"net/url"
	"strings"
)

// Config is the S3 storage of the deployment (deploy/compose/.env.example).
type Config struct {
	Endpoint       string // S3_ENDPOINT: server-side calls (http://minio:9000 inside compose)
	PublicEndpoint string // S3_PUBLIC_ENDPOINT: host of presigned URLs the browser opens; default Endpoint
	Region         string // S3_REGION: region of the signature
	Bucket         string // S3_BUCKET
	AccessKey      string // S3_ACCESS_KEY
	SecretKey      string // S3_SECRET_KEY
}

// defaultRegion signs requests when S3_REGION is empty (MinIO accepts any region).
const defaultRegion = "us-east-1"

// ConfigFromEnv reads the storage configuration. ok is false when S3_ENDPOINT is not set (storage not configured);
// otherwise every problem is reported at once and secrets never appear in the error.
func ConfigFromEnv(getenv func(string) string) (cfg Config, ok bool, err error) {
	get := func(k string) string { return strings.TrimSpace(getenv(k)) }
	cfg = Config{
		Endpoint: get("S3_ENDPOINT"), PublicEndpoint: get("S3_PUBLIC_ENDPOINT"), Region: get("S3_REGION"),
		Bucket: get("S3_BUCKET"), AccessKey: get("S3_ACCESS_KEY"), SecretKey: getenv("S3_SECRET_KEY"),
	}
	if cfg.Endpoint == "" {
		return Config{}, false, nil
	}
	if cfg.PublicEndpoint == "" {
		cfg.PublicEndpoint = cfg.Endpoint
	}
	if cfg.Region == "" {
		cfg.Region = defaultRegion
	}
	if err := cfg.Validate(); err != nil {
		return Config{}, false, err
	}
	return cfg, true, nil
}

// Validate reports every missing or malformed field.
func (c Config) Validate() error {
	var errs []error
	for _, e := range []struct{ name, value string }{{"S3_ENDPOINT", c.Endpoint}, {"S3_PUBLIC_ENDPOINT", c.PublicEndpoint}} {
		if _, err := parseEndpoint(e.value); err != nil {
			errs = append(errs, fmt.Errorf("%s: %w", e.name, err))
		}
	}
	for _, e := range []struct{ name, value string }{
		{"S3_BUCKET", c.Bucket}, {"S3_ACCESS_KEY", c.AccessKey}, {"S3_SECRET_KEY", c.SecretKey},
	} {
		if e.value == "" {
			errs = append(errs, fmt.Errorf("%s is not set (see deploy/compose/.env.example)", e.name))
		}
	}
	return errors.Join(errs...)
}

// parseEndpoint accepts an absolute http(s) URL without query; the error never quotes the value.
func parseEndpoint(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	switch {
	case err != nil:
		return nil, errors.New("not a URL")
	case u.Scheme != "http" && u.Scheme != "https":
		return nil, errors.New("want an http or https URL")
	case u.Host == "" || u.RawQuery != "" || u.User != nil:
		return nil, errors.New("want scheme://host[:port] without credentials or query")
	}
	u.Path = strings.TrimSuffix(u.Path, "/")
	return u, nil
}
