#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=release-common.sh
. "$SCRIPT_DIR/release-common.sh"

IMAGE_TAG="${1:-}"
if ! require_image_tag "$IMAGE_TAG"; then
  echo "usage: $0 sha-<40 lowercase hex git sha>" >&2
  exit 2
fi

require_runtime_tools

TARGET_SHA=$(sha_from_image_tag "$IMAGE_TAG")
APP_IMAGE="$REGISTRY_IMAGE:$IMAGE_TAG"
MIGRATION_IMAGE="$REGISTRY_IMAGE:migrate-$IMAGE_TAG"
PREVIOUS_IMAGE=$(current_production_image)

echo "Pulling immutable release artifacts..."
docker pull "$MIGRATION_IMAGE"
docker pull "$APP_IMAGE"

echo "Applying database migrations before candidate validation..."
docker run --rm --network host --env-file "$ENV_FILE" "$MIGRATION_IMAGE"

echo "Validating loopback release candidate..."
if ! validate_candidate "$APP_IMAGE" "$TARGET_SHA"; then
  echo "release candidate did not satisfy live, ready, and release identity checks" >&2
  exit 1
fi

write_previous_image "$PREVIOUS_IMAGE"

echo "Replacing production application..."
if ! recreate_production "$APP_IMAGE" >/dev/null; then
  echo "production replacement failed" >&2
  if [ -n "$PREVIOUS_IMAGE" ]; then
    restore_production "$PREVIOUS_IMAGE" >/dev/null 2>&1 || true
  else
    stop_production
  fi
  exit 1
fi

if ! verify_container_health "$PRODUCTION_CONTAINER" "$TARGET_SHA"; then
  echo "production application failed post-switch verification" >&2
  if [ -n "$PREVIOUS_IMAGE" ]; then
    if ! restore_production "$PREVIOUS_IMAGE"; then
      echo "previous application restoration also failed" >&2
    fi
  else
    stop_production
  fi
  echo "database migrations are intentionally not downgraded" >&2
  exit 1
fi

echo "deployment healthy: $APP_IMAGE"
