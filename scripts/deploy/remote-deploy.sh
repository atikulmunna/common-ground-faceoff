#!/usr/bin/env bash
# Runs on the Lightsail server; .github/workflows/deploy.yml pipes it over SSH.
# Usage: remote-deploy.sh <image tag> <ECR registry> <public API URL> <public web URL>
#
# Backs up the database, points docker-compose.yml at the new images, applies migrations,
# restarts the API and web containers and checks they are healthy. If any step fails, the
# previous docker-compose.yml is restored and the old containers restarted. Migrations that
# already ran are not undone; restore the backup (scripts/restore-db.sh) if one must be.
set -Eeuo pipefail

tag="$1"
registry="$2"
api_url="${3%/}"
web_url="${4%/}"

runtime="/opt/common-ground"
snapshot="$runtime/releases/$tag"
api_image="$registry/common-ground-api:$tag"
web_image="$registry/common-ground-web:$tag"
compose=(sudo docker compose -f "$runtime/docker-compose.yml")

sudo systemctl start common-ground-backup.service
if sudo systemctl is-failed --quiet common-ground-backup.service; then
  echo "Database backup failed; nothing was deployed." >&2
  exit 1
fi

sudo mkdir -p "$snapshot"
sudo cp "$runtime/docker-compose.yml" "$snapshot/docker-compose.yml"

rollback() {
  echo "Deploy of $tag failed; restoring the previous images." >&2
  sudo cp "$snapshot/docker-compose.yml" "$runtime/docker-compose.yml"
  "${compose[@]}" up -d api web
}
trap rollback ERR

# Point the api and web services at the new images; expect exactly one image line for each.
sudo python3 - "$runtime/docker-compose.yml" "$api_image" "$web_image" <<'PY'
import pathlib
import re
import sys

path = pathlib.Path(sys.argv[1])
text = path.read_text()
for service, image in (("api", sys.argv[2]), ("web", sys.argv[3])):
    text, count = re.subn(
        rf'^\s*image:\s*["\']?.*/common-ground-{service}:[^"\'\s]+["\']?\s*$',
        f"    image: {image}",
        text,
        flags=re.MULTILINE,
    )
    if count != 1:
        raise SystemExit(f"expected one {service} image line in {path}, found {count}")
path.write_text(text)
PY

"${compose[@]}" config --quiet
"${compose[@]}" pull api web
"${compose[@]}" run -T --rm api ./node_modules/.bin/prisma migrate deploy --schema apps/api/prisma/schema.prisma </dev/null
"${compose[@]}" up -d --force-recreate api web

curl --fail --silent --show-error --retry 12 --retry-delay 5 --retry-all-errors "$api_url/ready" >/dev/null
test "$(curl --silent --output /dev/null --write-out '%{http_code}' "$web_url/")" = "200"

trap - ERR
"${compose[@]}" ps
echo "Deployed $tag."
