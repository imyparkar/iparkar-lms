#!/usr/bin/env bash
# Upload a course's protected drawings to the private R2 bucket (never public).
#   scripts/upload-study-assets.sh asp-sps            # uploads imports/asp-sps/assets/asp-sps/*.webp
#   BUCKET=iparkar-study-guides PREFIX=lms-assets/ scripts/upload-study-assets.sh asp-sps
# Keys carry a content hash, so re-running only adds new files; existing keys are skipped.
set -euo pipefail
COURSE="${1:?usage: $0 <course-slug>}"
BUCKET="${BUCKET:-iparkar-study-guides}"
PREFIX="${PREFIX:-lms-assets/}"
DIR="imports/${COURSE}/assets/${COURSE}"
[ -d "$DIR" ] || { echo "No assets in $DIR"; exit 1; }
n=0
for f in "$DIR"/*.webp "$DIR"/*.png; do
  [ -e "$f" ] || continue
  key="${PREFIX}${COURSE}/$(basename "$f")"
  type="image/webp"; [[ "$f" == *.png ]] && type="image/png"
  npx wrangler r2 object put "${BUCKET}/${key}" --file "$f" --content-type "$type" --remote >/dev/null
  n=$((n+1)); echo "uploaded ${key}"
done
echo "Done: $n file(s) to r2://${BUCKET}/${PREFIX}${COURSE}/"
