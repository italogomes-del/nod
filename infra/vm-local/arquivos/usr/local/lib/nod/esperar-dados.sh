#!/bin/sh
# NOD-93: espera o Lima montar o disco de dados. Sai com 1 depois do prazo: o docker não sobe no disco base.
set -eu
MONTAGEM="${NOD_DADOS_MONTAGEM:-/mnt/lima-nod-dados}"
PRAZO_S="${NOD_DADOS_PRAZO_S:-120}"
i=0
while ! mountpoint -q "$MONTAGEM"; do
  i=$((i + 1))
  if [ "$i" -gt "$PRAZO_S" ]; then echo "nod: $MONTAGEM não montou em ${PRAZO_S}s" >&2; exit 1; fi
  sleep 1
done
mkdir -p "$MONTAGEM/docker"
