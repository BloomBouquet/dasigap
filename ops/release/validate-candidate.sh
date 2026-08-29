#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=ops/release/common.sh
source "$SCRIPT_DIR/common.sh"

release_dir="${1:-}"
sha="${2:-}"
require_full_sha "$sha"
[[ -d "$release_dir" ]] || { echo "candidate release is missing" >&2; exit 66; }
require_release_identity "$release_dir" "$sha"
load_production_env

candidate_port="${DASIGAP_CANDIDATE_PORT:-3101}"
[[ "$candidate_port" =~ ^[0-9]+$ ]] && (( candidate_port >= 1 && candidate_port <= 65535 )) || {
  echo "invalid candidate port" >&2
  exit 64
}

candidate_log="$(mktemp "${TMPDIR:-/tmp}/dasigap-candidate.XXXXXX.log")"
chmod 600 "$candidate_log"
candidate_pid=""

cleanup_candidate() {
  if [[ -n "$candidate_pid" ]]; then
    kill "$candidate_pid" 2>/dev/null || true
    wait "$candidate_pid" 2>/dev/null || true
  fi
  rm -f "$candidate_log"
}
trap cleanup_candidate EXIT

HOSTNAME=127.0.0.1 \
PORT="$candidate_port" \
NODE_ENV=production \
DASIGAP_RELEASE_SHA="$sha" \
  pnpm --dir "$release_dir" exec next start -H 127.0.0.1 -p "$candidate_port" >"$candidate_log" 2>&1 &
candidate_pid=$!

wait_for_health "http://127.0.0.1:${candidate_port}/api/health/live" "$sha" ok
wait_for_health "http://127.0.0.1:${candidate_port}/api/health/ready" "$sha" ready
