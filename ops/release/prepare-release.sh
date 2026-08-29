#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=ops/release/common.sh
source "$SCRIPT_DIR/common.sh"

staging_dir="${1:-}"
sha="${2:-}"
require_full_sha "$sha"
[[ -d "$staging_dir" ]] || { echo "release staging directory is missing" >&2; exit 66; }

mkdir -p "$DASIGAP_RELEASES" "$DASIGAP_ROOT/.staging"
staging_real="$(realpath "$staging_dir")"
staging_root="$(realpath "$DASIGAP_ROOT/.staging")"
[[ "$staging_real" == "$staging_root/"* ]] || {
  echo "invalid release staging path" >&2
  exit 64
}

require_release_identity "$staging_real" "$sha"
final_dir="$(release_path "$sha")"

if [[ -e "$final_dir" ]]; then
  [[ -d "$final_dir" ]] || { echo "immutable release path is not a directory" >&2; exit 65; }
  require_release_identity "$final_dir" "$sha"
  exit 0
fi

load_production_env

(
  cd "$staging_real"
  pnpm install --frozen-lockfile --prod=false
  pnpm db:generate
  pnpm prisma migrate deploy
)

[[ ! -e "$final_dir" ]] || { echo "immutable release path already exists" >&2; exit 65; }
mv "$staging_real" "$final_dir"
require_release_identity "$final_dir" "$sha"
