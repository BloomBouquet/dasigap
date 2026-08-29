#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
COMPOSE_FILE="${DASIGAP_COMPOSE_FILE:-$SCRIPT_DIR/compose.production.yml}"
ENV_FILE="${DASIGAP_ENV_FILE:-/etc/dasigap/dasigap.env}"
STATE_DIR="${DASIGAP_STATE_DIR:-/opt/dasigap/state}"
STATE_FILE="$STATE_DIR/previous-image"
REQUESTED_TAG="${1:-}"

if [ -n "$REQUESTED_TAG" ]; then
  if ! printf '%s\n' "$REQUESTED_TAG" | grep -q '^sha-[0-9a-f]\{40\}$'; then
    echo "usage: $0 [sha-<40 lowercase hex git sha>]" >&2
    exit 2
  fi
  TARGET_IMAGE="ghcr.io/bloombouquet/dasigap:$REQUESTED_TAG"
else
  if [ ! -r "$STATE_FILE" ]; then
    echo "previous-image state is not available: $STATE_FILE" >&2
    exit 1
  fi
  TARGET_IMAGE=$(cat "$STATE_FILE")
fi

if ! printf '%s\n' "$TARGET_IMAGE" | grep -q '^ghcr.io/bloombouquet/dasigap:sha-[0-9a-f]\{40\}$'; then
  echo "rollback target is not an immutable dasigap application image" >&2
  exit 1
fi

if [ ! -r "$ENV_FILE" ]; then
  echo "production env file is not readable: $ENV_FILE" >&2
  exit 1
fi

command -v docker >/dev/null 2>&1 || {
  echo "docker is required" >&2
  exit 1
}

docker compose version >/dev/null 2>&1 || {
  echo "docker compose plugin is required" >&2
  exit 1
}

echo "Rolling application code back to $TARGET_IMAGE"
docker pull "$TARGET_IMAGE"
DASIGAP_IMAGE="$TARGET_IMAGE" DASIGAP_ENV_FILE="$ENV_FILE" \
  docker compose -f "$COMPOSE_FILE" up -d --no-deps --force-recreate dasigap

healthy=0
attempt=1
while [ "$attempt" -le 30 ]; do
  if docker exec dasigap node -e "fetch('http://127.0.0.1:3000/api/health',{cache:'no-store'}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 1
  attempt=$((attempt + 1))
done

if [ "$healthy" -ne 1 ]; then
  echo "rollback application container did not become healthy" >&2
  docker logs --tail 100 dasigap >&2 || true
  DASIGAP_IMAGE="$TARGET_IMAGE" DASIGAP_ENV_FILE="$ENV_FILE" \
    docker compose -f "$COMPOSE_FILE" stop dasigap >/dev/null 2>&1 || true
  exit 1
fi

echo "application rollback healthy: $TARGET_IMAGE"
echo "database schema is intentionally left at its current forward-migrated version"
