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

**No Mac.** Não há atualização automática (NOD-132). Baixe o DMG novo, abra e arraste **nod** para **Aplicativos**,
escolhendo **Substituir**. Na primeira abertura, o macOS pode pedir a senha do Mac uma vez para o app novo usar o
Keychain. Depois disso, um destes dois desfechos é o esperado:

- **(a) Reconecta sozinho.** O app abre o nod com a mesma chave; **Chaves**, no navegador, não ganha chave nova.
- **(b) Volta à tela de conexão.** O app assinado não conseguiu ler a conexão guardada pela preview. Clique em
  **Entrar com Google** e conecte de novo; depois, em **Chaves**, revogue a chave antiga deste Mac.

Travar, abrir tela branca ou ficar alternando entre a tela de conexão e o nod não é esperado: preserve o diagnóstico
(**nod › Exportar diagnóstico…**) e avise o time. Ao abrir uma ligação, o macOS pode perguntar de novo pelo microfone
(NOD-165). A 0.2.0-rc.1 usava outro `appId` (`br.com.leapy.nod`): quem vem dela é o pior caso e deve esperar o desfecho (b). O roteiro de aceite desses
casos é a seção H de [aceite-desktop.md](aceite-desktop.md).

**No servidor.** Faça backup do Postgres e valide as migrações em uma cópia antes de atualizar o servidor. Se falhar, preserve logs sem segredos, suspenda a indicação da candidata e restaure o servidor pelo backup testado ou por migração corretiva; reinstalar o DMG antigo não desfaz o banco.

## Diagnóstico para suporte (NOD-138)

Quando o app não conecta, não acha o Claude ou o Codex, ou cai, peça à pessoa **nod › Exportar diagnóstico…**. O app
abre "Salvar" com `nod-diagnostico-AAAAMMDD-HHMMSS.txt` sugerido em Downloads. Depois de salvar, o Finder mostra o
arquivo; cancelar não grava nada. O item fica no menu nativo, e não na página: funciona na tela de conexão, sem
servidor e com a janela web fora do ar, e a ponte `window.nodDesktop` continua com 11 funções.

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

## Gerar e publicar

Uma preview sem assinatura usa uma tag `desktop-v<VERSÃO>` (a última publicada é `desktop-v0.4.0-rc.5`; a primeira foi `desktop-v0.2.0-rc.1`), dois DMGs sem assinatura e o manifesto SHA-256 anexado à release. As tags `desktop-v*` não disparam o workflow de distribuição assinada; os controles abaixo continuam exigidos para a futura versão estável.

`npm ci` usa as versões exatas de Electron e electron-builder do lockfile. `npm run desktop:build` compila app, preload e proxy e recusa dependências de servidor no bundle desktop. `npm run desktop:dev` permite HTTP somente em loopback para desenvolvimento; o app empacotado aceita só HTTPS.

O workflow `.github/workflows/desktop-release.yml` roda o gate completo com Postgres limpo, roda o smoke da janela (`scripts/desktop/smoke-window.mjs`) antes de empacotar, cria os dois DMGs em runners nativos, testa o proxy com o runtime empacotado, verifica assinatura e notarização e cria uma **release em rascunho** nas tags `v<VERSÃO>` que correspondem ao `package.json`. Execução manual guarda apenas os artefatos do workflow.

Configure estes secrets do GitHub, sem colocá-los no repositório:

| Secret | Conteúdo |
| --- | --- |
| `APPLE_CERTIFICATE_P12` | Exportação Developer ID Application em P12, codificada em base64 |
| `APPLE_CERTIFICATE_PASSWORD` | Senha da exportação P12 |
| `APPLE_ID` | Conta Apple usada na notarização |
| `APPLE_APP_SPECIFIC_PASSWORD` | Senha específica de app dessa conta |
| `APPLE_TEAM_ID` | Identificador do time Apple Developer |

`npm run desktop:mac` exige as variáveis equivalentes `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` e assinatura válida. Não publica automaticamente. Confirme instalação, conexão ao servidor e um turno real em um Mac Intel e outro com chip M antes de publicar o rascunho. A assinatura/notarização e esse aceite não foram realizados neste ambiente.

A página da release fornece os dois DMGs e SHA-256. Quem instala precisa ter acesso ao repositório se ele for privado. Não há atualização automática: o servidor anuncia a versão mínima e o app exige uma atualização quando necessário.

## Contratos e limites desta etapa

- `/api/maquina/{sessao,conectar,puxar,renovar,entregar,desconectar}`: POST com chave de máquina e `x-nod-versao`. `Origin` é recusado antes de autenticar; a chave é validada em transação escopada em cada requisição.
- O id da chave é o id da máquina; campos de identidade no corpo não mudam o escopo. A renovação não aceita eventos de domínio enviados pelo cliente; aceita os quatro sinais e deltas de texto limitados.
- Long-poll de até 20 s, timeout de cliente de 35 s. Durante execução, renovação a cada 1 s permite detectar Parar sem conexão iniciada pelo servidor. É um refinamento do intervalo inicial de 30 s do ADR-021. Falha de renovação manda abortar o executor.
- A sessão `--resume` não é reaproveitada no modo compartilhado: o histórico vem do servidor, evitando referenciar uma sessão que existe só em outro Mac. Afinidade por máquina pode recuperar essa otimização depois.
- Windows tem alvo NSIS preparado, mas resolução do CLI, interrupção de processos, armazenamento e instalação ainda precisam de testes nativos. Não é anunciado como suportado nesta release.

Referências: [segurança do Electron](https://www.electronjs.org/docs/latest/tutorial/security), [assinatura e notarização](https://www.electron.build/v26/docs/mac/), [runners Intel e ARM do GitHub](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
