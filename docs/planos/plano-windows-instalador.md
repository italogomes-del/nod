# ADA-32 · Instalador do motor no Windows (`irm https://nodbot.ai/windows | iex`) — Plano de engenharia

Base: `origin/main` 1049d725. Antecede: ADA-11 (PR #642, [ADR-147](../adr/adr-147-motor-no-windows-nativo.md),
[plano da Fase 1](plano-windows-fase1.md)). Decisão nova: [ADR-151](../adr/adr-151-instalador-do-motor-no-windows.md).
Validação em Windows real: ADA-31 (humana). Regra: 1 PR por issue ("ADA-32: Instalador do motor no Windows").

## 1. Diagnóstico

Hoje o motor roda no Windows 10 22H2/11 x64 só à mão: instalar Node 24 e Git for Windows, baixar os três arquivos
(`nod-motor.mjs`, `proxy.mjs`, `hook-nativas.mjs`), `node nod-motor.mjs parear <servidor>` e deixar um terminal aberto com
`rodar`. Nada volta depois de reiniciar. No Linux o mesmo trabalho é um comando (`curl -fsSL <nod>/motor | sh`), gerado
pelo servidor com o próprio endereço e a própria versão (`src/adapters/http/motor-instalacao.ts:62`, rota em
`src/adapters/http/rotas/motor.ts:20`, atalho `/motor` em `src/adapters/http/servidor.ts:66`).

O que já existe e o instalador reaproveita:
- **Rotas públicas do motor** (`rotas/motor.ts`): `/api/motor/arquivos/<nome>` e `/api/motor/manifesto` (sha256 de cada
  arquivo). Em produção: `https://app.nodbot.ai/api/motor/manifesto` → `1.0.0-rc.2` (conferido em 04/11).
- **Pastas do motor no win32** (`src/adapters/executor/plataforma.ts:43-51`): conexão e chave em `%APPDATA%\nod-motor`,
  executor em `%LOCALAPPDATA%\nod-motor`. O instalador não muda isso.
- **O motor confere o Git for Windows** (`motor/windows.ts`, saída 3) e o hook pelo Git Bash: o instalador só precisa
  garantir que o Git exista; a prova fina continua no `rodar`.
- **Pareamento** (`motor/main.ts:531`): imprime código e link `?parear-maquina=`; aceita `--convite` (ADR-102).
- **Job `windows` da CI** (`.github/workflows/ci.yml:156-198`): filtro de caminhos no runner próprio + `windows-latest`.
- **O site** (`site/_redirects`) já redireciona `/download/mac*` para o bucket, servido pelo Worker `nodbot-site`
  (ADR-118), com deploy manual por `wrangler deploy`.

## 2. Decisões (ADR-151)

1. **O script é do servidor, como no Linux.** `GET /api/motor/instalar-windows` devolve o PowerShell com o endereço e a
   versão do servidor embutidos; `GET /windows` (atalho, em `servidor.ts` ao lado do `/motor`) redireciona 302 para ele,
   levando só um `convite` válido. `nodbot.ai/windows` é uma linha no `site/_redirects`:
   `/windows https://app.nodbot.ai/windows 302`. "Versão estável" = a que o servidor oficial roda (o mesmo contrato do
   `/motor`): publicar versão nova do motor é fazer o deploy do servidor. Não há bucket nem release para o motor.
2. **Node portátil e fixo, não winget.** O issue pedia Node por winget; o `OpenJS.NodeJS` do winget é MSI de máquina
   (pede admin/UAC), instala a versão que quiser e mexe no Node da pessoa. O script baixa
   `node-v${NODE_DO_MOTOR}-win-x64.zip` do nodejs.org, confere o sha256 no `SHASUMS256.txt` e extrai em
   `%LOCALAPPDATA%\nod\node` (o mesmo `NODE_DO_MOTOR` = 24.19.0 do Linux). Sem admin, idempotente (só troca se a versão
   muda) e não encosta no Node que a pessoa já tenha.
3. **Git for Windows por winget, por usuário.** `winget install --id Git.Git -e --scope user --silent
   --accept-package-agreements --accept-source-agreements`; se o escopo de usuário falhar, tenta sem escopo (o
   Windows pede o UAC uma vez, avisado antes). Sem winget (Windows 10 sem o App Installer atualizado, LTSC): baixa o
   instalador oficial da última release de `git-for-windows/git`, confere a assinatura Authenticode (`Valid` e o
   assinante do projeto) e roda `/VERYSILENT /NORESTART /CURRENTUSER`. Depois relê o `Path` do registro (Máquina +
   Usuário) na sessão.
4. **As IAs por npm, com o Node do nod.** `npm install -g --prefix "%APPDATA%\npm"` de
   `@anthropic-ai/claude-code@>=PISO_CLI` e `@openai/codex@>=PISO_CLI` (o piso de `flag-floors.ts`, como no Linux), só
   quando o binário não existe ou está abaixo do piso. O Codex não derruba a instalação (aviso); `NOD_SEM_CODEX=1`
   desliga. Se no fim não houver nem Claude Code nem Codex, erro claro com o comando para instalar à mão.
5. **O motor em `%LOCALAPPDATA%\nod\motor`.** Baixa os três arquivos e o manifesto, confere o sha256 de cada um, grava
   em `app.novo` e troca (`app` → `app.anterior`, `app.novo` → `app`; se a segunda troca falhar, volta a anterior).
6. **Comando `nod` (e `nod-motor`).** `%LOCALAPPDATA%\nod\bin\nod.cmd` e `nod-motor.cmd`, que chamam o Node e o motor
   por caminho absoluto. `.cmd` e não `.ps1`: roda com qualquer ExecutionPolicy. A pasta entra no `Path` do usuário
   (HKCU, sem duplicar) e na sessão atual.
7. **Inicia com o login por Tarefa Agendada do usuário, sem admin.** Tarefa `\nod\nod-motor`, gatilho AtLogOn do
   próprio usuário, `LogonType Interactive`, `RunLevel Limited`, sem limite de duração, reinício em falha (1 min,
   999 vezes), `MultipleInstances IgnoreNew`, liga na bateria. A ação roda `conhost.exe --headless` + node + motor
   `rodar` (sem janela). Se o Windows recusar a tarefa (política), cai para a chave
   `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` (sem reinício em falha; avisado).
8. **Rodar de novo = atualizar.** Para a tarefa e espera o `node.exe` do nosso `app` sair (até 30 s; depois
   `taskkill /F` só nesses pids), troca o que mudou, registra a tarefa de novo (`-Force`) e sobe. A conexão em
   `%APPDATA%\nod-motor\conexao.json` nunca é tocada: com ela, o script pula o pareamento. A atualização automática do
   motor segue desligada no win32 (ADR-147 item 6); quando o servidor pede motor mais novo, o motor manda rodar o
   `irm …/windows | iex` (hoje manda o `curl … | sh`, `motor/main.ts:449`).
9. **Pareamento abre o navegador.** `parear` ganha `--abrir`: no win32 abre o link `?parear-maquina=` com
   `%SystemRoot%\explorer.exe` por caminho absoluto (ADR-147 item 3). O código continua impresso. Com convite, pareia
   sem digitar nada.

## 3. Arquitetura

```
 PowerShell da pessoa
   irm https://nodbot.ai/windows | iex
          │ 302 (site/_redirects, Worker nodbot-site)
          ▼
 https://app.nodbot.ai/windows ──302──► /api/motor/instalar-windows[?convite=…]
          │  scriptDeInstalacaoWindows({ servidor, versao, convite })   (motor-instalacao-windows.ts, NOVO)
          ▼
 & { … } (tudo num bloco: corte no meio = erro de parse, nada roda pela metade; nunca `exit`)
   1 conferencia  Win 10 ≥19045 / 11, x64 (ARM64 recusa), FullLanguage, TLS 1.2
   2 git          git no Path? ── não ─► winget --scope user ─► winget ─► instalador assinado /CURRENTUSER
   3 node         %LOCALAPPDATA%\nod\node\node.exe == v24.19.0? ── não ─► zip + SHASUMS256 ─► troca
   4 ias          claude/codex ≥ piso? ── não ─► npm -g --prefix %APPDATA%\npm
   5 parar        tarefa nod-motor rodando? ─► Stop + espera node.exe do app (30 s) ─► taskkill /F nesses pids
   6 motor        manifesto + 3 arquivos ─► sha256 ─► app.novo ─► app (app.anterior)
   7 comando      bin\nod.cmd, bin\nod-motor.cmd ─► Path do usuário
   8 tarefa       Register-ScheduledTask \nod\nod-motor (AtLogOn) ── falhou ─► HKCU\…\Run
      ── NOD_INSTALAR_ATE=pareamento para aqui (CI) ──
   9 pareamento   %APPDATA%\nod-motor\conexao.json existe? ── sim ─► pula
                                                            └ não ─► nod parear <servidor> [--convite C] --abrir
  10 pronta       Start-ScheduledTask ─► nod estado
```

**Módulos**
- **Novo** `src/adapters/http/motor-instalacao-windows.ts`: `scriptDeInstalacaoWindows(o)` (puro: texto in, texto out),
  com as mesmas guardas de `scriptDeInstalacao` (`servidor` só `https://host` ou http em loopback, `versao` só
  `[0-9A-Za-z.+-]`, convite só no formato `CONVITE`). Reusa `NODE_DO_MOTOR`, `ARQUIVOS_DO_MOTOR`, `PISO_CLI`. Todo
  valor embutido vai entre aspas simples do PowerShell (sem expansão); os validados não têm `'`.
- `rotas/motor.ts`: rota `GET /motor/instalar-windows` (pública, `text/plain; charset=utf-8`, `no-store`), mesma
  resolução de `servidor` da rota Linux.
- `servidor.ts`: atalho `/windows` → 302 `/api/motor/instalar-windows`, junto do `/motor`, passando só convite válido.
- `motor/conexao.ts` (`lerComando`): flag `--abrir` no `parear`. `motor/main.ts` + `motor/windows.ts`: abrir o link no
  win32; mensagens "rode de novo" com o comando do Windows quando `NO_WINDOWS` (linhas 449, 469, 513, 641).
- `site/_redirects`: `/windows https://app.nodbot.ai/windows 302`.
- `scripts/windows/`: `gerar-instalador.ts` (escreve o script num arquivo para o PSScriptAnalyzer),
  `servidor-de-teste.mjs` (serve o script, o manifesto e `dist/motor` em `http://127.0.0.1:<porta>`, com a função real),
  `conferir-instalacao.ps1` (as asserções do job).
- `.github/workflows/ci.yml`: passos do instalador no job `windows`; o filtro ganha
  `src/adapters/http/motor-instalacao(-windows)?\.ts`, `src/adapters/http/rotas/motor\.ts`, `scripts/windows/`.
- Docs: `docs/release-desktop.md` (seção "Windows: o instalador do motor"), ADR-151, nota na ADR-147 (a limitação "sem
  instalador" sai), este plano.

**Dados / migrações:** nenhuma. **Dependências novas:** nenhuma no repo (o PSScriptAnalyzer já vem no
`windows-latest`; se não vier, `Install-Module -Scope CurrentUser` no job).

**APIs**
- `GET /windows` → 302 `/api/motor/instalar-windows[?convite=<32 base64url>]`, `cache-control: no-store`.
- `GET /api/motor/instalar-windows` → 200 `text/plain; charset=utf-8`, o script; 400 `entrada_invalida` sem HTTPS.
- `nodbot.ai/windows` → 302 `https://app.nodbot.ai/windows` (o `irm` segue até 5 redirecionamentos).
- Variáveis que o script lê (todas opcionais): `NOD_SEM_CODEX=1`, `NOD_INSTALAR_ATE=pareamento` (para antes de parear;
  CI e suporte), `NOD_PASTA` (troca `%LOCALAPPDATA%\nod`; só para teste).

**Ações** (registro único, ADR-135): **nenhuma ação nova**. Não há botão, tela nem ferramenta: o instalador é um
script servido por rota pública, e a máquina Windows usa as ações que já existem (parear, renomear, desconectar).
`npm run paridade` continua igual. (A skill `/acao-no-chat` não está instalada nesta máquina; conferido à mão no
registro `src/domain/acoes`.) O comando do Windows na tela "Conectar máquina" é follow-up (ver §8).

## 4. Bordas e erros

Toda falha conhecida sai com `✗ <frase pt-BR>` e o que fazer, por `throw` dentro do bloco (nunca `exit`, que fecharia a
janela de quem colou o comando). As etapas imprimem `✓ <passo>`.

| Borda | Comportamento |
|---|---|
| Windows < 10 22H2 (build < 19045), Server | Recusa: "O nod precisa do Windows 10 22H2 ou 11." (Server passa com aviso: é o runner da CI) |
| ARM64 (`PROCESSOR_ARCHITECTURE`/`PROCESSOR_ARCHITEW6432`) ou 32 bits | Recusa: "Por enquanto o nod roda só em Windows x64." (ADR-147) |
| PowerShell em ConstrainedLanguage (AppLocker/WDAC) | Recusa com o motivo; nada é instalado |
| ExecutionPolicy Restricted/AllSigned | Não afeta `irm \| iex` nem o `.cmd`; nenhum `.ps1` é gravado para rodar |
| TLS antigo no PowerShell 5.1 | `SecurityProtocol` += Tls12 antes do primeiro download |
| Proxy corporativo | `Invoke-WebRequest` usa o proxy do sistema com as credenciais padrão; o npm recebe `HTTPS_PROXY` se a pessoa o tiver; erro de rede diz "confira a internet ou o proxy" |
| Sem winget | Instalador oficial do Git com assinatura conferida; assinatura inválida = recusa |
| winget pede UAC e a pessoa nega | "O Git for Windows não instalou. Instale com: winget install --id Git.Git -e" |
| `git` instalado mas fora do `Path` da sessão | Relê `Path` de Máquina + Usuário; procura também `%ProgramFiles%\Git\cmd` e `%LOCALAPPDATA%\Programs\Git\cmd` |
| Node da pessoa (outra versão) | Ignorado: o motor usa o portátil por caminho absoluto |
| Download cortado ou sha256 diferente | Nada é trocado (tudo em `.novo`); recusa com "rode de novo" |
| npm do Claude Code falha | Se já havia `claude` ≥ piso, segue com aviso; se não houver nenhuma IA, recusa |
| Reinstalação com pareamento | `conexao.json` intocado; pula o pareamento; tarefa registrada de novo e iniciada |
| Reinstalação com o motor rodando turno | Para a tarefa (o turno cai e o servidor reentrega, como no `systemctl restart` do Linux); aviso antes |
| `node.exe` travado segurando a pasta | Espera 30 s, `taskkill /F` só nos pids cujo `CommandLine` aponta para o nosso `app` |
| Antivírus segurando arquivo na troca | 3 tentativas com 2 s; senão volta o `app.anterior` |
| Tarefa Agendada recusada | Cai para a chave `Run` do usuário, com aviso de que não há reinício em falha |
| Pareamento expirou / pessoa fechou | "O pareamento não terminou. Rode de novo: nod parear <servidor>"; tarefa fica registrada e o motor sai 2 até parear |
| Pasta do perfil com espaço ou acento | Todo caminho entre aspas; `nod.cmd` usa `%~dp0` |
| Chave revogada no servidor | Fora do script: o motor já diz "rode nod parear" |

## 5. Testes

**Unit (Linux, no `npm run test:unit`)**
- `tests/unit/adapters/motor-instalacao-windows.test.ts` (novo):
  - embute servidor, versão, `NODE_DO_MOTOR`, os três `ARQUIVOS_DO_MOTOR` e os dois pisos de `PISO_CLI`;
  - recusa `servidor` http fora de loopback, com `'`, `;`, espaço ou caminho, e `versao` com `'`/`$`;
  - convite válido entra (e vai ao `parear --convite`), convite inválido vira vazio;
  - nenhum `exit` no texto (regex de palavra) e tudo dentro de `& {` … `}` na última linha;
  - todo valor interpolado está entre aspas simples (nenhum `"${…}"` com dado do servidor);
  - `NOD_INSTALAR_ATE` para antes do bloco do pareamento (ordem das etapas no texto).
- `tests/unit/adapters/rotas-motor.test.ts` (existente, estender): `/motor/instalar-windows` 200 com `text/plain` e
  `no-store`, 400 sem HTTPS, `urlPublica` vence o host.
- Teste do servidor que já cobre o atalho `/motor` (`tests/concurrency/pareamento-dispositivo-http.test.ts`): `/windows`
  e `/windows?convite=<válido>&x=1` → 302 só com o convite; `/windows?convite=<inválido>` → sem query.
- `tests/unit/site/site-estatico.test.ts`: `/windows` tem 302 para `https://app.nodbot.ai/windows`.
- `motor/conexao` (`lerComando`): `parear https://x --abrir` liga o flag; `--abrir` não vira o servidor.
- Mensagens do motor no win32 citam `irm …/windows | iex` e `nod parear` (função pura em `motor/windows.ts`).

**Windows de verdade (CI, job `windows`, `windows-latest`)**, depois do `motor:build`:
1. `node scripts/windows/gerar-instalador.ts > instalador.ps1`; `Invoke-ScriptAnalyzer -Severity Warning,Error`: zero
   achados (supressões só com justificativa no script: `PSAvoidUsingWriteHost`, `PSAvoidUsingInvokeExpression` não se
   aplica ao script em si).
2. `servidor-de-teste.mjs` em segundo plano; `$env:NOD_INSTALAR_ATE='pareamento'; $env:NOD_SEM_CODEX='1';
   irm http://127.0.0.1:<p>/windows | iex` (o 302 e o `irm` de verdade).
3. `conferir-instalacao.ps1`: `nod versao` == `package.json`; `node.exe --version` == `v24.19.0`; `Path` do usuário com a
   pasta `bin` uma vez só; tarefa `\nod\nod-motor` com gatilho de logon e ação no nosso `app`; `claude --version`
   responde.
4. Roda de novo (idempotência): mesmas asserções, `bin` ainda uma vez no `Path`, `app.anterior` existe, nada baixado
   de novo do Node (marca de tempo do `node.exe` igual).
5. Pareamento existente: grava um `conexao.json` falso, roda de novo sem `NOD_INSTALAR_ATE`: o script não chama o
   `parear`, não toca o arquivo (hash igual) e inicia a tarefa.
6. Limpeza: `Unregister-ScheduledTask`.

**Mutantes (no QA):** tirar a conferência do sha256 do motor (o teste com arquivo adulterado no servidor de teste tem
de falhar); trocar `-Force` do registro da tarefa (a 2ª execução tem de falhar); tirar a guarda do `conexao.json` (o
passo 5 tem de falhar).

**Só no Windows real (ADA-31):** Windows 11 limpo do zero até pareado (critério 1), reiniciar e ver o motor voltar
(critério 3), winget pedindo UAC, máquina sem winget, proxy.

## 6. Riscos

1. **`conhost.exe --headless`** não é documentado como contrato estável. Se a ADA-31 mostrar janela ou falha, a troca é
   um `.vbs` com `WScript.Shell.Run …, 0` (VBScript sai do Windows em ~2027) ou `powershell -WindowStyle Hidden`.
   Isolado numa função do script.
2. **Tarefa Agendada sem admin**: registrar AtLogOn para o próprio usuário funciona sem elevação no Windows 10/11
   padrão, mas política de domínio pode negar. Mitigação: fallback para a chave `Run`.
3. **winget ausente no Windows 10 recém-instalado** (App Installer desatualizado): coberto pelo instalador assinado.
4. **Defender/SmartScreen** pode marcar `irm | iex`. O script não baixa `.exe` nosso (só Node, Git e npm oficiais);
   o AMSI vê o script em texto. Sem assinatura de código (fora do escopo).
5. **Encoding**: o PowerShell 5.1 decodifica pelo `charset=utf-8` do cabeçalho; sem ele, os acentos das mensagens
   saem quebrados (não a lógica). O teste da rota fixa o cabeçalho.
6. **Deploy do site é manual** (`wrangler deploy`, conta Cloudflare da pessoa): até lá, `irm https://app.nodbot.ai/windows
   | iex` já funciona; `nodbot.ai/windows` depende de uma pessoa (label `precisa-humano`).
7. **CI paga**: o job `windows` ganha ~3–5 min (Claude Code pelo npm). Roda só pelo filtro de caminhos.

## 7. ADR

**ADR-151 — O instalador do motor no Windows.** Emenda a ADR-147 (a limitação "sem instalador, serviço, atualização"
vira "sem atualização automática"). Registra: script gerado pelo servidor (como a ADR-090), Node portátil fixo em vez de
winget, Git por winget no escopo do usuário com fallback assinado, Tarefa Agendada do usuário com fallback na chave Run,
rodar de novo = atualizar, `nod.cmd` em vez de `.ps1`. Gatilho de reversão: se a ADA-31 ou o suporte mostrarem a tarefa
recusada ou janela aberta em mais de 1 de cada 5 máquinas, trocar por app desktop com login item (Fase 3).

## 8. Fora do escopo (follow-ups)

- Tela "Conectar máquina" mostrar o comando do Windows com convite (web; issue nova).
- Atualização automática do motor no win32 (Fase 2 da ADR-147).
- `.exe`/MSI assinado, app desktop Windows, computador do bot no Windows.
- ARM64.

## 9. Critérios de aceite (refinados)

1. Windows 11 x64 limpo: `irm https://nodbot.ai/windows | iex` instala Git, Node, Claude Code, Codex e o motor, abre o
   pareamento no navegador e, depois de confirmar na tela, o motor fica conectado e rodando (ADA-31).
2. Rodar de novo atualiza o que mudou, não pede pareamento e o motor volta conectado (CI passo 5 + ADA-31).
3. Reiniciar o PC e logar: o motor volta sozinho (ADA-31).
4. Job `windows` da CI roda PSScriptAnalyzer sem achados e o script até antes do pareamento, duas vezes.
5. `docs/release-desktop.md` explica como publicar versão nova do motor do Windows e o redirect do site.

## 10. Passos como commits (1 PR)

1. `docs: plano e ADR-151 do instalador do motor no Windows` (este arquivo, ADR-151, nota na ADR-147).
2. `servidor: script de instalação do Windows e rotas /windows e /api/motor/instalar-windows` + testes unit/rota.
3. `motor: parear --abrir e mensagens do Windows` + testes.
4. `site: nodbot.ai/windows redireciona para o servidor oficial` + teste do site.
5. `ci: o instalador do Windows no job windows (PSScriptAnalyzer + execução até o pareamento, duas vezes)` +
   `scripts/windows/*`.
6. `docs: publicar o motor do Windows em release-desktop.md`.

### Desvios na implementação (registrados no PR)

- **Parar o motor vem antes do Node e das IAs** (ordem: conferência → Git → parar → Node → Path → IAs → motor →
  comandos → tarefa → pareamento). O Windows trava o `node.exe` e o `claude` em uso: trocar o Node com o motor
  rodando falharia.
- **A tarefa fica na raiz (`\nod-motor`)**, não em `\nod\nod-motor`: criar uma subpasta no Agendador pode exigir admin
  em máquina gerenciada.
- **Sem `--disable-interactivity` no winget**: o parâmetro não existe nas versões do App Installer do Windows 10.
- **O servidor do script do Windows só aceita HTTPS** (HTTP só em loopback, para a CI); o do Linux segue como era.
- **`--abrir` só abre sem convite**: com o convite, a tela já vê a máquina chegar.

## 11. Revisão (/plan-eng-review e /plan-devex-review, decididas sem perguntas)

**Escopo (passo 0).** ~16 arquivos e 1 módulo novo passam do gate de complexidade. Mantido: cada parte é exigida por um
critério (rota/site = comando único; CI = critério 4; doc = critério 5; `--abrir` e mensagens = "abre link ou código" e
"rodar de novo atualiza"). Cortados para follow-up: tela "Conectar máquina" com o comando do Windows e a autoatualização.

**Arquitetura**
- A1 (alto) — Script estático no site vs. gerado pelo servidor → **gerado pelo servidor**: um contrato só com o Linux
  (ADR-090), sem deploy do site a cada versão, convite e endereço embutidos.
- A2 (médio) — `iex` executa o que chegou até o corte da conexão → **tudo num `& { … }` invocado na última linha**:
  texto cortado não fecha a chave e o PowerShell recusa o parse inteiro.
- A3 (médio) — `exit` dentro do `iex` fecha a janela de quem colou → **proibido** (teste unit procura a palavra).
- A4 (médio) — matar `node.exe` por nome derrubaria o Node da pessoa → **só pids cujo `CommandLine` aponta para o nosso
  `app`** (CIM `Win32_Process`).

**Qualidade do código**
- Q1 — interpolação de dado do servidor no PowerShell → só entre aspas simples, com os validadores do script do Linux
  reaproveitados (mesmo regex de servidor, versão e convite). Teste unit cobre `'`, `;`, `$`.
- Q2 — constantes duplicadas → o gerador importa `NODE_DO_MOTOR`, `ARQUIVOS_DO_MOTOR` e `PISO_CLI`; nada é copiado.

**Testes** — diagrama de cobertura em §5. Lacunas aceitas e registradas: Win11 limpo, reinício, UAC, sem winget e proxy
só na ADA-31. Mutantes do sha256, do `-Force` e da guarda do `conexao.json` ficam para o QA.

**Desempenho** — o instalador baixa ~30 MB do Node e ~60 MB do Claude Code uma vez; a segunda execução só compara versão
e sha256 (sem download do Node, sem npm se a IA está no piso). Job da CI +3–5 min, só pelo filtro de caminhos.

**Segunda opinião** — não rodada nesta etapa (plano sem código ainda; a ADA-32 não toca credencial do servidor nem IAM).
O `/codex` entra na revisão do PR por mexer com execução remota de script e Tarefa Agendada.

**DX (/plan-devex-review)** — persona: quem tem só um PC com Windows e cola um comando do site.
- D1 — Tempo até o primeiro "pronto": alvo ≤ 5 min num Win11 com banda boa; cada etapa imprime `✓`/`✗` em pt-BR.
- D2 — Erro sempre com o próximo passo (tabela §4); nada de pilha do PowerShell na tela (o `catch` mostra só a frase e
  grava o detalhe em `%LOCALAPPDATA%\nod\instalador.log`).
- D3 — Mesmo comando instala, atualiza e conserta; `nod estado` no fim mostra servidor e máquina.
- D4 — Quem não tem winget nem admin não fica preso: Git pelo instalador por usuário.
- D5 — Mensagens do motor no Windows citam `nod …` e o `irm`, nunca `curl | sh`.

## GSTACK REVIEW REPORT

| Revisão | Rodadas | Achados | Decididos | Abertos |
|---|---|---|---|---|
| plan-eng-review | 1 | 6 (A1–A4, Q1–Q2) | 6 | 0 |
| plan-devex-review | 1 | 5 (D1–D5) | 5 | 0 |

Suposições registradas: Node portátil em vez de winget (desvio do issue, ADR-151 item 2); "versão estável" = a do
servidor oficial; `nodbot.ai/windows` depende do deploy manual do site (label `precisa-humano`).

NO UNRESOLVED DECISIONS
