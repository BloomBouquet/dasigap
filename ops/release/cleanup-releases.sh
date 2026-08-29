#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=ops/release/common.sh
source "$SCRIPT_DIR/common.sh"

mkdir -p "$DASIGAP_RELEASES"
releases_real="$(realpath "$DASIGAP_RELEASES")"

declare -A protected=()

protect_link_target() {
  local link="$1"
  [[ -L "$link" ]] || return 0

  local target parent name
  target="$(readlink -f "$link" 2>/dev/null || true)"
  [[ -n "$target" && -d "$target" ]] || return 0
  parent="$(realpath "$(dirname "$target")")"
  [[ "$parent" == "$releases_real" ]] || return 0
  name="$(basename "$target")"
  [[ "$name" =~ ^[0-9a-f]{40}$ ]] || return 0
  protected["$name"]=1
}

protect_link_target "$DASIGAP_ROOT/current"
protect_link_target "$DASIGAP_ROOT/previous"

kept_additional=0
while IFS= read -r entry; do
  [[ -n "$entry" ]] || continue
  name="${entry#* }"
  [[ "$name" =~ ^[0-9a-f]{40}$ ]] || continue
  [[ -n "${protected[$name]:-}" ]] && continue
  if (( kept_additional < 3 )); then
    protected["$name"]=1
    kept_additional=$((kept_additional + 1))
  fi
done < <(
  find "$DASIGAP_RELEASES" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %f\n' \
    | awk '$2 ~ /^[0-9a-f]{40}$/' \
    | sort -nr
)

while IFS= read -r name; do
  [[ "$name" =~ ^[0-9a-f]{40}$ ]] || continue
  [[ -n "${protected[$name]:-}" ]] && continue
  rm -rf -- "$DASIGAP_RELEASES/$name"
done < <(
  find "$DASIGAP_RELEASES" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' \
    | awk '$0 ~ /^[0-9a-f]{40}$/'
)
