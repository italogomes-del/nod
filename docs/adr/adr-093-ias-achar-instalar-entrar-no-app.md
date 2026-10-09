# ADR-093 — Achar, instalar e entrar nas IAs dentro do app do Mac

**Status** aceito · decidido e implementado em 2026-10-09 (plano "IAs: conexão, troca e escolha de modelo", PR 1;
aprovado pelo Marlon no canvas da troca de IA). Emenda as ADR-014 (CLI do fornecedor) e ADR-077 (onboarding).

## Contexto

Teste do Breno em produção (09/10, app 0.4.0-rc.6): ele não conseguiu trocar do Claude para o Codex. No app do Mac:

- o PATH vinha de `$SHELL -l -c`, que não lê o `.zshrc` onde o nvm é carregado, então o Codex de um `npm -g` no nvm
  não era achado; e o `#!/usr/bin/env node` do Codex não achava o node;
- `nod:ia-entrar` rodava o login desanexado e jogava a saída fora (sem link, sem código, erro mudo); `nod:ia-instalar`
  só abria a página oficial;
- a vigia parava de sondar a outra IA quando uma estava pronta;
- sem node, a sonda do Codex dizia "Atualize o Codex".

O Marlon: "aqui não podemos errar; conferir o link, conferir que leva à página correta".

## Decisão

1. **PATH em camadas** (`src/adapters/executor/caminho.ts`): pastas do nod › PATH do processo › instaladores
   conhecidos (~/.local/bin, ~/.claude/local, Homebrew, volta, asdf, bun, mise) › TODAS as versões do nvm (a do
   `alias/default` primeiro) › PATH do shell real (`$SHELL -l -i`, com marcador, em segundo plano, 10 s, com cache)
   › "node do nod". Todo filho de CLI recebe esse PATH; o log e o estado dizem qual binário rodou e de qual camada.
2. **Instalar com um clique sem depender do Node do Mac** (`desktop/instalar-ia.ts`): o app leva o próprio npm
   (devDependency `npm` com versão exata, em `Contents/Resources/npm` por `extraResources`) e o roda com o Electron
   como node (`ELECTRON_RUN_AS_NODE=1`). `npm install --global --prefix <userData>/ferramentas` do pacote oficial
   (`@openai/codex`, `@anthropic-ai/claude-code`), `@latest`, com cache próprio, sem sudo nem shell. O "node do nod"
   (`<userData>/ferramentas/node-do-nod/node`, 2 linhas de sh) dá node aos scripts do npm e, no fim do PATH, ao
   `#!/usr/bin/env node` do Codex num Mac sem Node. Fim: `--version` com o PATH aumentado e o piso (`PISO_CLI`).
3. **Login dentro do app** (`desktop/login-ia.ts`): Codex com `codex login --device-auth` (o app lê o link e o código),
   Claude com `claude auth login --claudeai` por pipe (o CLI abre o navegador e conclui pelo localhost; o link de
   reserva mostra um código, que a pessoa cola no app e vai ao stdin). Conferência pelo status a cada 2 s por 2 min,
   depois "Verificar de novo". O nod nunca lê nem guarda token.
4. **Só links oficiais, por host E caminho**: `auth.openai.com/codex/device`, `claude.com/cai/oauth/authorize`,
   `claude.ai/oauth/authorize`. Fora da lista, o link não é mostrado nem aberto. A página nunca passa endereço nem
   argumento: só escolhe a IA, e o único texto dela que chega a um processo é o código colado, validado, pelo stdin.
5. **A vigia continua sondando a outra IA** a cada 60 s (só a sonda grátis, sem trocar o registro da que está pronta).
6. **Estado único por IA** (`src/contracts/estado-ia.ts`, montado por `src/domain/estado-ia.ts`): treze estados,
   com `config_invalida` e `sem_node` separados de "falta entrar" e "não instalada". As causas novas (`sem_node`,
   `config_invalida`) vão só na tela do Mac; o servidor de hoje as reduz ao estado sem causa (`ponte-validacao.ts`).
   Exposto em `window.nodDesktop.ias`; os IPC antigos (`iaEntrar`, `iaInstalar`) continuam até o PR da web.

## Alternativas descartadas

- **Baixar o Node oficial com sha256 (block/buzz)**: mais um download, mais uma verificação e ~45 MB por versão; o
  Electron já é um Node 24 assinado com o app.
- **Exigir o npm do Mac (OpenMausBot)**: é justamente o que falta na máquina de quem mais precisa do clique.
- **Instalador oficial do Claude (`claude.ai/install.sh`)**: exige shell e `curl | bash`; o pacote npm instala o
  mesmo binário nativo assinado pela Anthropic (medido: Team ID Q6L2SF6YDW), e o Codex já é npm.
- **Abrir o Terminal com o login (`.command`, block/buzz)**: tira a pessoa do app e esconde o erro do nod.

## Consequências e gatilhos de reversão

- O app cresce ~17 MB (o npm). Reverter se o electron-builder deixar de copiar `npm/node_modules` (a segunda entrada
  de `extraResources` existe porque a primeira descarta essa pasta).
- O "node do nod" leva `ELECTRON_RUN_AS_NODE=1` a quem o Codex abrir num Mac SEM Node; um app Electron chamado pelo
  bot nesse Mac abriria como node. Gatilho: um caso real; a saída é um bootstrap que apaga a variável.
- O app é ad-hoc nas pré-releases: o Gatekeeper avalia os binários que ele executa (ver memória do modal). Os binários
  instalados são assinados pelos fornecedores (Codex: Team ID 2DC432GLL2).
- A página de login fica atrás do Cloudflare: a conferência automática chega só aos redirecionamentos
  (`auth.openai.com/codex/device` → `auth.openai.com/oauth/authorize`; `claude.com/cai/…` → `claude.ai/oauth/…`).
  O conteúdo da página e os casos de conta Business/organização exigem o teste humano antes da release.
- Mudou o endereço que um CLI imprime: o login falha com `link_nao_oficial` (o log diz só o host) até a lista ser
  atualizada aqui, com a medida nova.
