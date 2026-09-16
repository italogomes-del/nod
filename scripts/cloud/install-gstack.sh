#!/usr/bin/env bash
# Instala o gstack no ambiente de nuvem (bun + clone pinado + setup + skills do Cursor).
# Idempotente: o install do .cursor/environment.json pode rodar de novo no mesmo disco.
set -euo pipefail

GSTACK_REF="${GSTACK_REF:-c43c850cae779bcd134b71a28eeec00628ba0792}"
GSTACK_REPO="https://github.com/garrytan/gstack.git"
GSTACK_DIR="${HOME}/.claude/skills/gstack"
CURSOR_SKILLS="${HOME}/.cursor/skills"
BUN_INSTALL="${BUN_INSTALL:-${HOME}/.bun}"
export BUN_INSTALL
export PATH="${HOME}/.bun/bin:${PATH}"

persistir_bun_no_path() {
  local bun_bin="${HOME}/.bun/bin/bun"
  local bunx_bin="${HOME}/.bun/bin/bunx"
  [ -x "$bun_bin" ] || return 0

  if [ -f "${HOME}/.bashrc" ] && ! grep -q 'BUN_INSTALL' "${HOME}/.bashrc"; then
    printf '\nexport BUN_INSTALL="$HOME/.bun"\nexport PATH="$BUN_INSTALL/bin:$PATH"\n' >> "${HOME}/.bashrc"
  fi

  if [ -x /usr/local/bin/bun ]; then
    return 0
  fi
  if [ -w /usr/local/bin ]; then
    ln -sfn "$bun_bin" /usr/local/bin/bun
    [ -x "$bunx_bin" ] && ln -sfn "$bunx_bin" /usr/local/bin/bunx
  elif command -v sudo >/dev/null 2>&1; then
    sudo -n ln -sfn "$bun_bin" /usr/local/bin/bun 2>/dev/null || \
      echo "aviso: bun está em ${HOME}/.bun/bin; não entrou em /usr/local/bin" >&2
    if [ -x "$bunx_bin" ]; then
      sudo -n ln -sfn "$bunx_bin" /usr/local/bin/bunx 2>/dev/null || true
    fi
  fi
}

instalar_bun() {
  if command -v bun >/dev/null 2>&1; then
    echo "bun já instalado: $(command -v bun) ($(bun --version))"
    persistir_bun_no_path
    return 0
  fi
  echo "instalando bun 1.3.10 em ${BUN_INSTALL}"
  curl -fsSL https://bun.sh/install | bash -s "bun-v1.3.10"
  export PATH="${HOME}/.bun/bin:${PATH}"
  command -v bun >/dev/null 2>&1 || {
    echo "falha: bun não ficou no PATH depois da instalação" >&2
    exit 1
  }
  persistir_bun_no_path
}

clonar_gstack() {
  mkdir -p "$(dirname "$GSTACK_DIR")"
  if [ -d "${GSTACK_DIR}/.git" ]; then
    echo "gstack já clonado; fetch + checkout ${GSTACK_REF}"
    git -C "$GSTACK_DIR" fetch --force origin "$GSTACK_REF"
    git -C "$GSTACK_DIR" checkout --force --detach "$GSTACK_REF"
  else
    if [ -e "$GSTACK_DIR" ]; then
      echo "pasta ${GSTACK_DIR} existe sem .git; recria"
      rm -rf "$GSTACK_DIR"
    fi
    echo "clonando gstack em ${GSTACK_DIR}"
    git clone "$GSTACK_REPO" "$GSTACK_DIR"
    git -C "$GSTACK_DIR" checkout --force --detach "$GSTACK_REF"
  fi
  echo "gstack em $(git -C "$GSTACK_DIR" rev-parse HEAD)"
}

rodar_setup() {
  (
    cd "$GSTACK_DIR"
    ./setup --host claude --no-prefix --no-team --no-plan-tune-hooks --quiet
  )
}

instalar_chromium_com_deps() {
  echo "tentando npx playwright install --with-deps chromium"
  (
    cd "$GSTACK_DIR"
    npx --yes playwright install --with-deps chromium
  ) || true
}

chromium_abre() {
  if [ ! -d "${GSTACK_DIR}/node_modules/playwright" ]; then
    return 1
  fi
  if command -v bun >/dev/null 2>&1; then
    (
      cd "$GSTACK_DIR"
      bun --eval 'import { chromium } from "playwright"; const browser = await chromium.launch(); await browser.close();'
    ) >/dev/null 2>&1
  else
    (
      cd "$GSTACK_DIR"
      node -e "const { chromium } = require('playwright'); (async () => { const b = await chromium.launch(); await b.close(); })()"
    ) >/dev/null 2>&1
  fi
}

ligar_skills_no_cursor() {
  mkdir -p "$CURSOR_SKILLS"
  local skill dest nome
  shopt -s nullglob
  for skill in "${HOME}/.claude/skills"/*/; do
    skill="${skill%/}"
    nome="$(basename "$skill")"
    [ "$nome" = "gstack" ] && continue
    [ -f "${skill}/SKILL.md" ] || continue
    dest="${CURSOR_SKILLS}/${nome}"
    if [ -e "$dest" ] || [ -L "$dest" ]; then
      echo "mantém ${dest} (já existe)"
      continue
    fi
    ln -s "$skill" "$dest"
    echo "symlink ${dest} -> ${skill}"
  done
  shopt -u nullglob
}

configurar_gstack() {
  local cfg="${GSTACK_DIR}/bin/gstack-config"
  if [ ! -x "$cfg" ]; then
    echo "aviso: ${cfg} não executável; pulando gstack-config" >&2
    return 0
  fi
  "$cfg" set telemetry off
  "$cfg" set update_check false
  "$cfg" set auto_upgrade false
  "$cfg" set proactive false
}

instalar_bun
clonar_gstack

if ! rodar_setup; then
  echo "aviso: ./setup falhou; tentando Chromium com dependências do sistema"
  instalar_chromium_com_deps
  if ! rodar_setup; then
    echo "aviso: ./setup falhou de novo; seguindo (o Build não falha por Chromium)" >&2
  fi
fi

ligar_skills_no_cursor
configurar_gstack

if ! chromium_abre; then
  instalar_chromium_com_deps
  if ! chromium_abre; then
    echo "aviso: Chromium do Playwright não abre; seguindo (o Build não falha por isso)" >&2
  fi
fi

echo "gstack pronto (ref ${GSTACK_REF})"
