#!/usr/bin/env bash
# Sobe Postgres, migra, semeia e abre API :8888, web :5274 e o site estático :8000.
# Idempotente: pode rodar de novo no mesmo boot. O login stub exige 127.0.0.1.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
unset TMUX

# shellcheck source=docker.sh
source "$(dirname "${BASH_SOURCE[0]}")/docker.sh"

MISE_BIN="/usr/local/bin/mise"

esperar_http() {
  local url="$1" tentativas="$2" i
  for i in $(seq 1 "$tentativas"); do
    if curl -sf "$url" >/dev/null; then
      return 0
    fi
    sleep 1
  done
  echo "sem resposta de ${url}" >&2
  return 1
}

subir_sessao() {
  local nome="$1"
  shift
  if nod_cloud_tmux has-session -t "$nome" 2>/dev/null; then
    echo "sessão ${nome} já existe"
    return 0
  fi
  nod_cloud_tmux new-session -d -s "$nome" -c "$ROOT" -- "$@"
}

garantir_docker
sudo docker compose up -d --wait

if [ ! -f "$ROOT/.env" ]; then
  cp "$ROOT/.env.example" "$ROOT/.env"
fi

"$MISE_BIN" exec -- npm run db:migrate
"$MISE_BIN" exec -- npm run db:migrate:test
"$MISE_BIN" exec -- npm run db:seed

subir_sessao nod-dev bash -lc "exec ${MISE_BIN} exec -- npm run dev >>/tmp/nod-dev.log 2>&1"
subir_sessao static-server bash -lc "exec python3 -m http.server 8000 --bind 0.0.0.0 >>/tmp/nod-static.log 2>&1"

if ! esperar_http "http://127.0.0.1:8888/api/saude" 180; then
  echo "---- /tmp/nod-dev.log ----" >&2
  tail -n 80 /tmp/nod-dev.log >&2 || true
  exit 1
fi
esperar_http "http://127.0.0.1:5274/" 60
esperar_http "http://127.0.0.1:8000/" 30
echo "nod no ar: api 8888, web 5274, estático 8000"
