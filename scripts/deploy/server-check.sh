#!/usr/bin/env bash
# Read-only checks of the production server, run over SSH by the "Check server" workflow:
#   ssh lightsail 'bash -s' < scripts/deploy/server-check.sh
# The repository is public, so its Actions logs are too. This prints no secret values: container
# settings are listed by name, with values only for a few settings that are not secret.
set -uo pipefail

echo "== Containers"
sudo docker ps --format '{{.Names}}  {{.Image}}  {{.Status}}'

echo
echo "== Published ports (0.0.0.0 means reachable whenever the Lightsail firewall allows it)"
sudo docker ps --format '{{.Names}}: {{.Ports}}'

echo
echo "== /opt/common-ground"
ls -l /opt/common-ground 2>&1 | sed 's/^/  /'

for container in $(sudo docker ps --format '{{.Names}}'); do
  echo
  echo "== $container settings"
  sudo docker inspect "$container" --format '{{range .Config.Env}}{{println .}}{{end}}' | while IFS= read -r line; do
    name="${line%%=*}"
    case "$name" in
      "") ;;
      API_PROCESS_ROLE|NODE_ENV|TRUST_PROXY_HOPS|OPENROUTER_COST_TIER|OPENROUTER_MODEL|PORT|HOSTNAME|ENABLE_*|NEXT_PUBLIC_*|CORS_ORIGIN|NEXTAUTH_URL|API_BASE_URL)
        echo "  $line" ;;
      *)
        echo "  $name (set)" ;;
    esac
  done
done

echo
echo "== Host firewall"
sudo ufw status 2>/dev/null | head -1 || echo "  ufw not installed"

echo
echo "== Disk"
df -h / | tail -1
