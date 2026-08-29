#!/usr/bin/env bash
set -Eeuo pipefail

DASIGAP_ROOT="${DASIGAP_ROOT:-/home/ubuntu/dasigap}"
DASIGAP_RELEASES="$DASIGAP_ROOT/releases"
DASIGAP_SHARED="$DASIGAP_ROOT/shared"
PM2_BIN="${PM2_BIN:-pm2}"
CURL_BIN="${CURL_BIN:-curl}"

require_full_sha() {
  [[ "${1:-}" =~ ^[0-9a-f]{40}$ ]] || {
    echo "invalid release sha" >&2
    return 64
  }
}

release_path() {
  require_full_sha "${1:-}" || return $?
  printf '%s/%s\n' "$DASIGAP_RELEASES" "$1"
}

read_release_sha() {
  local release_dir="${1:-}"
  node -e '
    const fs = require("node:fs");
    const path = require("node:path");
    const file = path.join(process.argv[1], "release-metadata.json");
    const m = JSON.parse(fs.readFileSync(file, "utf8"));
    if (m.service !== "dasigap" || !/^[0-9a-f]{40}$/.test(m.commitSha)) process.exit(65);
    process.stdout.write(m.commitSha);
  ' "$release_dir"
}

require_release_identity() {
  local release_dir="$1" expected_sha="$2" actual_sha
  require_full_sha "$expected_sha" || return $?
  actual_sha="$(read_release_sha "$release_dir")" || return $?
  [[ "$actual_sha" == "$expected_sha" ]] || {
    echo "release metadata mismatch" >&2
    return 65
  }
}

atomic_link() {
  local target="$1" link="$2" temp="${link}.tmp.$$"
  rm -f "$temp"
  ln -s "$target" "$temp"
  mv -Tf "$temp" "$link"
}

validate_https_url() {
  node -e '
    const u = new URL(process.argv[1]);
    if (u.protocol !== "https:" || u.username || u.password || u.hash) process.exit(64);
  ' "${1:-}" >/dev/null 2>&1 || {
    echo "invalid production base url" >&2
    return 64
  }
}

wait_for_health() {
  local url="$1" sha="$2" expected_status="$3" body
  require_full_sha "$sha" || return $?

  for _attempt in $(seq 1 20); do
    if body="$("$CURL_BIN" --fail --silent --show-error --max-time 3 "$url" 2>/dev/null)"; then
      if printf '%s' "$body" | node -e '
        let body="";
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", chunk => body += chunk);
        process.stdin.on("end", () => {
          try {
            const value = JSON.parse(body);
            process.exit(value.status === process.argv[1] && value.release === process.argv[2] ? 0 : 1);
          } catch {
            process.exit(1);
          }
        });
      ' "$expected_status" "$sha" >/dev/null 2>&1; then
        return 0
      fi
    fi
    sleep 1
  done

  echo "health verification failed" >&2
  return 70
}

restore_release() {
  local old_target="${1:-}"
  [[ -n "$old_target" && -d "$old_target" ]] || return 66
  local old_sha
  old_sha="$(read_release_sha "$old_target")" || return $?
  require_release_identity "$old_target" "$old_sha" || return $?
  atomic_link "$old_target" "$DASIGAP_ROOT/current"
  "$PM2_BIN" startOrReload "$old_target/ops/pm2/ecosystem.config.cjs" --update-env >/dev/null
}
