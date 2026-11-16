#!/usr/bin/env bash
# Upload SCORM 1.2 packages to the private R2 bucket (never public), one module per zip.
#   scripts/upload-scorm.sh sat overview=path/to/iParkar-SAT-00-Overview-SCORM12.zip analysis=path/to/…01-Analysis….zip …
# Each zip is unpacked and every file goes to r2://iparkar-study-guides/lms-assets/scorm/<course>/<module>/<path>,
# where /api/scorm/content/<course>/<module>/<path> serves it to signed-in learners.
# The module codes must match scorm_modules.code for that course. Re-running overwrites the files.
set -euo pipefail
COURSE="${1:?usage: $0 <course> <module>=<zip> [<module>=<zip> ...]}"; shift
BUCKET="${BUCKET:-iparkar-study-guides}"
PREFIX="${PREFIX:-lms-assets/scorm/}"
[[ "$COURSE" =~ ^[a-z0-9-]{2,40}$ ]] || { echo "bad course code: $COURSE"; exit 1; }
[ $# -gt 0 ] || { echo "give at least one <module>=<zip>"; exit 1; }

type_of() {
  case "${1##*.}" in
    html|htm) echo "text/html; charset=utf-8";; js) echo "text/javascript; charset=utf-8";; css) echo "text/css; charset=utf-8";;
    json) echo "application/json";; xml) echo "application/xml";; svg) echo "image/svg+xml";; png) echo "image/png";;
    jpg|jpeg) echo "image/jpeg";; gif) echo "image/gif";; webp) echo "image/webp";; woff) echo "font/woff";; woff2) echo "font/woff2";;
    mp3) echo "audio/mpeg";; mp4) echo "video/mp4";; vtt) echo "text/vtt";; *) echo "application/octet-stream";;
  esac
}

total=0
for pair in "$@"; do
  MODULE="${pair%%=*}"; ZIP="${pair#*=}"
  [[ "$MODULE" =~ ^[a-z0-9-]{2,40}$ ]] || { echo "bad module code: $MODULE"; exit 1; }
  [ -f "$ZIP" ] || { echo "missing zip: $ZIP"; exit 1; }
  TMP="$(mktemp -d)"; unzip -q "$ZIP" -d "$TMP"
  [ -f "$TMP/imsmanifest.xml" ] || { echo "$ZIP has no imsmanifest.xml — not a SCORM package"; exit 1; }
  while IFS= read -r -d '' f; do
    rel="${f#"$TMP"/}"
    [ "$rel" = "imsmanifest.xml" ] && continue
    key="${PREFIX}${COURSE}/${MODULE}/${rel}"
    npx wrangler r2 object put "${BUCKET}/${key}" --file "$f" --content-type "$(type_of "$f")" --remote >/dev/null
    echo "uploaded ${key}"; total=$((total+1))
  done < <(find "$TMP" -type f -print0)
  rm -rf "$TMP"
done
echo "Done: ${total} file(s) to r2://${BUCKET}/${PREFIX}${COURSE}/"
