#!/usr/bin/env bash
# NOD-132 (ADR-149): leva os ZIPs de uma release do app do Mac (desktop-release.yml) para o bucket privado da
# atualização automática e mostra a linha do infra/gcp/config.env que liga o anúncio. Não liga nada sozinho: o
# anúncio só sai quando NOD_APP_VERSAO_PUBLICADA (com o NOD_APP_ATUALIZACAO_SHA256 que ele imprime) entra no config.env e o deploy roda (docs/release-desktop.md).
#
#   scripts/desktop/publicar-atualizacao.sh v0.9.0
#
# Confere o SHA-256 de cada ZIP contra o SHA256-<arch>.txt da própria release antes de copiar. Nunca apaga nem
# sobrescreve: um objeto que já existe no bucket com outro conteúdo faz o script parar.
# Precisa de: `gh` logado com leitura no repositório e `gcloud` logado com escrita no bucket.
set -euo pipefail

REPO_GH=gamefik/nod
BUCKET=${NOD_APP_ATUALIZACAO_BUCKET:-nod-producao-atualizacoes}
TAG=${1:-}

falha() { echo "ERRO: $*" >&2; exit 1; }
[[ "$BUCKET" =~ ^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$ ]] || falha "bucket inválido: $BUCKET"
[ -n "$TAG" ] || falha "uso: $0 v<versão> (a tag da release do app)"
VERSAO=${TAG#v}
VERSAO=${VERSAO#desktop-v}
[[ "$VERSAO" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-rc\.(0|[1-9][0-9]*))?$ ]] || falha "versão fora de x.y.z ou x.y.z-rc.N: $VERSAO"
command -v gh >/dev/null || falha "falta o gh"
command -v gcloud >/dev/null || falha "falta o gcloud"

DIR=$(mktemp -d)
trap 'rm -rf "$DIR"' EXIT
gh release download "$TAG" -R "$REPO_GH" -D "$DIR" -p "nod-$VERSAO-mac-*.zip" -p "SHA256-*.txt"

if command -v sha256sum >/dev/null; then SHA=(sha256sum); else SHA=(shasum -a 256); fi
HASH_arm64=""; HASH_x64=""
# Primeiro confere as duas arquiteturas; só depois sobe alguma (nada de objeto órfão de uma só no bucket).
for ARCH in arm64 x64; do
  ZIP="nod-$VERSAO-mac-$ARCH.zip"
  [ -f "$DIR/$ZIP" ] || falha "a release $TAG não tem $ZIP"
  ESPERADO=$(cat "$DIR"/SHA256-*.txt | awk -v f="$ZIP" '{ n=$2; sub(/^.*\//, "", n); if (n == f) print $1 }' | head -n1)
  [ -n "$ESPERADO" ] || falha "nenhum SHA256-*.txt da release lista $ZIP"
  VEIO=$("${SHA[@]}" "$DIR/$ZIP" | awk '{print $1}')
  [ "$VEIO" = "$ESPERADO" ] || falha "SHA-256 de $ZIP não confere ($VEIO ≠ $ESPERADO)"
  if [ "$ARCH" = arm64 ]; then HASH_arm64=$VEIO; else HASH_x64=$VEIO; fi
done

# crc32c: objeto composto (upload paralelo) não tem MD5.
crc() { gcloud storage hash "$1" --hex --skip-md5 --format='value(crc32c_hash)'; }
for ARCH in arm64 x64; do
  ZIP="nod-$VERSAO-mac-$ARCH.zip"
  DESTINO="gs://$BUCKET/$VERSAO/$ZIP"
  LOCAL=$(crc "$DIR/$ZIP")
  if gcloud storage objects describe "$DESTINO" >/dev/null 2>&1; then
    [ "$(crc "$DESTINO" 2>/dev/null || true)" = "$LOCAL" ] || falha "$DESTINO já existe com outro conteúdo; publique uma versão nova"
    echo "== $DESTINO já está no bucket"
  else
    gcloud storage cp --no-clobber "$DIR/$ZIP" "$DESTINO"
    # O --no-clobber pula sem erro se outro upload chegou antes; o hash só sai se o bucket tem este ZIP.
    [ "$(crc "$DESTINO" 2>/dev/null || true)" = "$LOCAL" ] || falha "$DESTINO ficou diferente no bucket; confira antes de anunciar"
  fi
done

cat <<EOF

ZIPs de $VERSAO no bucket. Para anunciar a versão aos apps, ponha em infra/gcp/config.env:

  NOD_APP_VERSAO_PUBLICADA=$VERSAO
  NOD_APP_ATUALIZACAO_SHA256=arm64=$HASH_arm64,x64=$HASH_x64

e rode o deploy. Para parar o anúncio, deixe a linha vazia e rode o deploy de novo.
EOF
