#!/usr/bin/env bash
# Bootstrap do Cloud Agent: Node pinado, dependências, imagem do Postgres e gstack.
# Idempotente. Não sobe a API — isso é o start.sh. Roda de /workspace via bash -l.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

# shellcheck source=docker.sh
source "$(dirname "${BASH_SOURCE[0]}")/docker.sh"

MISE_PIN="v2026.10.11"
MISE_BIN="/usr/local/bin/mise"

instalar_pacotes() {
  sudo DEBIAN_FRONTEND=noninteractive apt-get update -y
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
    -o Dpkg::Options::="--force-confdef" \
    -o Dpkg::Options::="--force-confold" \
    docker.io docker-compose-v2 iptables ca-certificates curl
}

instalar_mise() {
  local atual=""
  if [ -x "$MISE_BIN" ]; then
    atual="$("$MISE_BIN" --version 2>/dev/null | awk '{print $1}')"
  fi
  if [ "$atual" = "${MISE_PIN#v}" ]; then
    return 0
  fi
  curl -fsSL https://mise.run | MISE_VERSION="$MISE_PIN" sh
  sudo ln -sfn "${HOME}/.local/bin/mise" "$MISE_BIN"
}

instalar_pacotes
instalar_mise

"$MISE_BIN" install
versao="$("$MISE_BIN" exec -- node --version)"
if [ "$versao" != "v24.19.0" ]; then
  echo "node esperado v24.19.0, veio ${versao}" >&2
  exit 1
fi

"$MISE_BIN" exec -- npm ci

garantir_docker
sudo docker compose pull

bash scripts/cloud/install-gstack.sh
echo "install do nod pronto (node ${versao})"
