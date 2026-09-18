#!/usr/bin/env bash
set -euo pipefail

destino="${NOD_BACKUP_DIR:-backups/local}"
mkdir -p "$destino"

agora="$(date -u +%Y%m%dT%H%M%SZ)"
arquivo="$destino/nod-$agora.dump"
temporario="$arquivo.part"

trap 'rm -f "$temporario"' EXIT
docker compose exec -T postgres pg_dump -U postgres -d nod --format=custom --no-owner > "$temporario"
test -s "$temporario"
docker compose exec -T postgres pg_restore --list < "$temporario" > /dev/null
mv "$temporario" "$arquivo"
trap - EXIT

echo "$arquivo"
