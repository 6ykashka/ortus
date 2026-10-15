// Package miniotest starts a throw-away MinIO server for integration tests (testcontainers-go) with the image of
// the compose stand. Without Docker it fails (never skips): a missing storage must not turn a suite green.
package miniotest

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"

	"github.com/ortus/ortus-crm/backend/internal/platform/storage"
)

// Image is the MinIO of deploy/compose/docker-compose.yml (pgsty/minio — Q-W0.06-1: the official images are not
// published anonymously since 10.2026). MINIO_TEST_IMAGE overrides it.
const Image = "pgsty/minio:RELEASE.2026-08-04T00-00-00Z@sha256:b6bfe7239bfc83fb90d31612d9704d86039dd714f7904b3f1ad68f211e602372"

// Credentials of the test server.
const (
	AccessKey = "ortus-test"
	SecretKey = "ortus-test-secret" //nolint:gosec // G101: password of a throw-away test container
	Bucket    = "ortus-files"
	Region    = "ru-local"
)

func image() string {
	if v := strings.TrimSpace(os.Getenv("MINIO_TEST_IMAGE")); v != "" {
		return v
	}
	return Image
}

// Start starts MinIO and returns the configuration of its bucket (created by the caller with EnsureBucket or by
// Start itself); stop terminates the container. Intended for TestMain.
func Start(ctx context.Context) (storage.Config, func(), error) {
	ctr, err := testcontainers.Run(ctx, image(),
		testcontainers.WithExposedPorts("9000/tcp"),
		testcontainers.WithEnv(map[string]string{"MINIO_ROOT_USER": AccessKey, "MINIO_ROOT_PASSWORD": SecretKey}),
		testcontainers.WithCmd("server", "/data"),
		testcontainers.WithWaitStrategy(wait.ForHTTP("/minio/health/ready").WithPort("9000/tcp").WithStartupTimeout(2*time.Minute)),
	)
	if err != nil {
		return storage.Config{}, nil, fmt.Errorf("miniotest: Docker недоступен или образ %s не запустился — запустите Docker Desktop: %w", image(), err)
	}
	stop := func() { _ = testcontainers.TerminateContainer(ctr) }
	endpoint, err := ctr.PortEndpoint(ctx, "9000/tcp", "http")
	if err != nil {
		stop()
		return storage.Config{}, nil, fmt.Errorf("miniotest: endpoint: %w", err)
	}
	cfg := storage.Config{
		Endpoint: endpoint, PublicEndpoint: endpoint, Region: Region, Bucket: Bucket, AccessKey: AccessKey, SecretKey: SecretKey,
	}
	if err := ensureBucket(ctx, cfg); err != nil {
		stop()
		return storage.Config{}, nil, fmt.Errorf("miniotest: bucket: %w", err)
	}
	return cfg, stop, nil
}

// ensureBucket creates the bucket; right after start MinIO may still answer 503 for a while.
func ensureBucket(ctx context.Context, cfg storage.Config) error {
	s, err := storage.NewS3(cfg, nil, nil)
	if err != nil {
		return err
	}
	deadline := time.Now().Add(30 * time.Second)
	for {
		err = s.EnsureBucket(ctx)
		if err == nil || time.Now().After(deadline) {
			return err
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(250 * time.Millisecond):
		}
	}
}
