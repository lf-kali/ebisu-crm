#!/usr/bin/env bash
# Sobe o ambiente de dev acessível pela tailnet:
#   https://<WEB_ALLOWED_HOSTS[0]>:<TAILNET_HTTPS_PORT>  →  Vite em localhost:<WEB_PORT>
# Usa `sudo tailscale serve` (só a sua tailnet enxerga, nunca funnel) e desfaz o serve ao sair.
# Não mexe em serves de outras portas e aborta se a porta pedida já for de outro serviço.
set -euo pipefail

RAIZ=$(cd "$(dirname "$0")/.." && pwd)

# Lê uma chave do .env sem executá-lo como shell (tolera CRLF e aspas); o ambiente tem precedência.
ler_env() {
  local chave=$1 valor=${!1:-}
  if [ -z "$valor" ] && [ -f "$RAIZ/.env" ]; then
    valor=$(grep -E "^[[:space:]]*${chave}=" "$RAIZ/.env" | tail -n 1 | cut -d= -f2- || true)
  fi
  valor=${valor//$'\r'/}
  valor=${valor#\"}; valor=${valor%\"}; valor=${valor#\'}; valor=${valor%\'}
  printf '%s' "$valor"
}

HOSTS=$(ler_env WEB_ALLOWED_HOSTS)
HOST=${HOSTS%%,*}
HOST=${HOST//[[:space:]]/}
PORTA_HTTPS=$(ler_env TAILNET_HTTPS_PORT); PORTA_HTTPS=${PORTA_HTTPS:-8447}
PORTA_WEB=$(ler_env WEB_PORT); PORTA_WEB=${PORTA_WEB:-5173}

[ -n "$HOST" ] || { echo "Defina WEB_ALLOWED_HOSTS no .env com o nome da máquina na tailnet (ex.: maquina.tailXXXX.ts.net)" >&2; exit 1; }
for porta in "$PORTA_HTTPS" "$PORTA_WEB"; do
  [[ $porta =~ ^[0-9]{1,5}$ ]] || { echo "Porta inválida: '$porta'" >&2; exit 1; }
done
command -v tailscale >/dev/null || { echo "tailscale não encontrado no PATH" >&2; exit 1; }

# Quem está na porta pedida? "livre", "nosso" (sobra de uma execução anterior) ou "outro".
situacao_da_porta() {
  tailscale serve status --json 2>/dev/null | node -e '
    const [porta, alvo] = process.argv.slice(1);
    let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      const st = s.trim() ? JSON.parse(s) : {};
      if (!st.TCP || !st.TCP[porta]) return console.log("livre");
      const web = Object.entries(st.Web || {}).find(([k]) => k.endsWith(":" + porta));
      const handlers = web ? Object.values(web[1].Handlers || {}) : [];
      const nosso = handlers.length === 1 && handlers[0].Proxy === alvo;
      console.log(nosso ? "nosso" : "outro");
    });' "$PORTA_HTTPS" "http://127.0.0.1:$PORTA_WEB"
}

case "$(situacao_da_porta)" in
  livre) ;;
  nosso) echo "== Reaproveitando o serve da porta $PORTA_HTTPS deixado por uma execução anterior" ;;
  *)
    echo "A porta $PORTA_HTTPS do tailscale serve já é usada por outro serviço:" >&2
    tailscale serve status >&2 || true
    echo "Escolha outra em TAILNET_HTTPS_PORT no .env. Nada foi alterado." >&2
    exit 1
    ;;
esac

desfazer() {
  echo
  echo "== Desfazendo o tailscale serve na porta $PORTA_HTTPS"
  sudo tailscale serve --https="$PORTA_HTTPS" off || true
}

echo "== Expondo o web na tailnet: https://$HOST:$PORTA_HTTPS → localhost:$PORTA_WEB"
trap desfazer EXIT
sudo tailscale serve --bg --https="$PORTA_HTTPS" "$PORTA_WEB"

echo "== Subindo o ambiente (api, worker e web). Ctrl+C encerra e desfaz o serve."
cd "$RAIZ"
# O pnpm roda como filho e o script espera com `wait`: assim INT/TERM/HUP (Ctrl+C, kill,
# terminal fechado) interrompem a espera na hora, encerram o filho e o trap EXIT desfaz o serve.
# Só SIGKILL escapa: nesse caso, `sudo tailscale serve --https=<porta> off` à mão.
WEB_HMR_CLIENT_PORT="$PORTA_HTTPS" pnpm dev &
FILHO=$!
encerrar() {
  kill -TERM "$FILHO" 2>/dev/null || true
  wait "$FILHO" 2>/dev/null || true
}
trap 'encerrar; exit 130' INT
trap 'encerrar; exit 143' TERM
trap 'encerrar; exit 129' HUP
wait "$FILHO"
