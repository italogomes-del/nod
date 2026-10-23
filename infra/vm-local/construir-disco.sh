#!/usr/bin/env bash
# NOD-93 (PR 1): o disco base da VM local do Mac, um por arquitetura: Debian 12 genericcloud + dockerd + chrony + a
# imagem do computador dentro (carregada sem rede no 1º boot, nod-imagem.service). Sai
#   <saida>/nod-vm-<versao>-<arch>.img.zst  (raw comprimido)  e  <saida>/nod-vm-<versao>-<arch>.img.zst.sha256
# O app baixa esse arquivo (Range + sha256, desktop/vm-local/download.ts) e o Lima (vmType vz) liga a VM com ele.
# Containers, volumes e logins moram no disco de dados `nod-dados` (daemon.json), não neste: trocar o disco base a
# cada versão do app não apaga nada da pessoa.
#
# Roda no workflow desktop-release (job vm-local) num runner Linux da MESMA arquitetura do disco: o virt-customize
# executa o apt do convidado, e convidado de outra arquitetura exigiria emulação. Precisa de root (libguestfs),
# libguestfs-tools, qemu-utils, zstd, curl e sha512sum.
#
# Uso:
#   construir-disco.sh [--simular] <arm64|amd64> <versao> <imagem-docker.tar> <saida>
# A imagem é o `docker save` de `npm run computador:build -- --saida <dir>` (nod-computador-<arch>.tar), com o rótulo
# app.nod.computador.versao=<versao>.
# --simular: imprime os comandos externos em vez de executá-los (sem download, sem root).
set -euo pipefail
DIR_VM="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=base.env
source "$DIR_VM/base.env"

SIMULAR="${SIMULAR:-0}"
TAG_IMAGEM="${TAG_IMAGEM:-nod-computador:1}"
exec 3>&1

ext() { # comando externo; na simulação só imprime (no fd 3, para aparecer mesmo dentro de $(...))
  if [ "$SIMULAR" = 1 ]; then echo "[simular] $*" >&3; return 0; fi
  "$@"
}
passo() { printf '\n== %s\n' "$*"; }

arch_valida() { [ "${1:-}" = arm64 ] || [ "${1:-}" = amd64 ]; }
# A versão vira nome de arquivo e rótulo: só o que um semver/tag usa.
versao_valida() { [[ "${1:-}" =~ ^[0-9A-Za-z][0-9A-Za-z.+-]*$ ]]; }

sha512_da_base() { # arch
  case "$1" in
    arm64) echo "$DEBIAN_SHA512_ARM64" ;;
    amd64) echo "$DEBIAN_SHA512_AMD64" ;;
  esac
}
nome_da_base() { echo "debian-12-genericcloud-$1-$DEBIAN_DATA.qcow2"; }
nome_do_disco() { echo "nod-vm-$2-$1.img.zst"; } # arch versao

baixar_base() { # arch destino
  local arch="$1" destino="$2" esperado
  esperado="$(sha512_da_base "$arch")"
  ext curl -fsSL --retry 3 -o "$destino" "$DEBIAN_URL_BASE/$(nome_da_base "$arch")"
  if [ "$SIMULAR" = 1 ]; then echo "[simular] conferir sha512 $esperado" >&3; return 0; fi
  echo "$esperado  $destino" | sha512sum -c --status || { echo "sha512 da base Debian não confere ($destino)" >&2; return 1; }
}

construir() { # arch versao imagem saida
  local arch="$1" versao="$2" imagem="$3" saida="$4" trab raw disco
  arch_valida "$arch" || { echo "arquitetura inválida: '$arch' (arm64 ou amd64)" >&2; return 2; }
  versao_valida "$versao" || { echo "versão inválida: '$versao'" >&2; return 2; }
  if [ "$SIMULAR" != 1 ]; then
    [ -f "$imagem" ] || { echo "imagem do computador não existe: $imagem" >&2; return 2; }
    [ "$(uname -m)" = "$([ "$arch" = arm64 ] && echo aarch64 || echo x86_64)" ] || { echo "o disco $arch precisa de um host $arch (este é $(uname -m))" >&2; return 2; }
  fi
  trab="$(mktemp -d)"
  # shellcheck disable=SC2064
  trap "rm -rf '$trab'" RETURN
  raw="$trab/disco.raw"
  disco="$saida/$(nome_do_disco "$arch" "$versao")"
  mkdir -p "$saida"

  passo "base Debian $DEBIAN_SERIE $DEBIAN_DATA ($arch)"
  baixar_base "$arch" "$trab/base.qcow2"
  # O qcow2 vem com a raiz de ~2 GB: o virt-resize copia para um raw de DISCO_TAMANHO e estica a raiz (sda1 no
  # genericcloud; 14 e 15 são BIOS e EFI) antes do apt e da imagem.
  ext qemu-img create -f raw "$raw" "$DISCO_TAMANHO"
  ext virt-resize --expand /dev/sda1 "$trab/base.qcow2" "$raw"

  passo "imagem do computador (comprimida no disco)"
  ext zstd -q -T0 -10 -o "$trab/imagem.tar.zst" "$imagem"
  printf '%s\n' "$versao" > "$trab/imagem.versao"
  printf '%s\n' "$TAG_IMAGEM" > "$trab/imagem.tag"

  passo "docker, chrony e os arquivos do nod no convidado"
  ext virt-customize -a "$raw" --network \
    --install docker.io,chrony,zstd \
    --mkdir /var/lib/nod \
    --copy-in "$trab/imagem.tar.zst:/var/lib/nod" \
    --copy-in "$trab/imagem.versao:/var/lib/nod" \
    --copy-in "$trab/imagem.tag:/var/lib/nod" \
    --copy-in "$DIR_VM/arquivos/etc/docker/daemon.json:/etc/docker" \
    --mkdir /etc/systemd/system/docker.service.d \
    --copy-in "$DIR_VM/arquivos/etc/systemd/system/docker.service.d/nod-dados.conf:/etc/systemd/system/docker.service.d" \
    --copy-in "$DIR_VM/arquivos/etc/systemd/system/nod-imagem.service:/etc/systemd/system" \
    --mkdir /etc/chrony/conf.d \
    --copy-in "$DIR_VM/arquivos/etc/chrony/conf.d/nod.conf:/etc/chrony/conf.d" \
    --mkdir /usr/local/lib/nod \
    --copy-in "$DIR_VM/arquivos/usr/local/lib/nod/esperar-dados.sh:/usr/local/lib/nod" \
    --copy-in "$DIR_VM/arquivos/usr/local/lib/nod/carregar-imagem.sh:/usr/local/lib/nod" \
    --run-command 'chmod 0755 /usr/local/lib/nod/*.sh && systemctl enable docker.service nod-imagem.service chrony.service' \
    --run-command 'apt-get clean && rm -rf /var/lib/apt/lists/*' \
    --truncate /etc/machine-id

  passo "compactar e publicar"
  ext virt-sparsify --in-place "$raw"
  ext zstd -q -T0 -19 --long=27 -o "$disco" "$raw"
  if [ "$SIMULAR" = 1 ]; then echo "[simular] sha256 $disco" >&3; else (cd "$saida" && sha256sum "$(basename "$disco")" > "$(basename "$disco").sha256"); fi
  echo "$disco"
}

main() {
  if [ "${1:-}" = --simular ]; then SIMULAR=1; shift; fi
  [ "$#" -eq 4 ] || { echo "uso: construir-disco.sh [--simular] <arm64|amd64> <versao> <imagem-docker.tar> <saida>" >&2; return 2; }
  construir "$@"
}

# Carregado com `source`, só define as funções (os testes usam assim).
if [ "${BASH_SOURCE[0]}" = "$0" ]; then main "$@"; fi
