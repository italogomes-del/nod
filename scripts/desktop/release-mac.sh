#!/usr/bin/env bash
# `npm run release:mac`: a pré-release local do app do Mac, sem assinatura da Apple (docs/processo-de-release.md,
# "Pré-release local"). Publica a versão do package.json da main como `desktop-v<versão>`: gera os DMGs x64 e arm64
# numa cópia limpa do commit, verifica, cria o rascunho, confere os hashes do que o GitHub guardou e publica.
# A release assinada pelo CI (tags `v*`, desktop-release.yml) continua separada e precisa dos secrets da Apple.
#
#   npm run release:mac                     # publica a versão da origin/main
#   npm run release:mac -- --sem-publicar   # para no rascunho
#   npm run release:mac -- --notas notas.md # notas próprias em vez das geradas pelos títulos dos PRs
#
# Precisa de: macOS, Node 24, `gh` logado com acesso de escrita ao repositório.
set -euo pipefail

REPO_GH=gamefik/nod
# O endereço de produção enquanto NOD_DOMINIO está vazio (docs/deploy-gcp.md). A variável de ambiente ou a variável
# de repositório NOD_SERVIDOR_PADRAO, quando existem, têm precedência.
SERVIDOR_PRODUCAO=https://34-39-164-139.sslip.io

PUBLICAR=1
NOTAS=""
REF=origin/main
while [ $# -gt 0 ]; do
  case "$1" in
    --sem-publicar) PUBLICAR=0 ;;
    --notas) NOTAS=$(cd "$(dirname "$2")" && pwd)/$(basename "$2"); shift ;;
    --ref) REF="$2"; shift ;;
    *) echo "opção desconhecida: $1" >&2; exit 2 ;;
  esac
  shift
done

passo() { printf '\n== %s\n' "$*"; }
falha() { echo "ERRO: $*" >&2; exit 1; }

passo "Conferências"
[ "$(uname)" = Darwin ] || falha "o DMG só sai num Mac"
gh auth status >/dev/null 2>&1 || falha "o gh não está logado (gh auth login)"
[ "$(node -p 'process.versions.node.split(".")[0]')" = 24 ] || falha "precisa do Node 24 (o projeto pina 24.19.0)"
RAIZ=$(git rev-parse --show-toplevel)
git -C "$RAIZ" fetch --quiet --tags --force origin
VERSAO=$(git -C "$RAIZ" show "$REF:package.json" | node -p 'JSON.parse(require("fs").readFileSync(0, "utf8")).version')
TAG="desktop-v$VERSAO"
echo "versão $VERSAO, tag $TAG"

RASCUNHO=$(gh release view "$TAG" -R "$REPO_GH" --json isDraft --jq .isDraft 2>/dev/null || true)
[ "$RASCUNHO" = false ] && { echo "A $TAG já está publicada. Nada a fazer."; exit 0; }
[ "$RASCUNHO" = true ] && falha "já existe um rascunho da $TAG. Publique-o ou apague-o (gh release delete $TAG -R $REPO_GH) e rode de novo"

# Tag já marcada (por exemplo, por outra sessão): builda o commit dela, sem mover a tag. Sem tag: o commit da main.
if git -C "$RAIZ" rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  SHA=$(git -C "$RAIZ" rev-parse "refs/tags/$TAG^{commit}")
  TAG_EXISTE=1
  [ "$(git -C "$RAIZ" show "$SHA:package.json" | node -p 'JSON.parse(require("fs").readFileSync(0, "utf8")).version')" = "$VERSAO" ] \
    || falha "a tag $TAG aponta para $SHA, cujo package.json não está na $VERSAO"
else
  SHA=$(git -C "$RAIZ" rev-parse "$REF^{commit}")
  TAG_EXISTE=0
fi
echo "commit $SHA"

SERVIDOR=${NOD_SERVIDOR_PADRAO:-$(gh variable get NOD_SERVIDOR_PADRAO -R "$REPO_GH" 2>/dev/null || echo "$SERVIDOR_PRODUCAO")}
[[ "$SERVIDOR" =~ ^https://[^/]+$ ]] || falha "servidor embutido fora do formato https://host: $SERVIDOR"
echo "servidor embutido $SERVIDOR"

ANTERIOR=$(gh release list -R "$REPO_GH" --exclude-drafts --limit 50 --json tagName,publishedAt \
  --jq '[.[] | select(.tagName | test("^(desktop-)?v"))] | sort_by(.publishedAt) | last | .tagName // ""')

# O hdiutil trava quando o Mac está saturado (rc.8: Docker a 800% de CPU). Um DMG de 2 MB em 90 s prova que ele responde.
# Caminho real (pwd -P): o $TMPDIR do macOS fica em /var, link para /private/var, e o proxy só roda o main quando o
# caminho recebido é igual ao import.meta.url dele. Pelo link, ele sai com 0 sem responder.
TRABALHO=$(cd "$(mktemp -d "${TMPDIR:-/tmp}/nod-release-$VERSAO.XXXXXX")" && pwd -P)
perl -e 'alarm 90; exec @ARGV' hdiutil create -quiet -size 2m -fs HFS+ -volname teste "$TRABALHO/teste.dmg" \
  || falha "o hdiutil não respondeu em 90 s. Alivie o Mac (por exemplo, docker desktop restart) e rode de novo"

passo "Cópia limpa do commit"
CODIGO="$TRABALHO/codigo"
SAIDA="$TRABALHO/saida"
git -C "$RAIZ" worktree add --quiet --detach "$CODIGO" "$SHA"
trap 'git -C "$RAIZ" worktree remove --force "$CODIGO" >/dev/null 2>&1 || true' EXIT
cd "$CODIGO"

passo "Build"
npm ci --no-audit --no-fund
node node_modules/electron/install.js
NOD_SERVIDOR_PADRAO="$SERVIDOR" npm run desktop:build
# Assinatura ad-hoc (identity=-) exige o hardened runtime desligado. A distribuição assinada fica com o desktop-release.yml.
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac dmg --x64 --arm64 --publish never \
  --config.mac.identity=- --config.mac.hardenedRuntime=false --config.mac.notarize=false --config.dmg.sign=false \
  --config.directories.output="$SAIDA"

passo "Verificação"
for ARCH in x64 arm64; do
  DMG="$SAIDA/nod-$VERSAO-mac-$ARCH.dmg"
  if [ "$ARCH" = x64 ]; then APP="$SAIDA/mac/nod.app"; LIPO=x86_64; else APP="$SAIDA/mac-arm64/nod.app"; LIPO=arm64; fi
  [ -f "$DMG" ] || falha "faltou $DMG"
  hdiutil verify -quiet "$DMG" || falha "hdiutil verify reprovou $DMG"
  codesign --verify --deep --strict "$APP" || falha "codesign reprovou $APP"
  [ "$(lipo -archs "$APP/Contents/MacOS/nod")" = "$LIPO" ] || falha "$APP não é $LIPO"
  [ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist")" = "$VERSAO" ] || falha "$APP não está na $VERSAO"
  grep -q -a "${SERVIDOR#https://}" "$APP/Contents/Resources/app.asar" || falha "$APP sem o servidor embutido"
  [ -f "$APP/Contents/Resources/npm/bin/npm-cli.js" ] || falha "$APP sem o npm embutido"
  echo "$ARCH: DMG íntegro, assinatura ad-hoc, $LIPO, $VERSAO, servidor e npm embutidos"
done
# O proxy só executa na arquitetura deste Mac; a outra sai por build cruzado.
if [ "$(uname -m)" = arm64 ]; then APP="$SAIDA/mac-arm64/nod.app"; else APP="$SAIDA/mac/nod.app"; fi
node scripts/desktop/smoke-proxy.mjs "$APP/Contents/MacOS/nod" "$APP/Contents/Resources/app.asar.unpacked/dist/desktop/proxy.mjs"
(cd "$SAIDA" && shasum -a 256 "nod-$VERSAO-mac-x64.dmg" "nod-$VERSAO-mac-arm64.dmg" > SHA256SUMS.txt && cat SHA256SUMS.txt)

passo "Notas"
if [ -z "$NOTAS" ]; then
  NOTAS="$TRABALHO/notas.md"
  {
    echo "Pré-release do app do Mac para teste. Sem assinatura da Apple: na primeira abertura, clique com o botão direito no app e escolha **Abrir**."
    if [ -n "$ANTERIOR" ] && git rev-parse -q --verify "refs/tags/$ANTERIOR" >/dev/null; then
      PRS=$(git log --first-parent --format='- %s' "$ANTERIOR..$SHA" | grep -E '\(#[0-9]+\)$' | grep -viE '^- chore: versão' || true)
      if [ -n "$PRS" ]; then printf '\n## O que entrou desde a %s\n\n%s\n' "$ANTERIOR" "$PRS"; fi
    fi
    echo
    echo "A tela vem do servidor: o que muda só na web ou no servidor chega ao app pelo deploy, sem nova versão."
    echo
    echo "Servidor embutido: $SERVIDOR"
  } > "$NOTAS"
fi
cat "$NOTAS"

passo "Rascunho"
ALVO=(--target "$SHA")
[ "$TAG_EXISTE" = 1 ] && ALVO=(--verify-tag)
PRE=()
[[ "$VERSAO" == *-* ]] && PRE=(--prerelease)
gh release create "$TAG" -R "$REPO_GH" "${ALVO[@]}" --draft ${PRE[@]+"${PRE[@]}"} --title "nod $VERSAO (app do Mac)" --notes-file "$NOTAS" \
  "$SAIDA/nod-$VERSAO-mac-x64.dmg" "$SAIDA/nod-$VERSAO-mac-arm64.dmg" "$SAIDA/SHA256SUMS.txt"

# Confere os bytes que o GitHub guardou, não os locais.
mkdir "$TRABALHO/baixado"
gh release download "$TAG" -R "$REPO_GH" -D "$TRABALHO/baixado"
(cd "$TRABALHO/baixado" && shasum -a 256 -c SHA256SUMS.txt) || falha "os hashes baixados não batem; o rascunho ficou para conferência"

if [ "$PUBLICAR" = 0 ]; then
  passo "Parado no rascunho (--sem-publicar)"
  gh release view "$TAG" -R "$REPO_GH" --json url --jq .url
  exit 0
fi

passo "Publicação"
gh release edit "$TAG" -R "$REPO_GH" --draft=false ${PRE[@]+"${PRE[@]}"}
DESTINO="$HOME/Downloads/nod-$VERSAO"
mkdir -p "$DESTINO"
cp "$TRABALHO/baixado/"* "$DESTINO/"
echo "Publicada: $(gh release view "$TAG" -R "$REPO_GH" --json url --jq .url)"
echo "DMGs em $DESTINO"
