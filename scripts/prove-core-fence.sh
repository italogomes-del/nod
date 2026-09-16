#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/tsconfig.json" <<EOF
{
  "extends": "$ROOT/tsconfig.core.json",
  "compilerOptions": { "noEmit": true },
  "include": ["illegal.ts", "$ROOT/contracts/**/*.ts"]
}
EOF
cat > "$TMP/illegal.ts" <<'EOF'
import { readFileSync } from "node:fs";
export const leak = readFileSync("/etc/hostname");
EOF
if npx tsc -p "$TMP/tsconfig.json" --pretty false >"$TMP/err" 2>&1; then
  echo "FALHA: o core compilou um import node:fs — a cerca do ADR-018 não está de pé." >&2
  exit 1
fi
if ! grep -q "node:fs" "$TMP/err"; then
  echo "FALHA: o compilador recusou por outro motivo:" >&2
  cat "$TMP/err" >&2
  exit 1
fi
echo "cerca do core ok: node:fs recusado"
