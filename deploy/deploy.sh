#!/bin/sh
set -eu

IMAGE_TAG="${1:-}"

if ! printf '%s\n' "$IMAGE_TAG" | grep -q '^sha-[0-9a-f]\{40\}$'; then
  echo "usage: $0 sha-<40 lowercase hex git sha>" >&2
  exit 2
fi

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
COMPOSE_FILE="${DASIGAP_COMPOSE_FILE:-$SCRIPT_DIR/compose.production.yml}"
ENV_FILE="${DASIGAP_ENV_FILE:-/etc/dasigap/dasigap.env}"
STATE_DIR="${DASIGAP_STATE_DIR:-/opt/dasigap/state}"
STATE_FILE="$STATE_DIR/previous-image"
APP_IMAGE="ghcr.io/bloombouquet/dasigap:$IMAGE_TAG"
MIGRATION_IMAGE="ghcr.io/bloombouquet/dasigap:migrate-$IMAGE_TAG"

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

mkdir -p "$STATE_DIR"

previous_image=$(docker inspect -f '{{.Config.Image}}' dasigap 2>/dev/null || true)
if printf '%s\n' "$previous_image" | grep -q '^ghcr.io/bloombouquet/dasigap:sha-[0-9a-f]\{40\}$'; then
  printf '%s\n' "$previous_image" > "$STATE_FILE"
  chmod 600 "$STATE_FILE"
fi

echo "Pulling immutable release artifacts..."
docker pull "$MIGRATION_IMAGE"
docker pull "$APP_IMAGE"

echo "Applying database migrations before application replacement..."
docker run --rm --network host --env-file "$ENV_FILE" "$MIGRATION_IMAGE"

echo "Replacing application container..."
DASIGAP_IMAGE="$APP_IMAGE" DASIGAP_ENV_FILE="$ENV_FILE" \
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
  echo "new application container did not become healthy" >&2
  docker logs --tail 100 dasigap >&2 || true
  DASIGAP_IMAGE="$APP_IMAGE" DASIGAP_ENV_FILE="$ENV_FILE" \
    docker compose -f "$COMPOSE_FILE" stop dasigap >/dev/null 2>&1 || true
  echo "application rollout stopped; database migrations are not automatically downgraded" >&2
  exit 1
fi

echo "deployment healthy: $APP_IMAGE"
