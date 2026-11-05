#!/usr/bin/env bash
# Keep cookie Secure enabled: local nginx uses a disposable self-signed TLS key.
set -euo pipefail
cd "$(dirname "$0")/../.."
compose=(docker compose --env-file /dev/null -f docker-compose.local.yml)
mkdir -p docs/local/certs
certificate() {
  openssl req -x509 -newkey rsa:2048 -nodes -days 30 \
    -keyout docs/local/certs/key.pem -out docs/local/certs/cert.pem \
    -subj /CN=watchdemo-local \
    -addext "subjectAltName=IP:$1,IP:127.0.0.1,DNS:localhost" 2>/dev/null
}
if [[ ! -f docs/local/certs/cert.pem || ! -f docs/local/certs/key.pem ]]; then
  certificate 127.0.0.1
fi
existing=$("${compose[@]}" ps --all -q frontend)
if [[ -n "$existing" ]]; then
  existing_ip=$(docker inspect "$existing" --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}')
  if [[ "$existing_ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    export LOCAL_PREVIEW_ORIGIN="https://$existing_ip:8443"
  fi
fi
"${compose[@]}" up -d
id=$("${compose[@]}" ps -q frontend)
ip=$(docker inspect "$id" --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}')
if ! openssl x509 -in docs/local/certs/cert.pem -checkip "$ip" -noout >/dev/null 2>&1 \
  || ! openssl x509 -in docs/local/certs/cert.pem -checkend 86400 -noout >/dev/null 2>&1; then
  certificate "$ip"
fi
export LOCAL_PREVIEW_ORIGIN="https://$ip:8443"
"${compose[@]}" up -d
"${compose[@]}" exec -T frontend nginx -s reload
printf '\nReal local application: %s\nLocal message inbox: %s/__local/mail\n' "$LOCAL_PREVIEW_ORIGIN" "$LOCAL_PREVIEW_ORIGIN"
printf 'Self-signed certificate: review the browser warning manually. No global trust is installed.\n'
