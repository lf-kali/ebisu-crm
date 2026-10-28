#!/usr/bin/env bash
# Sobe o ambiente de dev acessível pela tailnet:
#   https://<WEB_ALLOWED_HOSTS[0]>:<TAILNET_HTTPS_PORT>  →  Vite em localhost:<WEB_PORT>
# Usa `sudo tailscale serve` (só a sua tailnet enxerga) e desfaz o serve ao sair.
set -euo pipefail

RAIZ=$(cd "$(dirname "$0")/.." && pwd)
if [ -f "$RAIZ/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$RAIZ/.env"
  set +a
fi

HOST=${WEB_ALLOWED_HOSTS%%,*}
PORTA_HTTPS=${TAILNET_HTTPS_PORT:-8447}
PORTA_WEB=${WEB_PORT:-5173}
: "${HOST:?Defina WEB_ALLOWED_HOSTS no .env com o nome da máquina na tailnet (ex.: maquina.tailXXXX.ts.net)}"

command -v tailscale >/dev/null || { echo "tailscale não encontrado no PATH" >&2; exit 1; }

desfazer() {
  echo
  echo "== Desfazendo o tailscale serve na porta $PORTA_HTTPS"
  sudo tailscale serve --https="$PORTA_HTTPS" off || true
}

echo "== Expondo o web na tailnet: https://$HOST:$PORTA_HTTPS → localhost:$PORTA_WEB"
sudo tailscale serve --bg --https="$PORTA_HTTPS" "$PORTA_WEB"
trap desfazer EXIT

echo "== Subindo o ambiente (api, worker e web). Ctrl+C encerra e desfaz o serve."
cd "$RAIZ"
WEB_HMR_CLIENT_PORT="$PORTA_HTTPS" pnpm dev
