/**
 * A instalação do motor numa máquina Linux da pessoa (ADR-088): `curl -fsSL https://<nod>/motor | sh`. O servidor serve
 * este script com o próprio endereço e a própria versão, e os três arquivos do motor (dist/motor). Debian e Ubuntu,
 * x64 e arm64. Roda de novo para atualizar: troca os arquivos, mantém a conexão e o login das IAs.
 *
 *   root/sudo ── apt (curl, git, gh) ── Node fixo em /opt/nod-motor/node ── usuário `nod`
 *            └─ Claude Code (e o Codex, com NOD_COM_CODEX=1) no ~/.local do `nod` ── /opt/nod-motor/app (3 arquivos)
 *            └─ /usr/local/bin/nod-motor (roda como `nod`) ── serviço nod-motor (systemd) ── pareamento por código
 *
 * O motor roda como o usuário `nod`, nunca root. A chave fica em ~nod/.config/nod-motor (0600). O login das IAs é feito
 * pela pessoa, no terminal (`nod-motor entrar claude`): o script não pede nem guarda credencial nenhuma.
 */
export const ARQUIVOS_DO_MOTOR = ["nod-motor.mjs", "proxy.mjs", "hook-nativas.mjs"] as const;
export type ArquivoDoMotor = (typeof ARQUIVOS_DO_MOTOR)[number];

/** O Node que o motor usa (o mesmo do .mise.toml e do Dockerfile). */
export const NODE_DO_MOTOR = "24.19.0";

/** Só https (ou http em loopback, dev) e um host sem nada que o shell interprete. */
export function servidorParaScript(proto: string, host: string): string | null {
  const p = proto.split(",")[0]?.trim().toLowerCase();
  const h = host.split(",")[0]?.trim().toLowerCase() ?? "";
  if (!/^[a-z0-9.-]+(:\d{1,5})?$/.test(h)) return null;
  const loopback = /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(h);
  if (p === "https") return `https://${h}`;
  if (p === "http" && loopback) return `http://${h}`;
  return null;
}

export function scriptDeInstalacao(o: { servidor: string; versao: string }): string {
  if (!/^https?:\/\/[a-z0-9.:-]+$/.test(o.servidor) || !/^[0-9A-Za-z.+-]+$/.test(o.versao)) throw new Error("servidor_ou_versao_invalida");
  return `#!/bin/sh
# Nod: instala ou atualiza o motor nesta máquina (ADR-088). Servido por ${o.servidor}/motor
set -eu
NOD_SERVIDOR="${o.servidor}"
NOD_VERSAO="${o.versao}"
NODE_VERSAO="${NODE_DO_MOTOR}"
PASTA=/opt/nod-motor
USUARIO=nod
CASA=/home/nod

falhar() { printf '\\n\\342\\234\\227 %s\\n' "$1" >&2; exit 1; }
passo() { printf '\\342\\234\\223 %s\\n' "$1"; }

[ "$(uname -s)" = "Linux" ] || falhar "O motor do Nod roda em Linux (Debian ou Ubuntu)."
command -v apt-get >/dev/null 2>&1 || falhar "Esta instalação usa o apt (Debian ou Ubuntu)."
if [ "$(id -u)" -eq 0 ]; then SUDO=""; else
  command -v sudo >/dev/null 2>&1 || falhar "Rode como root ou instale o sudo."
  SUDO="sudo"
fi
case "$(uname -m)" in
  x86_64|amd64) ARQ=x64 ;;
  aarch64|arm64) ARQ=arm64 ;;
  *) falhar "Processador não suportado: $(uname -m)" ;;
esac
como_nod() {
  if [ "$(id -u)" -eq 0 ]; then runuser -u "$USUARIO" -- env HOME="$CASA" PATH="$CASA/.local/bin:$PASTA/node/bin:/usr/local/bin:/usr/bin:/bin" "$@"
  else sudo -u "$USUARIO" -H env HOME="$CASA" PATH="$CASA/.local/bin:$PASTA/node/bin:/usr/local/bin:/usr/bin:/bin" "$@"; fi
}

printf 'Nod \\302\\267 instalando o motor %s nesta máquina\\n' "$NOD_VERSAO"

$SUDO apt-get update -qq >/dev/null
$SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq curl ca-certificates git xz-utils procps >/dev/null
passo "curl e git"

if ! command -v gh >/dev/null 2>&1; then
  $SUDO mkdir -p -m 755 /etc/apt/keyrings
  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | $SUDO tee /etc/apt/keyrings/githubcli-archive-keyring.gpg >/dev/null
  $SUDO chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | $SUDO tee /etc/apt/sources.list.d/github-cli.list >/dev/null
  $SUDO apt-get update -qq >/dev/null
  $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq gh >/dev/null
fi
passo "gh (GitHub)"

if [ "$("$PASTA/node/bin/node" --version 2>/dev/null || true)" != "v$NODE_VERSAO" ]; then
  TMP=$(mktemp -d)
  curl -fsSL "https://nodejs.org/dist/v$NODE_VERSAO/node-v$NODE_VERSAO-linux-$ARQ.tar.xz" -o "$TMP/node.tar.xz"
  $SUDO rm -rf "$PASTA/node"
  $SUDO mkdir -p "$PASTA/node"
  $SUDO tar -xJf "$TMP/node.tar.xz" -C "$PASTA/node" --strip-components=1
  rm -rf "$TMP"
fi
passo "Node $NODE_VERSAO"

if ! id "$USUARIO" >/dev/null 2>&1; then
  $SUDO useradd --create-home --home-dir "$CASA" --shell /bin/bash "$USUARIO"
fi
passo "usuário $USUARIO"

como_nod npm install -g --prefix "$CASA/.local" --no-fund --no-audit --loglevel=error @anthropic-ai/claude-code >/dev/null
passo "Claude Code"
if [ "\${NOD_COM_CODEX:-0}" = "1" ]; then
  como_nod npm install -g --prefix "$CASA/.local" --no-fund --no-audit --loglevel=error @openai/codex >/dev/null
  passo "Codex"
fi

$SUDO mkdir -p "$PASTA/app"
for ARQUIVO in ${ARQUIVOS_DO_MOTOR.join(" ")}; do
  curl -fsSL "$NOD_SERVIDOR/api/motor/arquivos/$ARQUIVO" -o "/tmp/nod-motor-$ARQUIVO.$$"
  $SUDO mv "/tmp/nod-motor-$ARQUIVO.$$" "$PASTA/app/$ARQUIVO"
done
$SUDO chmod 644 "$PASTA/app/"*.mjs
passo "motor $NOD_VERSAO"

$SUDO tee /usr/local/bin/nod-motor >/dev/null <<'NODMOTOR'
#!/bin/sh
# Roda o motor do Nod como o usuário nod (ADR-088). Depois de parear ou entrar numa IA, o serviço recomeça.
set -eu
CASA=/home/nod
CAMINHO="$CASA/.local/bin:/opt/nod-motor/node/bin:/usr/local/bin:/usr/bin:/bin"
MOTOR="/opt/nod-motor/node/bin/node /opt/nod-motor/app/nod-motor.mjs"
if [ "$(id -un)" = nod ]; then exec env PATH="$CAMINHO" $MOTOR "$@"; fi
if [ "$(id -u)" -eq 0 ]; then
  runuser -u nod -- env HOME="$CASA" PATH="$CAMINHO" $MOTOR "$@" && ok=1 || ok=0
  SUDO=""
else
  sudo -u nod -H env PATH="$CAMINHO" $MOTOR "$@" && ok=1 || ok=0
  SUDO="sudo"
fi
if [ "$ok" = 1 ] && { [ "\${1:-}" = parear ] || [ "\${1:-}" = entrar ]; }; then $SUDO systemctl restart nod-motor || true; fi
[ "$ok" = 1 ]
NODMOTOR
$SUDO chmod 755 /usr/local/bin/nod-motor

$SUDO tee /etc/systemd/system/nod-motor.service >/dev/null <<'NODSERVICO'
[Unit]
Description=Nod: o motor desta máquina (ADR-088)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=nod
Group=nod
WorkingDirectory=/home/nod
Environment=HOME=/home/nod
Environment=PATH=/home/nod/.local/bin:/opt/nod-motor/node/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=/opt/nod-motor/node/bin/node /opt/nod-motor/app/nod-motor.mjs rodar
Restart=always
RestartSec=5
# 2 = sem conexão, chave revogada ou motor desatualizado: só volta depois de parear ou atualizar.
RestartPreventExitStatus=2
KillMode=mixed
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
NODSERVICO
$SUDO systemctl daemon-reload
$SUDO systemctl enable nod-motor >/dev/null 2>&1
passo "serviço nod-motor (volta sozinho se a máquina reiniciar)"

if [ -f "$CASA/.config/nod-motor/conexao.json" ]; then
  $SUDO systemctl restart nod-motor
  printf '\\nMotor atualizado e no ar. Estado: nod-motor estado\\n'
  exit 0
fi

printf '\\n'
/usr/local/bin/nod-motor parear "$NOD_SERVIDOR" || falhar "O pareamento não terminou. Rode de novo: nod-motor parear $NOD_SERVIDOR"
printf 'Dica: deixe esta máquina só para o Nod, com atualizações de segurança automáticas e SSH só por chave.\\n'
`;
}
