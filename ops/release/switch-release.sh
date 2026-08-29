#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=ops/release/common.sh
source "$SCRIPT_DIR/common.sh"

target_sha="${1:-}"
production_base_url="${2:-}"
require_full_sha "$target_sha"
validate_https_url "$production_base_url"
production_base_url="${production_base_url%/}"

target="$(release_path "$target_sha")"
[[ -d "$target" ]] || { echo "target release is not installed" >&2; exit 66; }
require_release_identity "$target" "$target_sha"
load_production_env

candidate_validator="${CANDIDATE_VALIDATOR:-$target/ops/release/validate-candidate.sh}"
[[ -f "$candidate_validator" ]] || { echo "candidate validator is missing" >&2; exit 66; }
bash "$candidate_validator" "$target" "$target_sha"

old_target=""
if [[ -L "$DASIGAP_ROOT/current" ]]; then
  old_target="$(readlink -f "$DASIGAP_ROOT/current")"
  [[ -d "$old_target" ]] || { echo "current release target is invalid" >&2; exit 65; }
  old_sha="$(read_release_sha "$old_target")"
  require_release_identity "$old_target" "$old_sha"
fi

if [[ -n "$old_target" && "$old_target" != "$target" ]]; then
  atomic_link "$old_target" "$DASIGAP_ROOT/previous"
fi
atomic_link "$target" "$DASIGAP_ROOT/current"

production_port="${PORT:-3000}"
[[ "$production_port" =~ ^[0-9]+$ ]] && (( production_port >= 1 && production_port <= 65535 )) || {
  echo "invalid production port" >&2
  if [[ -n "$old_target" ]]; then restore_release "$old_target" || true; else rm -f "$DASIGAP_ROOT/current"; fi
  exit 64
}

post_switch_failed=0
"$PM2_BIN" startOrReload "$target/ops/pm2/ecosystem.config.cjs" --update-env >/dev/null || post_switch_failed=1

if (( post_switch_failed == 0 )); then
  wait_for_health "http://127.0.0.1:${production_port}/api/health/live" "$target_sha" ok || post_switch_failed=1
fi
if (( post_switch_failed == 0 )); then
  wait_for_health "http://127.0.0.1:${production_port}/api/health/ready" "$target_sha" ready || post_switch_failed=1
fi
if (( post_switch_failed == 0 )); then
  wait_for_health "${production_base_url}/api/health/ready" "$target_sha" ready || post_switch_failed=1
fi

if (( post_switch_failed != 0 )); then
  if [[ -n "$old_target" ]]; then
    old_sha="$(read_release_sha "$old_target" 2>/dev/null || true)"
    restore_release "$old_target" || true
    if [[ "$old_sha" =~ ^[0-9a-f]{40}$ ]]; then
      wait_for_health "http://127.0.0.1:${production_port}/api/health/live" "$old_sha" ok >/dev/null 2>&1 || true
      wait_for_health "http://127.0.0.1:${production_port}/api/health/ready" "$old_sha" ready >/dev/null 2>&1 || true
      wait_for_health "${production_base_url}/api/health/ready" "$old_sha" ready >/dev/null 2>&1 || true
    fi
  else
    rm -f "$DASIGAP_ROOT/current"
  fi
  echo "post-switch verification failed" >&2
  exit 70
fi

cleanup_script="${CLEANUP_RELEASES:-$SCRIPT_DIR/cleanup-releases.sh}"
if [[ -f "$cleanup_script" ]]; then
  bash "$cleanup_script" || echo "release cleanup warning" >&2
fi
