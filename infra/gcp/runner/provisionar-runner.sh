#!/usr/bin/env bash
# Cria (ou confere) a VM do runner próprio do GitHub Actions na GCP (docs/deploy-gcp.md, "Runner do CI").
# Motivo: o repo é privado e os minutos do plano Free acabaram; runner próprio não consome minutos.
# Isolamento: rede própria (nod-ci), sem service account e sem acesso à VPC de produção. Só entra SSH pelo IAP.
# Idempotente. Roda do Mac, com o gcloud logado numa conta dona do projeto e o gh logado com admin no repo.
set -euo pipefail
cd "$(dirname "$0")"
source ../config.env
G="${GCLOUD:-gcloud}"
gc() { "$G" --project="$PROJETO" --quiet "$@"; }
passo() { printf '\n== %s\n' "$*"; }

RUNNER_VM=nod-ci-runner
# definido em 2026-10-06: 4 vCPU / 16 GB para os 3 jobs do ci em paralelo; dá para subir sem recriar.
RUNNER_TIPO="${RUNNER_TIPO:-e2-standard-4}"
RUNNER_REDE=nod-ci
RUNNER_SUBREDE=nod-ci-sa-east1
RUNNER_FAIXA=10.20.0.0/24

passo "Rede isolada"
gc compute networks describe "$RUNNER_REDE" >/dev/null 2>&1 || gc compute networks create "$RUNNER_REDE" --subnet-mode=custom
gc compute networks subnets describe "$RUNNER_SUBREDE" --region="$REGIAO" >/dev/null 2>&1 ||
  gc compute networks subnets create "$RUNNER_SUBREDE" --network="$RUNNER_REDE" --region="$REGIAO" --range="$RUNNER_FAIXA"
gc compute firewall-rules describe nod-ci-ssh-iap >/dev/null 2>&1 ||
  gc compute firewall-rules create nod-ci-ssh-iap --network="$RUNNER_REDE" --direction=INGRESS --allow=tcp:22 \
    --source-ranges=35.235.240.0/20

passo "VM"
if ! gc compute instances describe "$RUNNER_VM" --zone="$ZONA" >/dev/null 2>&1; then
  # Token de registro vale 1 h e só serve para registrar; o startup apaga a metadata depois de usar.
  TOKEN=$(gh api -X POST "repos/$GITHUB_REPO/actions/runners/registration-token" -q .token)
  gc compute instances create "$RUNNER_VM" --zone="$ZONA" --machine-type="$RUNNER_TIPO" \
    --subnet="$RUNNER_SUBREDE" --no-service-account --no-scopes \
    --image-family=ubuntu-2404-lts-amd64 --image-project=ubuntu-os-cloud \
    --boot-disk-size=100GB --boot-disk-type=pd-balanced \
    --shielded-secure-boot --shielded-vtpm --shielded-integrity-monitoring \
    --metadata-from-file=startup-script=./startup.sh \
    --metadata="github-repo=$GITHUB_REPO,runner-token=$TOKEN"
fi

passo "Runners registrados"
for _ in $(seq 1 60); do
  n=$(gh api "repos/$GITHUB_REPO/actions/runners" -q '[.runners[]|select(.name|startswith("nod-ci-"))|select(.status=="online")]|length')
  [ "$n" -ge 3 ] && break
  sleep 10
done
gh api "repos/$GITHUB_REPO/actions/runners" -q '.runners[]|"\(.name) \(.status) \([.labels[].name]|join(","))"'

passo "Token fora da metadata"
gc compute instances remove-metadata "$RUNNER_VM" --zone="$ZONA" --keys=runner-token
