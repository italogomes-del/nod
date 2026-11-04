# ADA-11 · Nod rodando também no Windows — Plano de engenharia (Fase 1)

Escopo deste plano (ajuste da Ada, 03/11): **só a Fase 1**. Ficam fora a assinatura/certificado do instalador e a lista de issues das fases seguintes (as duas esperam o Marlon). Base: `origin/main` 1c70bd51. Referência: [milind-soni/OpenMausBot](https://github.com/milind-soni/OpenMausBot) @ eea36bd (achado com `gh search repos openmausbot`; lido, não executado).

## 1. Diagnóstico

Hoje o Nod **não roda no Windows**: o motor e o app do Mac dependem de POSIX em quase toda camada. O próprio repo admite (`docs/release-desktop.md:222`, `docs/processo-de-release.md:80`: "Não anuncie Windows até haver build validado"). Nenhuma ADR fala de Windows; não há `.gitattributes`.

### OpenMausBot × Nod

| Tema | OpenMausBot (Windows) | Nod hoje | Fase 1 do Nod |
|---|---|---|---|
| Instalação | NSIS one-click por usuário, sem admin, x64 (`electron-builder.yml:160-193`); CLI por `npm i -g` | Linux: `curl …/motor \| sh` com apt, useradd, systemd (`src/adapters/http/motor-instalacao.ts:97-300`); Mac: DMG | Bundle do motor roda com Node 24 no Windows (`node nod-motor.mjs parear/rodar`); instalador `.ps1` fica na Fase 2 |
| Serviço | Sem Windows Service; login item na chave Run (`electron/open-at-login.mjs:7-36`) | systemd `nod-motor.service` (`Restart=always`) | Fora (Fase 2: Tarefa Agendada no logon, por usuário) |
| Shell | PowerShell; spawn **sem shell**, resolve `.cmd` do npm para node+script (`server/env-path.ts:180-183`, CVE-2024-27980); `taskkill /T`, `windowsHide`, prompt por stdin (`server/procs.ts:1-3`); WSL só com aviso | `bash`/`sh` fixos, `kill(-pgid)`, `$SHELL -l` | Copiar: resolvedor de `.cmd`, `taskkill /T /F`, `windowsHide`, Git Bash para os comandos do Nod |
| Caminhos | `%USERPROFILE%\.openmausbot`, credenciais com `safeStorage`/DPAPI | `~/.config/nod-motor`, `0o600` | `%APPDATA%\nod-motor` e `%LOCALAPPDATA%\nod-motor` |
| Sandbox | **Nenhuma** no Windows; bwrap só Linux (`server/bot-box/detect.ts:67`); "safety floor" por regex | bwrap/uids/systemd no computador (ADR-122); cerca do git + hook PreToolUse | Igual ao Mac de hoje: cerca + hook, sem sandbox de SO. Codex usa o sandbox nativo dele |
| Computador do bot | `cua-driver.exe` (trycua) com patch de subsystem PE | Xvfb/openbox/Chromium + bwrap (Linux) | Anuncia `sem_suporte` no win32 |
| Auto-update | electron-updater + `latest.yml` no GitHub, sem Squirrel | Motor: ADR-100 (root + `.path`); desktop: reinstala | Fora (Fase 2) |
| Assinatura | Nenhuma no Windows; CI barra `publisherName` sem cert | Só Mac | Pendência do Marlon (fora) |
| CI | 6 workflows `windows-latest`, 8 shards de vitest, smoke do pacote com `/api/health`, Defender ligado | Só self-hosted Linux + release macOS | Job `windows-latest`: unit dos módulos tocados + smoke do motor |

### O que quebra no Windows (arquivo:linha, conferido em 1c70bd51)

| Área | arquivo:linha | Por que quebra | Sev. | Fase |
|---|---|---|---|---|
| Contrato da máquina | `src/contracts/maquina.ts:14`; `motor/main.ts:243,518`; `src/adapters/http/rotas/ponte.ts:261`; migração `0067…sql:8` (`CHECK plataforma IN ('darwin','linux')`) | Motor manda `"linux"` fixo; win32 não existe no contrato nem no banco | bloqueante | 1 |
| Achar o binário | `src/adapters/executor/caminho.ts:29-38,273,303` | Procura `claude` sem PATHEXT, pastas POSIX, `X_OK` | bloqueante | 1 |
| Spawn | `src/adapters/executor/processo.ts:208` | `.cmd` sem shell dá EINVAL (CVE-2024-27980); `detached` abre console | bloqueante | 1 |
| Parar / matar árvore | `processo.ts:86,98,257,296-305`; `fugitivos.ts:69`; `grupos-orfaos.ts:277`; `caminho.ts:201` | `process.kill(-pgid)` não existe; netos (MCP, Bash do modelo) ficam órfãos | bloqueante | 1 |
| Órfãos no boot / memória | `grupos-orfaos.ts:78,118`; `vaga.ts:87-88,129` | `ps -A`, `/proc/*`, `vm_stat` | alta | 1 |
| Esperas | `src/adapters/executor/esperas.ts:58` | `/bin/bash` → `/bin/sh` | bloqueante | 1 |
| Cerca do git / hook | `src/domain/git-na-pasta-do-bot.ts:48-52`; `src/adapters/executor/hook-nativas.ts:85-88`; `src/domain/nativas.ts:122` | Compara com `/`; caminho `C:\…` cai fora: nega git e some checkpoint (falha fechada) | alta | 1 |
| Comando do hook | `drivers/claude-cli.ts:242,247`; `drivers/codex-comum.ts:112-113`; `fila-do-forno.ts:159` | Aspas POSIX, `VAR=1 cmd`, `/usr/bin/env` | alta | 1 |
| Ambiente do filho | `src/domain/ambiente-executor.ts:18,49`; `registry.ts:49` | Allowlist sem `SystemRoot`/`APPDATA`/`USERPROFILE`/`ComSpec`/`PATHEXT`; `PATH` e `Path` duplicados | alta | 1 |
| Login das IAs | `motor/main.ts:568` | Mesmo problema do `.cmd` | alta | 1 |
| Caminhos e permissões | `motor/conexao.ts:15,26,49-51`; `checkpoints.ts:88-98`; `mcp-config.ts:45-47` | `~/.config`; `0o600` ignorado | média | 1 |
| PATH do shell de login | `caminho.ts:188-215` | Sem `$SHELL`; vira no-op | média | 1 (pular no win32) |
| Line endings | (sem `.gitattributes`) | CRLF quebra shebang e snapshots de prompt | média | 1 |
| Trava do clone | `clone-da-maquina.ts:60` (`flock`) | Só roda em linux hoje (`laco.ts:453`) | alta | 1 (fica desligado no win32) |
| Guardar antes de apagar | `guardar-antes-de-apagar.ts:97-112,721,744` | `/proc/<pid>/cwd`, `lsof`, `tar` | alta | 1 (tar em Node; pula cwd) |
| Atualização do motor | `motor/atualizacao.ts:34,44`; `motor/atualizar-ias.ts:27,82,90` | `/etc/nod-motor`, `/opt/…/npm`, `boot_id` | alta | 2 (fica desligada; não quebra) |
| Instalador do motor | `motor-instalacao.ts` | Linux por desenho | bloqueante p/ "sem passos manuais" | 2 |
| Instalador SSH | `src/shared/instalador-ssh.ts:120-128,362,374` | `mkfifo`, `/dev/shm`, `ssh-agent -a` | alta | 2 |
| Computador do bot | `motor/computador.ts:15,19,56` | Xvfb/xdotool/bwrap/socket unix | bloqueante p/ o computador | 1: `sem_suporte`; real numa fase própria |
| Desktop | `desktop/ferramentas.ts:41-57,106`; `desktop/instalar-ia.ts:94-96`; `desktop/main.ts:818,1297-1368`; `desktop/contas-mac.ts:100`; `electron-builder.yml:68-74` | Tabela sem win32, wrapper `#!/bin/sh`, symlinks, deep link só no plist, NSIS nunca testado | bloqueante | 3 |
| npm scripts | `package.json` (`e2e:fumaca` com `VAR=`, `bash scripts/*.sh`) | cmd não aceita | média | só dev; fora |
| CI | `.github/workflows/ci.yml:37,52,64` | Nada roda no Windows | alta | 1 |

## 2. Decisão proposta: Windows nativo (PowerShell + Git for Windows), não WSL

**Proposta: motor nativo no Windows.** Os bots rodam com o Claude Code e o Codex nativos do Windows; o Nod exige o **Git for Windows** (o `git` já é necessário para clone/worktree e traz o `bash.exe`).

Por quê:
1. Os dois CLIs já rodam nativos: o Claude Code usa o Git Bash para o Bash e cai na ferramenta PowerShell sem ele ([docs](https://code.claude.com/docs/en/setup)); o Codex roda em PowerShell com sandbox nativo do Windows ([docs](https://developers.openai.com/codex/app/windows)).
2. O critério "editam arquivos no Windows" pede o disco do Windows. Pelo WSL, os arquivos ficam no ext4 da VM ou em `/mnt/c`, que é lento e confunde permissões.
3. "Instalar sem passos manuais": o WSL2 pede admin, virtualização ligada na BIOS e reinício. Não dá para prometer isso em qualquer Win 10/11.
4. O OpenMausBot chegou à mesma escolha: nativo + PowerShell, WSL só com aviso.

O WSL fica como **atalho já existente, sem código novo**: quem tem WSL2 com systemd pode usar hoje o instalador Linux dentro dele (é "uma máquina Linux", ADR-090). Fica documentado e não é testado na CI.

Shell dos comandos **internos do Nod** (esperas, hook): Git Bash quando achado (`%ProgramFiles%\Git\bin\bash.exe`, `git --exec-path`, `CLAUDE_CODE_GIT_BASH_PATH`); sem ele, `powershell.exe -NoProfile -NonInteractive`. O shell dos **bots** é o do CLI do fornecedor.

## 3. Arquitetura da Fase 1

Objetivo: **o mesmo motor (`motor/main.ts`) roda num Windows 10/11 x64 com Node 24, pareia por código, aparece como "Windows" na lista de máquinas, executa turnos do Claude e do Codex (comandos + edição de arquivos), e o Parar mata a árvore inteira.** Sem instalador, serviço, atualização, computador ou desktop.

```
              servidor (inalterado, só aceita win32)
                     ▲  long-poll HTTPS (ADR-021)
                     │
   nod-motor.mjs (Node 24, win32)
     ├─ plataforma.ts  ◄── NOVO: um lugar só para "como é aqui"
     │    pastas(): %APPDATA%\nod-motor, %LOCALAPPDATA%\nod-motor
     │    resolverBinario(nome): PATH × PATHEXT → .exe | .cmd→node+script | .ps1→powershell
     │    matarArvore(pid): win32 taskkill /T /F ; posix kill(-pgid)
     │    shellDoNod(): Git Bash | PowerShell | /bin/bash | /bin/sh
     │    processosVivos(): win32 Get-CimInstance Win32_Process ; posix ps
     ├─ processo.ts  → spawn via resolverBinario, windowsHide, detached só posix,
     │                 interromper() → matarArvore
     ├─ caminho.ts   → PATH: + %APPDATA%\npm, %LOCALAPPDATA%\Programs, sem $SHELL -l
     ├─ esperas.ts   → shellDoNod()
     ├─ grupos-orfaos.ts / fugitivos.ts → processosVivos() + matarArvore (pid + início)
     ├─ ambiente-executor.ts (domínio) → allowlist por plataforma, Path normalizado
     ├─ git-na-pasta-do-bot.ts / nativas.ts (domínio) → caminhos normalizados (\ → /, drive minúsculo)
     ├─ drivers claude/codex → comando do hook sem sintaxe POSIX no win32
     └─ computador → sem_suporte no win32 (já é o ramo "sem /opt/nod-motor/computador")
```

**Módulos**
- **Novo** `src/adapters/executor/plataforma.ts` (adapter, faz I/O) com as 5 funções acima. Cada função recebe `plataforma` injetável para teste em Linux. É o único arquivo com `process.platform === "win32"` espalhado; os outros chamam ele.
- **Domínio puro** `src/domain/caminhos.ts` (novo, pequeno): `normalizarCaminho(p, plataforma)` e `dentroDe(pai, filho, plataforma)`, usados pela cerca do git, pelo hook e por `nativas.ts`. Sem I/O, respeita `fence:domain`.
- Alterados: `processo.ts`, `caminho.ts`, `esperas.ts`, `fugitivos.ts`, `grupos-orfaos.ts`, `vaga.ts` (memória por `os.freemem()`/`os.totalmem()` fora do Linux), `guardar-antes-de-apagar.ts` (tar.gz em Node com `zlib`, sem `lsof`/`/proc` no win32), `registry.ts`, `ambiente-executor.ts`, `git-na-pasta-do-bot.ts`, `hook-nativas.ts`, `nativas.ts`, `drivers/claude-cli.ts`, `drivers/codex-comum.ts`, `motor/main.ts`, `motor/conexao.ts`, `src/contracts/maquina.ts`, `ponte.ts`, textos que dizem "Mac/Linux".
- **Sem dependência nova** (sem node-pty, sem addon de Job Object). `taskkill` e PowerShell vêm com o Windows.

**Dados / migrações**
- `0149_plataforma_windows.sql`: `SET LOCAL lock_timeout = '5s'; ALTER TABLE maquina_tokens DROP CONSTRAINT IF EXISTS maquina_tokens_plataforma; ALTER TABLE maquina_tokens ADD CONSTRAINT maquina_tokens_plataforma CHECK (plataforma IN ('darwin','linux','win32')) NOT VALID; ALTER TABLE maquina_tokens VALIDATE CONSTRAINT maquina_tokens_plataforma;` com o marcador `-- ROLLBACK:` exigido por `scripts/migracao-aditiva.ts:242-247` (`UPDATE … SET plataforma = NULL WHERE plataforma = 'win32'` e volta o CHECK antigo). Passa no `fence:migrations` (DROP CONSTRAINT é permitido; amplia, não apaga).

**APIs**
- `/api/maquina/sessao` e o anúncio aceitam `plataforma: "win32"` (zod em `src/contracts/maquina.ts`). O servidor sobe antes do motor (mesmo PR, deploy do servidor primeiro). Servidor antigo só recusa win32 no pareamento (`rotas/maquinas.ts:119-120`); o `conectar` grava "darwin" para plataforma desconhecida (`ponte.ts:259-261`) e a leitura do banco é cast sem zod (`maquina-tokens.repo.ts:68-72`). Por isso o motor win32 confere a versão do servidor antes de conectar e sai com "atualize o servidor", e `ponte.ts` passa a recusar plataforma desconhecida em vez de virar Mac.
- Domínio que decide por plataforma (`onde-roda`, `computador-canal.ts`, `memoria-mac.ts`, 13 usos de `=== "darwin"|"linux"`): win32 entra como "máquina sem computador e sem VM", com o texto "Windows".

**Ações** (registro único, ADR-135): **nenhuma ação nova**. A Fase 1 não cria botão, tela nem ferramenta; a máquina Windows usa as ações que já existem (parear, renomear, desconectar, escolher máquina do bot) e `npm run paridade` continua igual. (A skill `/acao-no-chat` não está instalada nesta máquina; a checagem foi feita à mão no registro `src/domain/acoes`.)

## 4. Bordas e erros
- **Shim `.cmd` com espaço no caminho ou script não-node** (`%APPDATA%\npm\claude.cmd`): o resolvedor lê o shim do npm e pega `node_modules\…\cli.js`; se não reconhecer, dá erro claro (sem fallback por `cmd.exe`, que expande `%VAR%`). Preferir `claude.exe` (instalador nativo) quando existir.
- **Linha de comando > 32.767 chars**: prompt sempre por stdin (já é assim no stream-json); o teste cobre argumento longo.
- **`taskkill` em pid já morto ou reaproveitado**: confere o horário de criação (`Win32_Process.CreationDate`) antes de matar, como o `inicioDesteProcesso` faz no Linux.
- **Sem Git for Windows**: o motor não sobe `rodar`; mostra "Instale o Git for Windows (winget install Git.Git)" e sai com código próprio. Sem Git Bash mas com git (raro): esperas via PowerShell.
- **Caminhos**: `C:\` vs `c:\`, `\\?\` longo, UNC `\\server\share` (negado na cerca: fora da pasta do bot), junções. Normalização só para comparar; o caminho real segue intacto para o SO.
- **Antivírus/Defender** segurando arquivo: `rm` da worktree com retry (`fs.rm` com `maxRetries`).
- **Permissão da chave**: em `%APPDATA%` o perfil já é só do usuário (+SYSTEM/Admins). Fase 1 aceita; endurecer com `icacls /inheritance:r` fica na Fase 2.
- **CRLF**: `.gitattributes` com `* text=auto eol=lf` e `*.ps1 text eol=crlf`; renormalização no mesmo commit.
- **Computador**: no win32 o anúncio diz `sem_suporte`; a tela da máquina já mostra "sem computador".

## 5. Testes
- **Unit (Linux e Windows)**, com `plataforma` injetada:
  - `tests/unit/executor/plataforma.test.ts`: tabela de `resolverBinario` (`.exe` ganha de `.cmd`; shim npm vira node+script; `.ps1` vira powershell; PATHEXT com caixa mista; caminho com espaço); `shellDoNod` (Git Bash > PowerShell; Linux bash > sh); `matarArvore` monta `taskkill /T /F /PID n` e não chama em pid com início diferente.
  - `tests/unit/domain/caminhos.test.ts`: `dentroDe` com `C:\a\b` × `c:/a/b/c`, `..`, UNC, prefixo falso (`C:\ab` não está em `C:\a`).
  - Estender os testes da cerca do git e do hook (`git-na-pasta-do-bot`, `nativas`) com linhas win32: hoje falham fechados, depois liberam só dentro da pasta.
  - `ambiente-executor`: win32 passa `SystemRoot`, `APPDATA`, `USERPROFILE`, `ComSpec`, `PATHEXT`; não duplica `PATH`/`Path`.
  - Contrato: `win32` aceito; `"freebsd"` recusado. Migração: integração insere `win32` e recusa `x`.
- **Windows de verdade (CI)**: job novo `windows` em `.github/workflows/ci.yml`, `runs-on: windows-latest`, Node 24.19.0:
  1. `npm ci`, `tsc -p tsconfig.motor.json`, `node scripts/motor/build.mjs`;
  2. `vitest run --project unit` nos testes do executor/domínio tocados (lista explícita no job, sem Postgres);
  3. **smoke do motor**: `node dist/motor/nod-motor.mjs versao`; teste `tests/windows/processo-windows.test.ts` que sobe `node -e` com um neto, chama `interromper()` e prova que os dois morreram; que resolve e roda um `.cmd` falso do npm; e que uma espera roda no Git Bash do runner.
  4. Roda em todo PR não-draft; começa como **obrigatório** (é o critério "CI com job de Windows").
- **Mutantes nos pontos críticos** (no QA): trocar `/T` por nada no taskkill (o teste do neto tem de pegar); tirar a normalização do drive (a cerca tem de falhar); tirar `windowsHide` (só manual, sem teste).
- **QA manual**: uma VM Windows 11 x64 (GCP `windows-2022`/Win11 ou máquina do Marlon): parear, um turno do Claude que cria arquivo e roda `git status`, um do Codex, Parar no meio de um `npm install`.

## 6. Riscos
1. **Matar árvore com `taskkill`** é por pid, não por Job: um neto que se desanexa (`start /b`, serviço) escapa. Aceito na Fase 1 (o OpenMausBot faz igual); Job Object com addon fica como gatilho se a sonda mostrar órfão.
2. **Sem sandbox de SO no Windows** (igual ao Mac de hoje): o bot tem o usuário da pessoa. A cerca e o hook continuam; Codex usa o sandbox dele. Documentado na ADR.
3. **Hook do Claude no Windows** roda via Git Bash; sem Git Bash, os hooks podem não rodar e a cerca some em silêncio. Por isso Git for Windows é **obrigatório** e o motor recusa subir sem ele.
4. **Rollback do servidor** com linhas `win32` gravadas: o código antigo lê como cast e trata como Mac (voz local, VM local). Mitigação: o CHECK novo e o contrato saem num commit que o servidor aplica antes; rollback começa pelo `UPDATE … NULL`.
5. **Escopo**: ~20 arquivos. Se a revisão achar grande, o corte natural é tirar `guardar-antes-de-apagar` e `vaga` (desligados no win32) para um PR seguinte.
6. **CI paga** (`windows-latest` é runner hospedado do GitHub, não o self-hosted): ~5–8 min por PR. Se pesar, o filtro de caminhos fica **dentro** do job (que reporta sucesso quando pula), nunca em `on.paths`, senão o check obrigatório trava o PR.

## 7. ADR
**ADR-147 — O motor roda no Windows nativo.** Emenda a ADR-090 ("máquina Linux" vira "máquina Linux ou Windows"), a ADR-083/089 (grupo de processo vira "árvore": `kill(-pgid)` no POSIX, `taskkill /T` no Windows) e registra: nativo em vez de WSL, Git for Windows obrigatório, sem sandbox de SO no Windows, computador `sem_suporte`. Gatilho de reversão: se mais da metade das quebras da Fase 1 vier de shell/hook no Windows, ou se a sonda mostrar órfão de processo frequente, reavaliar WSL2 como alvo único.

## 8. Critérios de aceite (refinados)
Fase 1 (este PR):
1. Num Windows 10 22H2 ou 11 x64 com Node 24 e Git for Windows, `node nod-motor.mjs parear` mostra o código, a web confirma e a máquina aparece como **Windows**.
2. Um turno do Claude Code e um do Codex nessa máquina **rodam comandos e criam/editam arquivos** na pasta do bot; o git dentro da pasta passa na cerca e fora dela é negado.
3. **Parar** no meio de um comando longo mata o CLI e os netos já vistos (lista de descendentes pid+início, guardada durante o turno) em até 7 s; o boot seguinte mata o que sobrou dessa lista e nada além dela.
4. Uma espera (`esperar_comando`) roda e devolve a saída no Windows.
5. Job `windows` na CI, obrigatório e verde, com o smoke de processo.
6. Linux e Mac sem regressão (`npm run check` verde).

Fases seguintes (não são deste PR; viram issues quando o Marlon liberar):
- Fase 2: instalador `irm …/motor.ps1 | iex` por usuário, sem admin, que instala Node portátil, Git for Windows (winget), as IAs e uma Tarefa Agendada no logon; atualização automática do motor.
- Fase 3: app desktop Windows (NSIS por usuário + electron-updater, deep link `nod://`, tabela de IAs win32). Assinatura depende do Marlon.
- Fase 4: computador do bot no Windows (cua-driver, ou Podman/WSL).

## 9. Passos como commits (1 PR: "ADA-11: o motor roda no Windows (Fase 1)")
1. `docs: ADR-147 motor no Windows nativo` + `.gitattributes` com renormalização.
2. `contrato e banco aceitam a plataforma win32` (zod, migração 0149, ponte, domínio de onde-roda/computador-canal, textos "Windows") + testes.
3. `domínio: caminhos normalizados para a cerca do git e o hook` (`src/domain/caminhos.ts`, git-na-pasta-do-bot, nativas) + testes.
4. `executor: plataforma.ts (binário, shell, árvore, processos, pastas)` + testes unit.
5. `executor: spawn, Parar e órfãos usam a plataforma` (processo, fugitivos, grupos-orfaos, caminho, esperas, registry, ambiente-executor) + testes.
6. `drivers: hook obrigatório no win32` (claude-cli sem nativas do terminal em --allowedTools, autoteste do hook, codex-comum, fila-do-forno com winpid; comando do hook via Git Bash com caminhos em `/`).
7. `motor: pastas do Windows, plataforma real, computador sem_suporte, exige Git for Windows` (motor/main, conexao, vaga, guardar-antes-de-apagar).
8. `ci: job windows-latest com smoke do motor` + `tests/windows/*`.

## 10. Revisão (/plan-eng-review, revisor independente; o Codex estava sem cota)
Dez achados, todos incorporados ao plano e aos passos:
1. **Alta. O hook falha aberto:** `claude-cli.ts:280,313` põe Bash/Write/Edit em `--allowedTools`, e o Codex já falha aberto (`codex-comum.ts:116`). → No win32, tirar as nativas do terminal de `--allowedTools` (só o allow do hook libera). Fazer um autoteste do hook no `rodar`, que recusa subir se falhar. O kit de terminal do Codex no Windows só liga depois de uma sonda provar que ele roda hooks. (passos 6 e 7)
2. **Alta. Normalizar só no `dentroDe` abre a cerca:** `git-na-pasta-do-bot.ts:24-41` só entende `/`, então `..\..` vira nome de pasta. → Normalizar dentro de `resolver`, antes do `..`. Tratar `X:\`, `X:/`, UNC e `/c/` (Git Bash) como absolutos. `foraDaFoto` (`hook-nativas.ts:85-87`) e `cercaDoCloneDaMaquina` passam a usar o mesmo `dentroDe`. Testes cobrem `..\` e `/c/…`. (passo 3)
3. **Alta. Nome do programa comparado ao pé da letra:** `git-na-pasta-do-bot.ts:255,259` não pega `git.exe`, `GIT` nem `"C:\…\git.exe"`, e o parser não entende PowerShell (`Set-Location`, `&`). → No win32, comparar pelo basename em minúsculas e sem `.exe`. Comando com git que o parser não entende é negado. (passo 3)
4. **Média. Busca na pasta atual no Windows:** `hook-nativas.ts:156` chama `execFileSync("git")` com a cwd na worktree, então um `git.exe` commitado rodaria. → `plataforma.ts` resolve caminhos absolutos no boot (`%SystemRoot%\System32\taskkill.exe`, git do PATH sem a cwd) e nunca chama pelo nome solto. (passo 4)
5. **Alta. `taskkill /T` não fecha a árvore:** com o pai morto ele não acha os filhos (`processo.ts:252-262`), e os fugitivos dependem de `NOD_GRUPO` no ambiente (`fugitivos.ts:14-24`), que `Win32_Process` não expõe. → Guardar os descendentes (pid + `CreationDate`) durante o turno e matar essa lista. A posse passa a ser pid + início. Usar `/F` direto. O critério de aceite 3 foi reescrito. (passo 5)
6. **Média. Fallback `cmd /c` e spawns fora da lista:** o `cmd` expande `%VAR%` e não carrega quebra de linha. Ficavam de fora `mcp-proxy/cliente-mcp.ts:112` (`npx.cmd`, `env:{}` sem SystemRoot), `motor/main.ts:95`, `vaga.ts:263` (sem windowsHide) e `nativas.ts:115-118` (nomes `CON`/`NUL`/`?*<>|`). → Sem fallback por cmd nos turnos (dá erro claro). Esses spawns passam pelo `resolverBinario` e pela allowlist, e o nome de pasta é higienizado. (passos 4, 5 e 7)
7. **Média. `fila-do-forno.ts:170` no Git Bash:** `$$` é o pid do MSYS. → Usar `$(cat /proc/$$/winpid)` e manter as aspas POSIX com `/` (o hook roda no Git Bash). O formato final sai de uma sonda. (passo 6)
8. **Média. Servidor antigo × motor win32:** o servidor antigo trata o Windows como Mac em silêncio. → O motor confere a versão, e `ponte.ts` recusa plataforma desconhecida. (passo 2)
9. **Média. Job de CI:**
   - criar um projeto vitest `windows` (hoje `tests/windows/*` não roda em nenhum projeto) e usar `npm run motor:build`;
   - pôr o filtro de caminhos dentro do job;
   - fazer um smoke do `hook-nativas.mjs` via `bash.exe` com um PreToolUse real e caminho `C:\`. (passo 8)
10. **Baixa. Migração:** faltavam `-- ROLLBACK:` e `lock_timeout`. → Incluídos, com `NOT VALID` + `VALIDATE`. (passo 2)

Escopo: ficou em ~25 arquivos num PR, como pede a regra. Se a revisão do código achar grande demais, o corte é `guardar-antes-de-apagar` e `vaga`, que no win32 ficam desligados e não quebram nada.

## 11. Pendências do Marlon (o plano segue com a suposição entre parênteses)
- **Nativo × WSL** (nativo, WSL só como atalho documentado).
- **Git for Windows obrigatório** (sim; o instalador da Fase 2 instala por winget).
- **Versões mínimas**: Windows 10 22H2 e 11, só x64 (ARM64 fora).
- **Assinatura do instalador e certificado** (fora deste plano; Fase 3).
- **Lista de issues das fases 2–4** (espera o Marlon).
- **Runner `windows-latest` hospedado e pago** (aceito, ~5–8 min por PR).
