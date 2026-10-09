#!/usr/bin/env sh
# A local Overpass server for Austria, for the OSM fetch.
#
# The public servers take minutes on a busy day. This one holds only Austria,
# answers in seconds, and keeps itself current with Geofabrik's diffs. Its
# first start downloads about 800 MB and imports for 30 to 60 minutes. Later
# starts reuse the volume.
#
# It also saves the extract's boundary as public/overpass-local.poly. Then put
# these two lines in .env.development.local and restart the dev server:
#
#   VITE_OVERPASS_LOCAL=http://localhost:12345/api/interpreter
#   VITE_OVERPASS_LOCAL_POLY=overpass-local.poly
#
# The app asks this server only for extents wholly inside that boundary,
# because outside it the server answers with no data and no error. See
# src/utils/overpassLocal.js.
#
#   scripts/overpass-austria.sh          start, or create and import
#   scripts/overpass-austria.sh logs     follow the import
#   scripts/overpass-austria.sh stop

set -eu
NAME=erzberg-overpass-austria
RUN=$(command -v podman || command -v docker)
POLY="$(dirname "$0")/../public/overpass-local.poly"

case "${1:-start}" in
  logs) exec "$RUN" logs -f "$NAME" ;;
  stop) exec "$RUN" stop "$NAME" ;;
esac

[ -s "$POLY" ] || curl -fsSL -o "$POLY" https://download.geofabrik.de/europe/austria.poly

# The volume takes the image's /db, the overpass user's home, at mode 700. The
# web workers run as another user and then cannot reach the database socket:
# every query answers "open64: 13 Permission denied /db/db//osm3s_osm_base".
open_db() { "$RUN" exec -u root "$NAME" chmod 755 /db; }

if "$RUN" container exists "$NAME" 2>/dev/null || "$RUN" inspect "$NAME" >/dev/null 2>&1; then
  "$RUN" start "$NAME"
  open_db
  exit 0
fi

# Geofabrik answers -latest with a redirect to the dated file, and the image's
# download does not follow redirects: it imported the 269-byte redirect page.
PBF=https://download.geofabrik.de/europe/austria-latest.osm.pbf
PBF=$(curl -fsSIL -o /dev/null -w '%{url_effective}' "$PBF")

# Areas are off: the app's queries use a bounding box, never `area`.
# Metadata is off: the app reads tags and geometry only.
"$RUN" run -d --name "$NAME" \
  -e OVERPASS_MODE=init \
  -e OVERPASS_META=no \
  -e OVERPASS_PLANET_URL="$PBF" \
  -e OVERPASS_DIFF_URL=https://download.geofabrik.de/europe/austria-updates/ \
  -e OVERPASS_UPDATE_SLEEP=3600 \
  -e OVERPASS_COMPRESSION=gz \
  -e OVERPASS_USE_AREAS=false \
  -e OVERPASS_STOP_AFTER_INIT=false \
  -e OVERPASS_ALLOW_DUPLICATE_QUERIES=yes \
  -e OVERPASS_SPACE=8589934592 \
  -e OVERPASS_PLANET_PREPROCESS='mv /db/planet.osm.bz2 /db/planet.osm.pbf && osmium cat -o /db/planet.osm.bz2 /db/planet.osm.pbf && rm /db/planet.osm.pbf' \
  -v "$NAME":/db \
  -p 12345:80 \
  --restart unless-stopped \
  docker.io/wiktorn/overpass-api
open_db
echo "Importing. Follow it with: $0 logs"
