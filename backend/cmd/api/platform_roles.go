package main

// W4.60 (Q-W4.07-14, Q-W4.07-18): the role of a platform operator on the gateway of /platform/**.

import (
	"context"

	"github.com/google/uuid"
)

// platformRoles reads the role of an active operator (platform_operators.role); "" — not an active operator.
type platformRoles interface {
	PlatformRole(ctx context.Context, account uuid.UUID) (string, error)
}
