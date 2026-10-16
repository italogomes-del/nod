#!/usr/bin/env bash
# Startup da VM do runner (provisionar-runner.sh). Roda como root a cada boot; só instala e registra uma vez.
# Três runners na mesma VM para os 3 jobs do ci rodarem em paralelo:
#   nod-ci-1 e nod-ci-2 (label nod-ci): lint, unit e deploy;
#   nod-ci-integracao (label nod-integracao): o único que sobe o Postgres na porta 5434 do host, então dois
#   jobs de integração nunca disputam a porta.
set -euo pipefail
MARCA=/var/lib/nod-runner-pronto
[ -f "$MARCA" ] && exit 0

meta() { curl -fsS -H 'Metadata-Flavor: Google' "http://metadata.google.internal/computeMetadata/v1/instance/attributes/$1"; }
REPO=$(meta github-repo)
TOKEN=$(meta runner-token)
VERSAO=2.338.0

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
# O que o ci usa do ubuntu-latest: git, psql (init dos roles), build-essential (deps nativas do npm), jq, docker.
apt-get install -yq ca-certificates curl git jq unzip zip build-essential python3 postgresql-client docker.io
systemctl enable --now docker

id runner >/dev/null 2>&1 || useradd -m -s /bin/bash -G docker runner
echo 'runner ALL=(ALL) NOPASSWD:ALL' >/etc/sudoers.d/runner

curl -fsSL -o /tmp/runner.tgz \
  "https://github.com/actions/runner/releases/download/v${VERSAO}/actions-runner-linux-x64-${VERSAO}.tar.gz"

registrar() { # nome label
  local dir="/home/runner/$1"
  mkdir -p "$dir" && tar -xzf /tmp/runner.tgz -C "$dir" && chown -R runner:runner "$dir"
  if [ ! -f "$dir/.runner" ]; then
    sudo -u runner "$dir/config.sh" --unattended --replace --url "https://github.com/$REPO" --token "$TOKEN" \
      --name "$1" --labels "$2" --work _work
  fi
  (cd "$dir" && ./svc.sh install runner && ./svc.sh start)
}
registrar nod-ci-1 nod-ci
registrar nod-ci-2 nod-ci
registrar nod-ci-integracao nod-integracao

# Limpeza semanal de imagens e volumes que os jobs deixam para trás.
echo '0 4 * * 0 root docker system prune -af --volumes >/dev/null 2>&1' >/etc/cron.d/nod-docker-prune
touch "$MARCA"
