#!/usr/bin/env bash
# Sobe o ambiente de dev acessível pela tailnet:
#   https://<WEB_ALLOWED_HOSTS[0]>:<TAILNET_HTTPS_PORT>  →  Vite em localhost:<WEB_PORT>
# Usa `sudo tailscale serve` (só a sua tailnet enxerga, nunca funnel) e desfaz o serve ao sair.
# Falha fechado: se não der para ler o status do tailscale, ou se a porta já tiver qualquer serve
# (inclusive uma sobra de execução anterior), aborta sem alterar nada.
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
# Só dígitos, normalizada (08443 → 8443, para comparar com o status) e no intervalo 1–65535.
normalizar_porta() {
  if ! [[ $1 =~ ^[0-9]{1,5}$ ]] || (( 10#$1 < 1 || 10#$1 > 65535 )); then
    echo "Porta inválida: '$1'" >&2
    exit 1
  fi
  echo $(( 10#$1 ))
}
PORTA_HTTPS=$(normalizar_porta "$PORTA_HTTPS")
PORTA_WEB=$(normalizar_porta "$PORTA_WEB")
command -v tailscale >/dev/null || { echo "tailscale não encontrado no PATH" >&2; exit 1; }

STATUS=$(tailscale serve status --json 2>/dev/null) && [ -n "$STATUS" ] || {
  echo "Não consegui ler o status do tailscale serve (tailscaled no ar? logado?). Nada foi alterado." >&2
  exit 1
}
# A porta está em uso se aparecer em qualquer parte da configuração (TCP, Web ou funnel),
# inclusive nos serves em primeiro plano (Foreground, um por sessão) e nos de serviço (Services),
# que repetem a mesma forma.
EM_USO=$(printf '%s' "$STATUS" | node -e '
  const porta = process.argv[1];
  const chaves = (cfg) => [
    ...Object.keys(cfg.TCP || {}),
    ...Object.keys(cfg.Web || {}),
    ...Object.keys(cfg.AllowFunnel || {}),
    ...Object.values(cfg.Foreground || {}).flatMap(chaves),
    ...Object.values(cfg.Services || {}).flatMap(chaves),
  ];
  let s = "";
  process.stdin.on("data", (d) => (s += d)).on("end", () => {
    const st = JSON.parse(s);
    console.log(chaves(st).some((k) => k === porta || k.endsWith(":" + porta)) ? "sim" : "nao");
  });' "$PORTA_HTTPS") || { echo "Status do tailscale serve ilegível. Nada foi alterado." >&2; exit 1; }
if [ "$EM_USO" != nao ]; then
  echo "A porta $PORTA_HTTPS do tailscale serve já está em uso:" >&2
  tailscale serve status >&2 || true
  echo "Escolha outra em TAILNET_HTTPS_PORT. Se for uma sobra deste script, libere com:" >&2
  echo "  sudo tailscale serve --https=$PORTA_HTTPS off" >&2
  exit 1
fi

desfazer() {
  echo
  echo "== Desfazendo o tailscale serve na porta $PORTA_HTTPS"
  sudo tailscale serve --https="$PORTA_HTTPS" off || true
}

echo "== Expondo o web na tailnet: https://$HOST:$PORTA_HTTPS → localhost:$PORTA_WEB"
sudo tailscale serve --bg --https="$PORTA_HTTPS" "$PORTA_WEB"
# Só depois do serve dar certo: se ele falhar, não há nada a desfazer.
trap desfazer EXIT

echo "== Subindo o ambiente (api, worker e web). Ctrl+C encerra e desfaz o serve."
cd "$RAIZ"
# O pnpm roda como filho e o script espera com `wait`: assim INT/TERM/HUP (Ctrl+C, kill,
# terminal fechado) interrompem a espera na hora, encerram o filho e o trap EXIT desfaz o serve.
# Só SIGKILL escapa: nesse caso, `sudo tailscale serve --https=<porta> off` à mão.
# Em grupo de processos próprio (setsid): o encerramento derruba o turbo e os filhos dele
# (vite, api, worker) de uma vez, sem deixar órfãos segurando as portas.
if command -v setsid >/dev/null; then
  WEB_HMR_CLIENT_PORT="$PORTA_HTTPS" setsid pnpm dev &
  FILHO=$!
  ALVO="-$FILHO"
else
  # Sem setsid (ex.: macOS): o sinal chega só ao pnpm, e vite/api/worker podem ficar órfãos.
  echo "Aviso: sem setsid, ao sair confira se sobrou processo nas portas (lsof -i :$PORTA_WEB)." >&2
  WEB_HMR_CLIENT_PORT="$PORTA_HTTPS" pnpm dev &
  FILHO=$!
  ALVO="$FILHO"
fi
encerrar() {
  kill -TERM -- "$ALVO" 2>/dev/null || true
  wait "$FILHO" 2>/dev/null || true
}
trap 'encerrar; exit 130' INT
trap 'encerrar; exit 143' TERM
trap 'encerrar; exit 129' HUP
wait "$FILHO"
