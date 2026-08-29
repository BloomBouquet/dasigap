#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=release-common.sh
. "$SCRIPT_DIR/release-common.sh"

REQUESTED="${1:-}"
RECOVERY_MODE=0

if [ "$REQUESTED" = "--restore-previous-or-stop" ]; then
  RECOVERY_MODE=1
  REQUESTED=""
fi

require_runtime_tools
CURRENT_IMAGE=$(current_production_image)

if [ -n "$REQUESTED" ]; then
  if ! require_image_tag "$REQUESTED"; then
    echo "usage: $0 [sha-<40 lowercase hex git sha>|--restore-previous-or-stop]" >&2
    exit 2
  fi
  TARGET_IMAGE="$REGISTRY_IMAGE:$REQUESTED"
elif [ -r "$STATE_FILE" ]; then
  TARGET_IMAGE=$(cat "$STATE_FILE")
else
  if [ "$RECOVERY_MODE" -eq 1 ]; then
    stop_production
    echo "no previous application is available; failed production application was stopped" >&2
    exit 0
  fi
  echo "previous-image state is not available: $STATE_FILE" >&2
  exit 1
fi

if ! require_immutable_image "$TARGET_IMAGE"; then
  echo "rollback target is not an immutable dasigap application image" >&2
  exit 1
fi

TARGET_SHA=$(sha_from_immutable_image "$TARGET_IMAGE")

echo "Pulling immutable rollback application..."
docker pull "$TARGET_IMAGE"

echo "Validating rollback candidate..."
if ! validate_candidate "$TARGET_IMAGE" "$TARGET_SHA"; then
  echo "rollback candidate did not satisfy live, ready, and release identity checks" >&2
  exit 1
fi

if [ "$RECOVERY_MODE" -eq 0 ]; then
  write_previous_image "$CURRENT_IMAGE"
fi

echo "Switching production application to rollback target..."
if ! recreate_production "$TARGET_IMAGE" >/dev/null; then
  echo "rollback production replacement failed" >&2
  if [ -n "$CURRENT_IMAGE" ] && [ "$CURRENT_IMAGE" != "$TARGET_IMAGE" ]; then
    restore_production "$CURRENT_IMAGE" >/dev/null 2>&1 || true
  fi
  exit 1
fi

if ! verify_container_health "$PRODUCTION_CONTAINER" "$TARGET_SHA"; then
  echo "rollback target failed post-switch verification" >&2
  if [ -n "$CURRENT_IMAGE" ] && [ "$CURRENT_IMAGE" != "$TARGET_IMAGE" ]; then
    if ! restore_production "$CURRENT_IMAGE"; then
      echo "original application restoration also failed" >&2
    fi
  else
    stop_production
  fi
  exit 1
fi

echo "application rollback healthy: $TARGET_IMAGE"
echo "database schema is intentionally left at its current forward-compatible version"
