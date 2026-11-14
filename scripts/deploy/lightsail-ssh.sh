#!/usr/bin/env bash
# Opens or closes SSH to the Lightsail server for this GitHub runner only.
#
#   lightsail-ssh.sh open    allow port 22 from this runner's address, get a short-lived SSH
#                            certificate from Lightsail, and write an ssh config so that
#                            `ssh lightsail` connects
#   lightsail-ssh.sh close   remove this runner's port 22 rule and the certificate (run it with
#                            `if: always()` so the port never stays open)
#
# Needs AWS credentials for the deploy role, LIGHTSAIL_INSTANCE, and jq. No SSH key is stored
# anywhere: Lightsail issues a new certificate for each run, and the server's host keys come from
# Lightsail too, so the connection is verified rather than trusted on first use.
set -euo pipefail

action="${1:?usage: lightsail-ssh.sh open|close}"
instance="${LIGHTSAIL_INSTANCE:?LIGHTSAIL_INSTANCE is required}"
cidr_file="${RUNNER_TEMP:-/tmp}/lightsail-ssh-cidr"

case "$action" in
  open)
    ip="$(curl -fsS https://checkip.amazonaws.com | tr -d '[:space:]')"
    printf '%s/32' "$ip" > "$cidr_file"
    aws lightsail open-instance-public-ports --instance-name "$instance" \
      --port-info "fromPort=22,toPort=22,protocol=TCP,cidrs=$ip/32" > /dev/null

    install -d -m 700 ~/.ssh
    # The response holds a private key; it goes to files and is never printed.
    access="$(aws lightsail get-instance-access-details --instance-name "$instance" --protocol ssh --output json)"
    jq -r '.accessDetails.privateKey' <<<"$access" > ~/.ssh/lightsail_key
    chmod 600 ~/.ssh/lightsail_key
    jq -r '.accessDetails.certKey' <<<"$access" > ~/.ssh/lightsail_key-cert.pub
    host="$(jq -r '.accessDetails.ipAddress' <<<"$access")"
    user="$(jq -r '.accessDetails.username' <<<"$access")"
    jq -r --arg host "$host" '.accessDetails.hostKeys[] | "\($host) \(.algorithm) \(.publicKey)"' <<<"$access" \
      > ~/.ssh/lightsail_known_hosts
    cat > ~/.ssh/config <<EOF
Host lightsail
  HostName $host
  User $user
  IdentityFile ~/.ssh/lightsail_key
  CertificateFile ~/.ssh/lightsail_key-cert.pub
  UserKnownHostsFile ~/.ssh/lightsail_known_hosts
  StrictHostKeyChecking yes
  BatchMode yes
  ConnectTimeout 15
  ServerAliveInterval 30
EOF
    chmod 600 ~/.ssh/config

    # The firewall change takes a few seconds to apply.
    for _ in $(seq 1 24); do
      if ssh lightsail true 2>/dev/null; then
        echo "SSH is open for this runner."
        exit 0
      fi
      sleep 5
    done
    echo "SSH did not become reachable within two minutes." >&2
    exit 1
    ;;
  close)
    if [ -f "$cidr_file" ]; then
      aws lightsail close-instance-public-ports --instance-name "$instance" \
        --port-info "fromPort=22,toPort=22,protocol=TCP,cidrs=$(cat "$cidr_file")" > /dev/null
      rm -f "$cidr_file"
      echo "SSH is closed again."
    fi
    rm -f ~/.ssh/lightsail_key ~/.ssh/lightsail_key-cert.pub
    ;;
  *)
    echo "usage: lightsail-ssh.sh open|close" >&2
    exit 2
    ;;
esac
