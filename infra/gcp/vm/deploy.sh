#!/usr/bin/env bash
# Deploy na VM (chamado pelo workflow, por túnel IAP, como root): monta o env a partir do Secret
# Manager, baixa a imagem, migra como nod_dono e recria o nod (recreate, nunca rolling — ADR-001).
# Uso: deploy.sh <tag-da-imagem>
set -euo pipefail
TAG="${1:?uso: deploy.sh <tag>}"
cd /opt/nod
# Sem aspas, `NOD_MODELO_LIGACAO_CLAUDE=modelo esforco=low` são duas atribuições no `source`: as opções cairiam em silêncio.
if grep -Eq "^NOD_MODELO_(LIGACAO|REVISOR)_[A-Z]+=[^\"' #]+[[:blank:]]+[^[:blank:]#]" config.env; then
  echo "NOD_MODELO_LIGACAO_* com opções precisa estar entre aspas no config.env, e NOD_MODELO_REVISOR_* também (ex.: \"claude-sonnet-5-5 esforco=low\")" >&2
  exit 1
fi
source ./config.env
: "${SQL_IP:?SQL_IP vazio no config.env}"

segredo() { gcloud secrets versions access latest --secret="$1" --project="$PROJETO"; }

IP_PUBLICO="$(curl -fsS -H 'Metadata-Flavor: Google' http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip)"
PROVISORIO="${IP_PUBLICO//./-}.sslip.io"
# Sem domínio, o provisório é o endereço. Com domínio, o Caddy serve os dois (NOD-173): Macs antigos têm o provisório.
if [ -z "${NOD_DOMINIO:-}" ]; then
  NOD_DOMINIO="$PROVISORIO"
  NOD_ENDERECO_PROVISORIO=""
else
  NOD_ENDERECO_PROVISORIO="$PROVISORIO"
fi
export NOD_DOMINIO NOD_ENDERECO_PROVISORIO
export NOD_IMAGEM="$REGISTRO/nod:$TAG"

GOOGLE_ID="$(segredo nod-google-client-id 2>/dev/null || true)"
GOOGLE_SEGREDO="$(segredo nod-google-client-secret 2>/dev/null || true)"
if [ -z "$GOOGLE_ID" ] || [ -z "$GOOGLE_SEGREDO" ]; then
  echo "faltam os segredos nod-google-client-id/secret (docs/deploy-gcp.md, passo do OAuth)" >&2
  exit 1
fi

umask 077
cat >nod.env.novo <<EOF
NOD_LOGIN=google
NOD_HOST=0.0.0.0
NOD_MODO=compartilhado
NOD_STATIC_DIR=/app/dist/web
NOD_HOME=/data/nod
NOD_FUSO_PADRAO=America/Sao_Paulo
NOD_BANCO_AMBIENTE=persistente
DATABASE_URL=postgres://nod_app:$(segredo nod-pg-senha-app)@$SQL_IP:5432/nod?sslmode=require
# ADR-001 (emenda de 2026-10-15): pool da app direto no Cloud SQL (max_connections 100); 15 é o padrão do código.
NOD_DB_POOL_MAX=15
# O boot cria as partições de events dos próximos 12 meses como dono (ADR-006) e fecha a conexão;
# as requisições usam só nod_app.
DATABASE_URL_DONO=postgres://nod_dono:$(segredo nod-pg-senha-dono)@$SQL_IP:5432/nod?sslmode=require
NOD_SESSAO_SEGREDO=$(segredo nod-sessao-segredo)
NOD_CREDENTIAL_KEY=$(segredo nod-credential-key)
NOD_GOOGLE_CLIENT_ID=$GOOGLE_ID
NOD_GOOGLE_CLIENT_SECRET=$GOOGLE_SEGREDO
NOD_GOOGLE_REDIRECT_URI=https://$NOD_DOMINIO/api/sessao/google/callback
# Emenda de 2026-10-05 da ADR-030: contas Workspace destes domínios viram pessoa na primeira entrada (config.env).
NOD_ADMISSAO_DOMINIOS=${NOD_ADMISSAO_DOMINIOS:-}
# Modo ligação (ADR-071): voz pelo Google pago pelos créditos do projeto; só admins na fase 1 (NOD_ADMINS no config.env).
NOD_VOZ_PROJETO=$PROJETO
NOD_LIGACAO=${NOD_LIGACAO:-admins}
NOD_ADMINS=${NOD_ADMINS:-}
NOD_ONBOARDING_VOZ=${NOD_ONBOARDING_VOZ:-0}
NOD_MODELO_LIGACAO_CLAUDE=${NOD_MODELO_LIGACAO_CLAUDE:-}
NOD_MODELO_LIGACAO_CODEX=${NOD_MODELO_LIGACAO_CODEX:-}
NOD_REVISOR=${NOD_REVISOR:-}
NOD_MODELO_REVISOR_CLAUDE=${NOD_MODELO_REVISOR_CLAUDE:-}
NOD_REVISOR_TETO_DIA=${NOD_REVISOR_TETO_DIA:-}
# NOD-167: sem a linha no config.env, produção fica com a ligação Codex DESLIGADA (o padrão do código é ligada).
NOD_LIGACAO_CODEX=${NOD_LIGACAO_CODEX:-0}
# Teto de pedidos de TTS por minuto deste processo, abaixo da cota de 200/min do projeto (emenda da ADR-071, NOD-166).
NOD_VOZ_TTS_TETO_MIN=${NOD_VOZ_TTS_TETO_MIN:-180}
NOD_DRENAGEM_MAX_MS=600000
EOF
mv nod.env.novo nod.env

docker compose pull nod
docker compose run --rm --no-deps -T nod node scripts/migrate.ts
docker compose up -d --remove-orphans
# O Caddy lê o Caddyfile num bind de arquivo único: mudou o arquivo, recria o container (fora disso, nunca — derrubaria
# os WebSockets das ligações).
SHA_CADDY="$(sha256sum Caddyfile | cut -d' ' -f1)"
if [ "$SHA_CADDY" != "$(cat .caddyfile.sha 2>/dev/null || true)" ]; then
  docker compose up -d --force-recreate --no-deps caddy
  echo "$SHA_CADDY" > .caddyfile.sha
fi

for _ in $(seq 1 30); do
  if [ "$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q nod)")" = healthy ]; then
    echo "nod no ar: https://$NOD_DOMINIO ($TAG)"
    docker image prune -f >/dev/null
    exit 0
  fi
  sleep 3
done
echo "o nod não ficou saudável em 90 s" >&2
docker compose logs --tail=80 nod >&2
exit 1
