#!/bin/sh
# NOD-93: `docker load` da imagem do disco base quando o rótulo de versão do docker difere do gravado no build.
set -eu
DIR="${NOD_IMAGEM_DIR:-/var/lib/nod}"
TAG="$(cat "$DIR/imagem.tag")"
QUER="$(cat "$DIR/imagem.versao")"
TEM="$(docker image inspect "$TAG" --format '{{index .Config.Labels "app.nod.computador.versao"}}' 2>/dev/null || true)"
if [ "$TEM" = "$QUER" ]; then echo "nod: $TAG já é a $QUER"; exit 0; fi
echo "nod: carregando $TAG $QUER (tinha '${TEM:-nada}')"
zstd -dc "$DIR/imagem.tar.zst" | docker load
TEM="$(docker image inspect "$TAG" --format '{{index .Config.Labels "app.nod.computador.versao"}}')"
[ "$TEM" = "$QUER" ] || { echo "nod: depois do load $TAG é '$TEM', esperava $QUER" >&2; exit 1; }
# A imagem da versão anterior perdeu a tag no load e ficaria no disco de dados (~3 GB) a cada atualização do app.
# Só as sem tag e com o rótulo do nod; a que um container ainda usa o docker não apaga. Falhar aqui não segura o boot.
docker image prune -f --filter "label=app.nod.computador.versao" >/dev/null || echo "nod: não consegui apagar a imagem antiga" >&2
