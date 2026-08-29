#!/bin/sh
set -eu

COMMON_SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REGISTRY_IMAGE="${DASIGAP_REGISTRY_IMAGE:-ghcr.io/bloombouquet/dasigap}"
PRODUCTION_CONTAINER="${DASIGAP_PRODUCTION_CONTAINER:-dasigap}"
CANDIDATE_CONTAINER="${DASIGAP_CANDIDATE_CONTAINER:-dasigap-candidate}"
CANDIDATE_PORT="${DASIGAP_CANDIDATE_PORT:-3101}"
HEALTH_ATTEMPTS="${DASIGAP_HEALTH_ATTEMPTS:-30}"
HEALTH_SLEEP_SECONDS="${DASIGAP_HEALTH_SLEEP_SECONDS:-1}"
COMPOSE_FILE="${DASIGAP_COMPOSE_FILE:-$COMMON_SCRIPT_DIR/compose.production.yml}"
ENV_FILE="${DASIGAP_ENV_FILE:-/etc/dasigap/dasigap.env}"
STATE_DIR="${DASIGAP_STATE_DIR:-/opt/dasigap/state}"
STATE_FILE="$STATE_DIR/previous-image"

require_image_tag() {
  image_tag="${1:-}"
  printf '%s\n' "$image_tag" | grep -q '^sha-[0-9a-f]\{40\}$'
}

sha_from_image_tag() {
  image_tag="${1:-}"
  require_image_tag "$image_tag" || return 1
  printf '%s\n' "${image_tag#sha-}"
}

require_immutable_image() {
  image="${1:-}"
  printf '%s\n' "$image" | grep -q "^${REGISTRY_IMAGE}:sha-[0-9a-f]\\{40\\}$"
}

sha_from_immutable_image() {
  image="${1:-}"
  require_immutable_image "$image" || return 1
  sha_from_image_tag "${image#${REGISTRY_IMAGE}:}"
}

require_runtime_tools() {
  if [ ! -r "$ENV_FILE" ]; then
    echo "production env file is not readable: $ENV_FILE" >&2
    return 1
  fi

  command -v docker >/dev/null 2>&1 || {
    echo "docker is required" >&2
    return 1
  }

  docker compose version >/dev/null 2>&1 || {
    echo "docker compose plugin is required" >&2
    return 1
  }
}

current_production_image() {
  image=$(docker inspect -f '{{.Config.Image}}' "$PRODUCTION_CONTAINER" 2>/dev/null || true)
  if require_immutable_image "$image"; then
    printf '%s\n' "$image"
  fi
}

write_previous_image() {
  image="${1:-}"
  mkdir -p "$STATE_DIR"

  if require_immutable_image "$image"; then
    tmp="$STATE_FILE.tmp.$$"
    printf '%s\n' "$image" > "$tmp"
    chmod 600 "$tmp"
    mv -f "$tmp" "$STATE_FILE"
  else
    rm -f "$STATE_FILE"
  fi
}

remove_candidate() {
  docker rm -f "$CANDIDATE_CONTAINER" >/dev/null 2>&1 || true
}

verify_container_health() {
  container="${1:?container is required}"
  expected_sha="${2:?expected sha is required}"
  attempt=1

  while [ "$attempt" -le "$HEALTH_ATTEMPTS" ]; do
    if docker exec "$container" node -e '
      const expected = process.argv[1];
      (async () => {
        for (const [path, status] of [["/api/health/live", "ok"], ["/api/health/ready", "ready"]]) {
          const response = await fetch("http://127.0.0.1:3000" + path, { cache: "no-store" });
          const body = await response.json();
          if (!response.ok || body.status !== status || body.release !== expected) process.exit(1);
        }
      })().catch(() => process.exit(1));
    ' "$expected_sha" >/dev/null 2>&1; then
      return 0
    fi

    sleep "$HEALTH_SLEEP_SECONDS"
    attempt=$((attempt + 1))
  done

  return 1
}

validate_candidate() {
  image="${1:?candidate image is required}"
  expected_sha="${2:?candidate sha is required}"

  remove_candidate
  if ! docker run -d --name "$CANDIDATE_CONTAINER" \
    --env-file "$ENV_FILE" \
    -p "127.0.0.1:${CANDIDATE_PORT}:3000" \
    "$image" >/dev/null; then
    remove_candidate
    return 1
  fi

  if verify_container_health "$CANDIDATE_CONTAINER" "$expected_sha"; then
    remove_candidate
    return 0
  fi

  remove_candidate
  return 1
}

recreate_production() {
  image="${1:?production image is required}"
  DASIGAP_IMAGE="$image" DASIGAP_ENV_FILE="$ENV_FILE" \
    docker compose -f "$COMPOSE_FILE" up -d --no-deps --force-recreate "$PRODUCTION_CONTAINER"
}

stop_production() {
  docker rm -f "$PRODUCTION_CONTAINER" >/dev/null 2>&1 || true
}

restore_production() {
  image="${1:?restore image is required}"
  expected_sha=$(sha_from_immutable_image "$image") || return 1

  recreate_production "$image" >/dev/null || return 1
  verify_container_health "$PRODUCTION_CONTAINER" "$expected_sha"
}
