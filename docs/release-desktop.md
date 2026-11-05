# nod — guia de instalação e distribuição

A distribuição usa um servidor compartilhado e dois aplicativos macOS: `arm64` para chips M e `x64` para Intel. O Mac precisa do Claude Code ou do Codex instalado e autenticado (ADR-036). Não precisa de Node, Docker ou Postgres. O servidor guarda as conversas, permissões, decisões e rotinas; cada app puxa os trabalhos da pessoa que emitiu sua chave.

## Histórico (0.2.0-rc.1): Preview sem assinatura — 17/09/2026

Implementados: app Electron, configuração do endereço, chave cifrada com `safeStorage` (Keychain no macOS), sessão web obtida pela chave, ponte HTTP autenticada, executor local reutilizado, builds separados e workflow de assinatura/notarização. Nenhuma URL de produção foi escolhida. Nenhum certificado Developer ID válido foi encontrado na máquina de desenvolvimento. O mantenedor autorizou publicar esta candidata como preview sem assinatura, repetindo a distribuição anterior. Não há assinatura Developer ID nem notarização Apple. O macOS pode bloquear a abertura; esta publicação não representa aceite de instalação sob Gatekeeper nem validação de uso em produção. A distribuição assinada fica para uma versão estável.

## Histórico (0.2.0-rc.1): Mudanças e validação desta candidata

Integra o desktop à main atual, incluindo gestão e exclusão recuperável de agentes (migrações 0011 e 0012), decisões diretamente no chat, cooperação iniciada por agentes acordados por rotinas e Sonnet como modelo padrão. As sondas usavam Haiku; desde a NOD-164 usam o Sonnet 4.6. Candidatas `-rc.N` são reconhecidas pela verificação de compatibilidade do app.

Servidor compatível: código da tag `desktop-v0.2.0-rc.1`, protocolo de máquina 1, migrações 0001–0012. A URL HTTPS de produção ainda não foi informada. Não use o snapshot da preview anterior como servidor desta candidata. Permanece a versão mínima de cliente 0.1.0; não houve aumento forçado dessa versão mínima.

Medido em 2026-09-17, nesta candidata: `npm ci`, `npm run check` (684 testes: 371 unitários, 217 integração, 49 conformidade, 47 concorrência), `npm run build` e `npm run desktop:build` passaram. O banco exclusivo `nod_release_20260917` partiu vazio e recebeu as migrações 0001–0012. `desktop:pack` gerou um pacote local Intel e o proxy MCP respondeu ao initialize usando seu runtime, sem Node externo nem Claude real. A preview usa empacotamento local sem assinatura. A inspeção e o smoke do pacote não substituem o aceite de instalação em um Mac de cada arquitetura. Assinatura/notarização, aceite nativo Intel/ARM e atualização a partir da preview estão pendentes. Não se reutilizam as contagens nem os instaladores da versão anterior como evidência desta versão. A criação autônoma de tarefas ClickUp por um agente destinatário não está aprovada nos UATs.

## Preparar o servidor

1. Disponibilize Postgres com os roles e todas as migrações 0001–0012 desta versão. Migre como `nod_dono`; execute a aplicação como `nod_app`.
2. Decida quem entra. O seed cadastra o dono (`NOD_SEED_EMAIL`). Para o time, liste o domínio Google Workspace da
   organização em `NOD_ADMISSAO_DOMINIOS`: a primeira entrada de uma conta desse domínio cria a pessoa (emenda de
   2026-10-05 da ADR-030). Sem essa variável, o login Google não cria pessoas e só entra quem o seed cadastrou.
3. Configure um domínio HTTPS e o cliente OAuth Google, com callback `https://SEU-DOMINIO/api/sessao/google/callback`.
4. Gere segredos próprios para sessão e cifra, conforme `.env.example`. Configure `DATABASE_URL`, `DATABASE_URL_DONO`, `NOD_LOGIN=google`, `NOD_GOOGLE_CLIENT_ID`, `NOD_GOOGLE_CLIENT_SECRET`, `NOD_GOOGLE_REDIRECT_URI`, `NOD_SESSAO_SEGREDO` e `NOD_CREDENTIAL_KEY`.
5. Use `NOD_MODO=compartilhado`. Na imagem Docker este é o padrão; o Dockerfile já compila e serve a web. Fora de Docker: `npm run build`, `NOD_STATIC_DIR=dist/web`. Defina `NOD_HOST=0.0.0.0` dentro do container e encaminhe 8888 pelo proxy HTTPS.
6. O proxy precisa aceitar SSE sem buffering e requisições de pelo menos 35 segundos. Use uma instância do servidor nesta versão: tokens de turno, conexões de máquinas e barramento são mantidos em memória. Não escale réplicas sem implementar coordenação correspondente.

No modo compartilhado não há sonda nem execução Claude no servidor. `NOD_EXECUTOR` não habilita um executor local nesse modo. Os conectores MCP continuam no servidor, como antes; ferramentas locais do Mac não são expostas por esta release.

## Requisitos do Mac

macOS 12+ para o app e o Codex; o Claude Code exige macOS 13+.

Electron 43.7.1, macOS 12 Monterey ou posterior, Intel x64 ou Apple Silicon ARM64. O suporte a Monterey foi removido somente no Electron 44 ([nota oficial](https://www.electronjs.org/blog/electron-44-0)); o app mantém o Electron 43. O requisito do runtime não substitui o aceite do Nod nas duas arquiteturas.

**Versões mínimas das IAs (NOD-171, 2026-10-06).** Claude Code 2.1.290 e Codex 0.159.0 (`PISO_CLI`). Abaixo disso o app
mostra a IA como **desatualizada**, com a versão instalada, a mínima e o comando de atualizar, e o bot fixado nela recebe
a negação na conversa em vez de turnos com erro. **Ordem do deploy:** servidor antes do app. O servidor anterior não
conhece a causa `cli_antigo` no anúncio da máquina (`ponte-validacao.ts` a descarta) e mostraria a IA desatualizada como
"não encontrada", pedindo para instalar.

## Primeira abertura no Mac

1. Entre na sua conta do Claude Code (`claude`) ou do Codex neste Mac.
2. Baixe o DMG correspondente ao processador, abra e arraste **nod** para **Aplicativos**. Sem
   assinatura Apple, a primeira abertura é bloqueada: em **Ajustes do Sistema → Privacidade e
   Segurança**, clique em **Abrir mesmo assim**.
3. No app, clique em **Entrar com Google**. O navegador abre: entre e clique em **Conectar este Mac**
   (ADR-069). O app volta sozinho, encontra a conta do Claude Code ou do Codex sem gastar turno e abre o nod.

O endereço do servidor vem no build (`NOD_SERVIDOR_PADRAO`). Para outro servidor, ou se o navegador
não conseguir voltar ao app, use **Outro servidor ou chave manual**: gere uma chave em **Chaves**, no
navegador, e cole no app.

O endereço e a chave ficam cifrados em `Application Support/nod/conexao.enc`. A chave de cifra é protegida pelo Keychain; nada disso entra no pacote. Para reconfigurar ou verificar o Claude depois de instalar/autenticar, use **nod → Conexão / verificar Claude**. Reiniciar o app reconecta com a configuração salva e verifica o Claude novamente. Uma chave por computador; revogue em **Chaves** quando necessário.

Fechar o app encerra sua execução. Quando o computador some sem desconectar, o lease encerra o turno órfão, sem reenfileirar automaticamente. As decisões e consultas continuam pela web.

## UAT do idioma (NOD-174)

O menu nativo, o menu de contexto e os diálogos do Chromium só aparecem no `.app` empacotado; o vitest cobre o template
(`tests/unit/desktop/menu.test.ts`), não o que o macOS desenha. Rode no `.app` assinado, uma vez com o macOS em
pt-BR e outra com o macOS em inglês, e anexe as fotos a esta seção:

1. **Menu nod:** Conexão / verificar conta de IA, Avisos no Mac e **Sair do nod** (Cmd+Q sai).
2. **Editar:** Desfazer, Refazer, Recortar, Copiar, Colar, Selecionar tudo. Copie e cole um texto no composer: o
   rótulo explícito não pode desligar o item nativo (risco do plano, Electron 43.7.1).
3. **Visualizar:** Recarregar, Tamanho real, Aumentar, Diminuir, Tela cheia. **Ferramentas de desenvolvedor** não
   aparece no app empacotado.
4. **Menu de contexto** (botão direito num campo de texto) e **balão de validação** da tela de conexão (campo
   obrigatório vazio) em pt-BR mesmo com o macOS em inglês (`lang=pt-BR` antes do `ready`).
5. **Pedido de microfone** (`Info.plist`) e **diálogo de fechar em ligação** em pt-BR.
6. **Turno com a conta de IA deslogada:** a conversa mostra o aviso em pt-BR com a ação, e nenhum balão em inglês.

## Atualizar a partir da preview

**No Mac.** Do app com a atualização automática em diante (NOD-132, seção abaixo), o nod se atualiza sozinho. Vindo de uma versão anterior, baixe o DMG novo, abra e arraste **nod** para **Aplicativos**,
escolhendo **Substituir**. Na primeira abertura, o macOS pode pedir a senha do Mac uma vez para o app novo usar o
Keychain: digite a senha e clique em **Sempre permitir**. Com **Permitir**, o macOS pergunta de novo a cada abertura;
isso não é falha do app, basta repetir com **Sempre permitir**. Depois disso, um destes dois desfechos é o esperado:

- **(a) Reconecta sozinho.** O app abre o nod com a mesma chave; **Chaves**, no navegador, não ganha chave nova.
- **(b) Volta à tela de conexão.** O app assinado não conseguiu ler a conexão guardada pela preview. Clique em
  **Entrar com Google** e conecte de novo; depois, em **Chaves**, revogue a chave antiga deste Mac.

Travar, abrir tela branca ou ficar alternando entre a tela de conexão e o nod não é esperado: preserve o diagnóstico
(**nod › Exportar diagnóstico…**) e avise o time. Ao abrir uma ligação, o macOS pode perguntar de novo pelo microfone
(NOD-165). A 0.2.0-rc.1 usava outro `appId` (`br.com.leapy.nod`): quem vem dela é o pior caso e deve esperar o desfecho (b). O roteiro de aceite desses
casos é a seção H de [aceite-desktop.md](aceite-desktop.md).

**No servidor.** Faça backup do Postgres e valide as migrações em uma cópia antes de atualizar o servidor. Se falhar, preserve logs sem segredos, suspenda a indicação da candidata e restaure o servidor pelo backup testado ou por migração corretiva; reinstalar o DMG antigo não desfaz o banco.

## Atualização automática do app (NOD-132, ADR-149)

O app instalado em **Aplicativos** procura versão nova 30 s depois de conectar, a cada 4 h e em **nod › Procurar
atualizações…**. Quando o servidor recusa a versão (`atualize_app`), procura na hora. Baixou, o menu mostra
**Reiniciar para atualizar (x.y.z)**, sai uma notificação e a tela de conexão avisa. Em ligação, o app pede para
terminar antes; com bot trabalhando no Mac, pergunta antes de interromper. Fora de **Aplicativos** (aberto do DMG ou de
Downloads), a atualização fica desligada e o menu diz por quê. O log fica em `~/Library/Logs/nod`, sem a chave e sem a URL
assinada.

**Uma vez, na GCP** (owner do projeto `nod-producao`):

```bash
SA=$(gcloud compute instances describe nod-vm --zone southamerica-east1-b --format='value(serviceAccounts[0].email)')
gcloud storage buckets create gs://nod-producao-atualizacoes --location=southamerica-east1 \
  --uniform-bucket-level-access --public-access-prevention
gcloud storage buckets add-iam-policy-binding gs://nod-producao-atualizacoes \
  --member="serviceAccount:$SA" --role=roles/storage.objectViewer
gcloud iam roles create nodAssinarBlob --project nod-producao \
  --title="nod: assinar URL do bucket" --permissions=iam.serviceAccounts.signBlob
gcloud iam service-accounts add-iam-policy-binding "$SA" \
  --member="serviceAccount:$SA" --role=projects/nod-producao/roles/nodAssinarBlob
```

A VM precisa do escopo `cloud-platform` (o padrão do `provisionar.sh`). Só o `signBlob`, sem o `serviceAccountTokenCreator` inteiro: é menor privilégio, não isolamento (com `signBlob` sobre si mesma a SA ainda assina um JWT e troca por token, mas é a própria VM, sem escalada). Sem essas permissões o feed responde 503 (o app mostra o erro com o link do download) e o
servidor loga `atualizacao_app_assinatura_falhou` com o código (`sign_blob_403`, por exemplo).

**A cada versão**, depois de publicar a release assinada:

1. `scripts/desktop/publicar-atualizacao.sh v<versão>`: baixa os ZIPs da release, confere o SHA-256 e copia para
   `gs://nod-producao-atualizacoes/<versão>/` (nunca sobrescreve). No fim imprime as duas linhas do config.env.
2. Em `infra/gcp/config.env`, `NOD_APP_VERSAO_PUBLICADA=<versão>` e `NOD_APP_ATUALIZACAO_SHA256=arm64=…,x64=…` (as
   linhas que o script imprimiu, só depois do upload), por PR, e o deploy. O feed manda o hash; o Squirrel.Mac do Electron 43
   ainda não o confere (a defesa é a assinatura de código), e ele passa a valer quando o Electron trouxer o Squirrel
   novo. Versão sem hash derruba o boot.
   Atenção: sem canal beta, uma versão `-rc.N` publicada vai para todo app mais velho. Esvaziar a flag não recolhe o
   que já baixou (o ShipIt instala no próximo encerramento). Só o servidor oficial do build é fonte de atualização:
   o app ligado a "Outro servidor" não procura (o Squirrel do Electron 43 não confere versão nem hash).
3. Confira: um Mac com a versão anterior, em **Aplicativos**, mostra **Reiniciar para atualizar** em até 4 h (ou na
   hora, pelo menu).

**Parar o anúncio:** esvazie `NOD_APP_VERSAO_PUBLICADA` (o hash pode ficar) e rode o deploy. Não há downgrade: uma versão ruim se corrige
publicando outra mais nova.

## O Claude Code se atualiza pelo app (NOD-9)

Definido em 2026-10-23 (plano do Arquiteto de 20/10, PR 2). O app confere a versão do CLI escolhido contra o piso testado
(`PISO_CLI`) e contra a mínima do modelo que um turno pediu. Abaixo disso:

- **Sozinho, na brecha.** Sem turno daquele provedor e sem ligação, o app roda o `claude update` (ambiente limpo, prazo
  de 3 min). Uma tentativa automática por alvo por dia; o registro fica em `atualizacoes-ia.json`, na pasta de dados do
  app. Sem brecha, o cartão diz "Vamos atualizar o Claude Code quando seus bots terminarem."; com 23 h avisa e com 24 h
  os pedidos novos daquele provedor esperam (no máximo 10 min, depois roda com o turno aberto). A ligação nunca é
  interrompida.
- **No clique.** "Atualizar", no cartão da IA desatualizada, roda na hora (e não conta para o limite do dia); com turno
  rodando, a atualização espera o turno terminar.
- **Reserva.** Se o atualizador oficial falhar (sem permissão, versão ilegível, sem atualizador), o app instala a versão
  do nod pelo npm embutido, como no "Instalar". O Codex vai direto à reserva (até a NOD-8).
- **Não mexe.** Binário apontado por `NOD_CLAUDE_BIN`/`NOD_CODEX_BIN` (`configurado`): o cartão manda atualizar pelo
  terminal.

- **Com a senha do Mac (PR 3).** CLI instalado como root (ex.: `sudo npm i -g` em `/usr/local`): se no clique o oficial
  e a reserva falharem por permissão (ou a reserva sem npm), o app abre a janela de senha do macOS ("O nod precisa da
  sua senha para atualizar o Claude Code."). Só com a janela do nod em foco, uma por vez, e no máximo 2 recusas por dia
  (contadas em `atualizacoes-ia.json`). O script do `osascript` é fixo; o comando vai em argv como
  `/usr/bin/env -i HOME=<pasta nova> PATH=<pastas de root> <realpath do claude> update`. Só eleva se o binário e todas
  as pastas acima forem do root e não graváveis por outros; caso contrário o cartão fica em "sem permissão" com o
  comando do terminal. Cancelar a janela vira "Tentar de novo"; 5 min sem resposta viram `tempo_esgotado`. Nada da
  saída do `osascript` vai à tela; o log `ia_atualizacao` traz `caminho: "aprovacao"`.

No navegador, o cartão manda abrir o app e dá o comando (`claude update`). A VM do motor é o PR 4.

## Diagnóstico para suporte (NOD-138)

Quando o app não conecta, não acha o Claude ou o Codex, ou cai, peça à pessoa **nod › Exportar diagnóstico…**. O app
abre "Salvar" com `nod-diagnostico-AAAAMMDD-HHMMSS.txt` sugerido em Downloads. Depois de salvar, o Finder mostra o
arquivo; cancelar não grava nada. O item fica no menu nativo, e não na página: funciona na tela de conexão, sem
servidor e com a janela web fora do ar, e a ponte `window.nodDesktop` não ganhou função para isso.

**Onde fica o log.** O `log()` do app do Mac grava a mesma linha JSON do stdout, já redigida pela NOD-158, em
`~/Library/Logs/nod/nod.log` (modo `0600`). Passou de 1 MiB, ela vira `nod.1.log`. São duas gerações, no máximo 2 MiB.
Quedas de janela, de processo filho e exceções do processo principal viram uma linha `app_processo_caiu` só com
metadados de lista fechada (tipo, motivo, código de saída, classe do erro), sem mensagem, URL ou caminho. Nada é
registrado durante o Cmd+Q. O servidor não grava esse arquivo.

**O que o diagnóstico leva.** Um `.txt` em pt-BR com as seções App, Conexão, IA neste Mac, Execução, Preferências,
Quedas recentes e Registros recentes (a cauda das duas gerações, até 256 KiB). Leva a versão do app e do sistema, a
origem do servidor (`https://host`, sem caminho nem credencial), o id da máquina (o mesmo de **Chaves**), o estado de
cada IA e as preferências.

**O que nunca leva.** A chave do Mac, o cookie de sessão, o e-mail, o nome do Mac e o texto das conversas. Primeiro o
texto passa pelo redator da NOD-158 (segredos viram `«redigido: N caracteres»`), depois `/Users/<nome>` vira `~` e
e-mail vira `«e-mail»`, e só então os registros são cortados pela cauda na borda de linha. O arquivo é gravado com
`0600`, e nem ele nem o `nod.log` seguem symlink ou escrevem em hardlink. O diagnóstico fica no Mac. Ele nunca sobe ao
servidor nem entra no relato.

**Roteiro manual no app empacotado (Mac arm64).**

1. Na tela de conexão (sem servidor, ou com uma chave inválida), use **nod › Exportar diagnóstico…** e salve.
   Confira se o Finder abre com o arquivo selecionado. Repita com a janela do nod aberta e conectada.
2. Abra o arquivo e confira se as sete seções estão na ordem. Desconectado, IA, máquina e execução aparecem como
   "desconectado".
3. `grep -cE 'nod_sessao|sk-|ghp_|Bearer [A-Za-z0-9]|/Users/' ~/Downloads/nod-diagnostico-*.txt` deve dar `0`.
4. Com a janela do nod aberta, mate o processo **nod Helper (Renderer)** no Monitor de Atividade. Exporte de novo:
   "Quedas recentes" deve trazer uma linha `app_processo_caiu` com `"superficie":"janela_principal"`.
5. `ls -l ~/Library/Logs/nod` mostra `-rw-------` em `nod.log`.
6. Cancelar o diálogo de salvar não grava nada. Salvar numa pasta sem permissão mostra "Não foi possível salvar o
   diagnóstico. Escolha outra pasta e tente de novo."

## O motor no Windows (ADA-32, ADR-151)

A pessoa instala o motor num Windows 10 22H2/11 x64 colando no PowerShell (sem admin):

```powershell
irm https://app.nodbot.ai/windows | iex
```

`https://nodbot.ai/windows` também funciona quando o site estiver publicado (`site/_redirects` manda um 302 para
`https://app.nodbot.ai/windows`). O servidor responde `/windows` com um 302 para `GET /api/motor/instalar-windows`, que
devolve o PowerShell com o endereço e a versão do próprio servidor (o mesmo contrato do `/motor` do Linux, ADR-090).

O script instala o Git for Windows se faltar (winget no escopo do usuário, winget, ou o instalador oficial com a
assinatura do projeto), um Node portátil 24.19.0 em `%LOCALAPPDATA%\nod\node` (sha256 do SHASUMS256), o Claude Code e
o Codex pelo npm desse Node (`NOD_SEM_CODEX=1` pula o Codex), o motor da versão do servidor em
`%LOCALAPPDATA%\nod\motor\app` (sha256 do manifesto, troca com volta), `nod.cmd`/`nod-motor.cmd` em
`%LOCALAPPDATA%\nod\bin` (no Path do usuário) e a Tarefa Agendada `\nod-motor-<SID>` do usuário (uma por conta do Windows) no login (ou a chave `Run`
do HKCU se a política recusar). Depois roda `nod parear <servidor> --abrir`, que abre o navegador no link do pareamento.

- **Rodar de novo atualiza**: para o motor, troca o que mudou, recria a tarefa e sobe o motor. A conexão
  (`%APPDATA%\nod-motor\conexao.json`) nunca é tocada; com ela no lugar, o pareamento é pulado.
- **Falhas** saem como `✗ mensagem` sem fechar a janela; o detalhe fica em `%LOCALAPPDATA%\nod\instalador.log`.
- **Suporte e CI**: `NOD_INSTALAR_ATE=pareamento` para antes do pareamento; `NOD_PASTA` troca `%LOCALAPPDATA%\nod`.
- **Na CI** (job `windows`): o PSScriptAnalyzer exige zero avisos/erros no script gerado
  (`scripts/windows/gerar-instalador.ts`) e o instalador roda duas vezes no Windows PowerShell 5.1 contra
  `scripts/windows/servidor-de-teste.ts`, conferido por `scripts/windows/conferir-instalacao.ps1`.
- **Publicar o atalho do site** depende de uma pessoa: `npx wrangler deploy` na pasta `site/` (conta Cloudflare do
  nodbot.ai). Até lá, divulgue `irm https://app.nodbot.ai/windows | iex`.

## O app desktop do Windows (ADA-229, ADR-152)

`https://app.nodbot.ai/download/windows` responde 302 para o `nod-windows-x64.exe` mais novo
(`gs://nodbot-downloads/nod-windows-x64.exe`). Desde a ADA-229 esse `.exe` é o **app desktop** (Electron, a mesma base
do Mac, processo principal em `desktop/windows/main.ts`), num NSIS de 1 clique por usuário do electron-builder
(`electron-builder-windows.yml`): instala em `%LOCALAPPDATA%\Programs\nod` sem pedir admin, cria o atalho **nod** no Menu
Iniciar e na Área de Trabalho e abre o app no fim. Na primeira abertura o app conecta o computador (o código aparece na
janela e o navegador abre para confirmar), instala o motor pelo mesmo script `/windows` da ADA-32 num PowerShell
oculto, vigia o motor a cada 30 s (religa pela tarefa agendada) e abre o nod com a sessão da máquina. Fechar a janela
deixa o app na bandeja.

Instruções para a pessoa (3 passos):

1. Baixe em **app.nodbot.ai/download/windows**.
2. Abra o arquivo baixado. Se o Windows mostrar "O Windows protegeu o computador", clique em **Mais informações** e
   depois em **Executar assim mesmo** (o app ainda não é assinado, NOD-471).
3. No app, clique em **Conectar**, entre na sua conta no navegador e confirme o código.

- **Montar**: `npm run desktop:windows` (num Windows; grava `release/nod-<v>-win-x64.exe`).
- **Atualização automática**: o feed `?plataforma=windows&arch=x64` anuncia `<v>/nod-<v>-win-x64.exe` quando a linha de
  `NOD_APP_ATUALIZACAO_SHA256` tem `win-x64=`. O `publicar-atualizacao.sh` sobe o `.exe` e acrescenta a chave quando a
  release o traz. O app confere o sha256 e roda o instalador com `/S --updated --force-run`.
- **Na CI** (job `windows` e job `windows` do `desktop-release.yml`): `scripts/windows/testar-app.ps1` instala com `/S`,
  confere o `nod.exe`, os atalhos e Aplicativos, abre e fecha o app (print no artefato) e desinstala com `/S`.
- **Publicar**: baixe o artefato `nod-windows-x64` do `desktop-release` e
  `gcloud storage cp nod-windows-x64.exe nod-windows-x64.exe.sha256 gs://nodbot-downloads/ --cache-control=no-store`.
- **Assinatura (NOD-471)**: desligada. Com `vars.NOD_WINDOWS_ASSINAR = '1'` e os secrets `WIN_CSC_LINK` e
  `WIN_CSC_KEY_PASSWORD` (o .pfx em base64), o electron-builder assina no job `windows` da release.

O instalador `.exe` da ADA-226 abaixo (só o motor, sem app) saiu da release e segue testado na CI até ser removido.

## O instalador .exe do Windows (ADA-226)

Para quem não usa terminal: `https://app.nodbot.ai/download/windows` responde 302 para o
`nod-windows-x64.exe` mais novo (`gs://nodbot-downloads/nod-windows-x64.exe`, público como os .dmg; a release do
GitHub é privada). O .exe é um instalador NSIS por usuário, sem admin, que roda **o mesmo** instalador da ADA-32 num
PowerShell escondido, com a saída na própria janela (`scripts/windows/instalador.nsi` e `instalar-pelo-exe.ps1`),
cria o atalho **Nod** no Menu Iniciar e na Área de Trabalho e entra em Configurações › Aplicativos com desinstalador
(`desinstalar-pelo-exe.ps1`: tira a tarefa, o Path e a pasta; guarda a conexão). O Electron no Windows segue na Fase 3:
"Abrir o Nod" abre o Nod web com o motor desta máquina conectado.

Instruções para a pessoa (3 passos):

1. Baixe em **app.nodbot.ai/download/windows**.
2. Abra o arquivo baixado. Se o Windows mostrar "O Windows protegeu o computador", clique em **Mais informações** e
   depois em **Executar assim mesmo** (o .exe ainda não é assinado).
3. Clique em **Instalar**. Quando o navegador abrir com um código, entre na sua conta e confirme; depois clique em
   **Concluir** com "Abrir o Nod" marcado.

- **Montar**: `node scripts/windows/gerar-exe.mjs [--saida dist/windows] [--versao X]` (NSIS 3; `NSIS_MAKENSIS`
  aponta outro makensis). Grava o `.exe` e o `.exe.sha256`. `/S` instala em silêncio; `/SERVIDOR=https://…` troca o
  servidor (só https com host simples ou `http://127.0.0.1:<porta>`; inválido sai com 2). Códigos: 1 a instalação da
  ADA-32 falhou, 3 o servidor não respondeu, 4 outro, 5 outro instalador ou desinstalador do Nod já está aberto (um por
  vez). A pasta é sempre `%LOCALAPPDATA%\nod`: o `/D=` do NSIS é ignorado.
- **Na CI** (job `windows`): `scripts/windows/testar-exe.ps1` confere o
  endereço inválido, instala com `/S`, desinstala com `/S` e instala pela janela só com Enter, com prints de cada passo
  no artefato (`nod-windows-exe` na CI, `prints-windows-exe` na release). O rascunho da tag `v*` leva o `.exe` e o `.sha256`.
- **Publicar** (manual, como o disco da VM): baixe o artefato `nod-windows-x64` do `desktop-release` e
  `gcloud storage cp nod-windows-x64.exe nod-windows-x64.exe.sha256 gs://nodbot-downloads/ --cache-control=no-store`.
- **Assinatura**: sem certificado de code signing ainda. Com ele, assinar o .exe com `signtool` antes do sha256
  (pendente de uma pessoa: comprar o certificado e guardá-lo nos secrets).

## Gerar e publicar

Uma preview sem assinatura usa uma tag `desktop-v<VERSÃO>` (a última publicada está na [lista de releases](https://github.com/gamefik/nod/releases); a primeira foi `desktop-v0.2.0-rc.1`), dois DMGs sem assinatura e o manifesto SHA-256 anexado à release. As tags `desktop-v*` não disparam o workflow de distribuição assinada; os controles abaixo continuam exigidos para a futura versão estável.

`npm ci` usa as versões exatas de Electron e electron-builder do lockfile. `npm run desktop:build` compila app, preload e proxy e recusa dependências de servidor no bundle desktop. `npm run desktop:dev` permite HTTP somente em loopback para desenvolvimento; o app empacotado aceita só HTTPS.

O workflow `.github/workflows/desktop-release.yml` roda o gate completo com Postgres limpo, roda o smoke da janela (`scripts/desktop/smoke-window.mjs`) antes de empacotar, cria os dois DMGs em runners nativos (cada job empacota só a própria arquitetura com `--mac dmg --<arch>` e confere com `lipo -archs` que o app testado é dela; sem o alvo explícito, o `arch` do `electron-builder.yml` vence a CLI e o job arm64 testava o app x64 pelo Rosetta, NOD-133), testa o proxy com o runtime empacotado (`smoke-proxy.mjs`, prazo em `NOD_SMOKE_PROXY_PRAZO_MS`, padrão 60 s; na falha imprime tempo, stdout, stderr e um `sample` do processo), verifica assinatura e notarização e cria uma **release em rascunho** nas tags `v<VERSÃO>` que correspondem ao `package.json`. Execução manual guarda apenas os artefatos do workflow.

### O disco da VM local (NOD-93, ADR-127)

Com a variável de repositório `NOD_VM_LOCAL=1`, o job `vm-local` constrói um disco por arquitetura
(`nod-vm-<VERSÃO>-{arm64,amd64}.img.zst`, ~1 GB cada) e o app sai com o sha256 dele embutido. O rascunho da release
recebe os discos como anexo, mas o app **não baixa do GitHub** (o repositório é privado): ele baixa de
`https://storage.googleapis.com/nodbot-downloads/v<VERSÃO>/` (`URL_DISCO_PADRAO`, desktop/vm-local/origem.ts), o
bucket público dos DMGs do site. Antes de publicar, copie os dois discos e os `.sha256` para lá:

```sh
gcloud storage cp release/nod-vm-<VERSÃO>-*.img.zst* gs://nodbot-downloads/v<VERSÃO>/
```

Sem o disco no bucket o preparo da VM fica em `falhou` (404) na primeira abertura. A conta de deploy do Actions não
escreve nesse bucket; o passo é manual até ganhar permissão (definido em 2026-11-04, release 1.0.0-rc.3).

### Secrets e variável da release assinada (NOD-203)

Cadastre em **Settings › Secrets and variables › Actions** do repositório, sem colocá-los no repositório. O nome é o
que o preflight (`scripts/desktop/release-preflight.mjs`) cita quando falta: ele roda antes do `npm ci` e lista
**tudo** o que falta numa execução só. String vazia conta como ausente.

| Nome no GitHub | Tipo | Onde cadastrar | Chega ao job como | Conteúdo |
| --- | --- | --- | --- | --- |
| `APPLE_CERTIFICATE_P12` | secret | Actions › Secrets | `CSC_LINK` | Exportação Developer ID Application em P12, codificada em base64 |
| `APPLE_CERTIFICATE_PASSWORD` | secret | Actions › Secrets | `CSC_KEY_PASSWORD` | Senha da exportação P12 |
| `APPLE_ID` | secret | Actions › Secrets | `APPLE_ID` | Conta Apple usada na notarização |
| `APPLE_APP_SPECIFIC_PASSWORD` | secret | Actions › Secrets | `APPLE_APP_SPECIFIC_PASSWORD` | Senha específica de app dessa conta |
| `APPLE_TEAM_ID` | secret | Actions › Secrets | `APPLE_TEAM_ID` | Identificador do time Apple Developer |
| `NOD_SERVIDOR_PADRAO` | **variável** de repositório | Actions › Variables | `NOD_SERVIDOR_PADRAO` | Endereço do servidor embutido no app, `https://host` (porta opcional), sem caminho nem barra final |

`NOD_SERVIDOR_PADRAO` é variável, e não secret, porque o endereço aparece no app. Ela é obrigatória em toda execução
do `desktop-release`, de tag ou manual: um DMG oficial sem servidor embutido pediria o endereço na primeira abertura.
A regra do formato é a mesma do `scripts/desktop/build.mjs` (`scripts/desktop/servidor-padrao.mjs`); o build local
continua aceitando vazio.

### O que o CI confere no job `mac`

Ordem dos passos: preflight → `npm ci` → `desktop:build` → smoke da janela → `electron-builder` (assina e notariza o
`.app`) → **Notarizar e grampear o DMG** → **Verificar assinatura e notarização** → SHA-256 → upload. O SHA-256 vem
depois do grampo, porque o hash publicado tem que ser o do DMG final.

- **Notarização do DMG:** `xcrun notarytool submit --wait --output-format json`; o status precisa ser `Accepted` (o
  `--wait` sai com 0 mesmo com `Invalid`). Se não for, o passo imprime o `notarytool log` e falha. Depois,
  `xcrun stapler staple` no DMG.
- **Verificação** (`scripts/desktop/verificar-pacote-mac.mjs`), que junta todas as falhas e diz, em pt-BR, o que
  esperava e o que veio:
  - `smoke-proxy.mjs` com o binário empacotado;
  - `codesign --verify --deep --strict` do `.app`;
  - `Authority=Developer ID Application: …` e `TeamIdentifier` igual a `APPLE_TEAM_ID`;
  - hardened runtime (`flags` com `runtime`);
  - entitlements do `.app` e de cada `nod Helper*.app` iguais, exatamente, às de `desktop/entitlements.mac.plist`
    (`com.apple.security.cs.allow-jit` e `com.apple.security.device.audio-input`); nenhum helper encontrado reprova;
  - `NSMicrophoneUsageDescription` do `Info.plist` igual ao texto do `electron-builder.yml`;
  - `lipo -archs` do binário igual à arquitetura do job (`arm64` ou `x86_64`), sem a outra;
  - `stapler validate` do `.app` e do DMG;
  - `spctl --assess` do `.app` (`--type execute`) e do DMG (`--type open --context context:primary-signature`) com
    `accepted` e `source=Notarized Developer ID`.

As funções que interpretam essas saídas são testadas no Linux com saídas de exemplo
(`tests/unit/desktop/verificar-pacote-mac.test.ts`). A prova com os secrets reais é critério da NOD-133.

`npm run desktop:mac` exige as variáveis equivalentes `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` e assinatura válida. Não publica automaticamente. Confirme instalação, conexão ao servidor e um turno real em um Mac Intel e outro com chip M antes de publicar o rascunho. A assinatura/notarização e esse aceite não foram realizados neste ambiente.

A página da release fornece os dois DMGs e SHA-256. Quem instala precisa ter acesso ao repositório se ele for privado. Desde a NOD-132 (ADR-149) o app instalado em Aplicativos se atualiza sozinho quando `NOD_APP_VERSAO_PUBLICADA` está preenchida; o DMG segue para a primeira instalação e para quem está numa versão anterior à atualização automática.

## Contratos e limites desta etapa

- `/api/maquina/{sessao,conectar,puxar,renovar,entregar,desconectar}`: POST com chave de máquina e `x-nod-versao`. `Origin` é recusado antes de autenticar; a chave é validada em transação escopada em cada requisição.
- O id da chave é o id da máquina; campos de identidade no corpo não mudam o escopo. A renovação não aceita eventos de domínio enviados pelo cliente; aceita os quatro sinais e deltas de texto limitados.
- Long-poll de até 20 s, timeout de cliente de 35 s. Durante execução, renovação a cada 1 s permite detectar Parar sem conexão iniciada pelo servidor. É um refinamento do intervalo inicial de 30 s do ADR-021. Falha de renovação manda abortar o executor.
- A sessão `--resume` não é reaproveitada no modo compartilhado: o histórico vem do servidor, evitando referenciar uma sessão que existe só em outro Mac. Afinidade por máquina pode recuperar essa otimização depois.
- Windows tem alvo NSIS preparado, mas resolução do CLI, interrupção de processos, armazenamento e instalação ainda precisam de testes nativos. Não é anunciado como suportado nesta release.

Referências: [segurança do Electron](https://www.electronjs.org/docs/latest/tutorial/security), [assinatura e notarização](https://www.electron.build/v26/docs/mac/), [runners Intel e ARM do GitHub](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
