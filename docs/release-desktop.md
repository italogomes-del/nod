# nod 0.2.0-rc.1 — guia de instalação e distribuição

A distribuição usa um servidor compartilhado e dois aplicativos macOS: `arm64` para chips M e `x64` para Intel. O Mac precisa do Claude Code instalado e autenticado. Não precisa de Node, Docker ou Postgres. O servidor guarda as conversas, permissões, decisões e rotinas; cada app puxa os trabalhos da pessoa que emitiu sua chave.

## Estado em 17/09/2026

Implementados: app Electron, configuração do endereço, chave cifrada com `safeStorage` (Keychain no macOS), sessão web obtida pela chave, ponte HTTP autenticada, executor local reutilizado, builds separados e workflow de assinatura/notarização. Nenhuma URL de produção foi escolhida. Nenhum certificado Developer ID válido foi encontrado na máquina de desenvolvimento. Portanto os builds locais sem assinatura são para verificação, e não uma release pronta para distribuir ao time.

## Mudanças e validação desta candidata

Integra o desktop à main atual, incluindo gestão e exclusão recuperável de agentes (migrações 0011 e 0012), decisões diretamente no chat, cooperação iniciada por agentes acordados por rotinas e Sonnet como modelo padrão. As sondas continuam em Haiku. Candidatas `-rc.N` são reconhecidas pela verificação de compatibilidade do app.

Servidor compatível: código da tag `v0.2.0-rc.1`, protocolo de máquina 1, migrações 0001–0012. A URL HTTPS de produção ainda não foi informada. Não use o snapshot da preview anterior como servidor desta candidata. Permanece a versão mínima de cliente 0.1.0; não houve aumento forçado dessa versão mínima.

O gate e os builds desta candidata serão registrados nas notas da release. Assinatura/notarização, aceite nativo Intel/ARM e atualização a partir da preview estão pendentes. Não se reutilizam as contagens nem os instaladores da versão anterior como evidência desta versão. A criação autônoma de tarefas ClickUp por um agente destinatário não está aprovada nos UATs.

## Preparar o servidor

1. Disponibilize Postgres com os roles e todas as migrações 0001–0012 desta versão. Migre como `nod_dono`; execute a aplicação como `nod_app`.
2. Cadastre os colaboradores na allowlist de pessoas, incluindo seus emails. O login Google não cria pessoas automaticamente.
3. Configure um domínio HTTPS e o cliente OAuth Google, com callback `https://SEU-DOMINIO/api/sessao/google/callback`.
4. Gere segredos próprios para sessão e cifra, conforme `.env.example`. Configure `DATABASE_URL`, `DATABASE_URL_DONO`, `NOD_LOGIN=google`, `NOD_GOOGLE_CLIENT_ID`, `NOD_GOOGLE_CLIENT_SECRET`, `NOD_GOOGLE_REDIRECT_URI`, `NOD_SESSAO_SEGREDO` e `NOD_CREDENTIAL_KEY`.
5. Use `NOD_MODO=compartilhado`. Na imagem Docker este é o padrão; o Dockerfile já compila e serve a web. Fora de Docker: `npm run build`, `NOD_STATIC_DIR=dist/web`. Defina `NOD_HOST=0.0.0.0` dentro do container e encaminhe 8888 pelo proxy HTTPS.
6. O proxy precisa aceitar SSE sem buffering e requisições de pelo menos 35 segundos. Use uma instância do servidor nesta versão: tokens de turno, conexões de máquinas e barramento são mantidos em memória. Não escale réplicas sem implementar coordenação correspondente.

No modo compartilhado não há sonda nem execução Claude no servidor. `NOD_EXECUTOR` não habilita um executor local nesse modo. Os conectores MCP continuam no servidor, como antes; ferramentas locais do Mac não são expostas por esta release.

## Primeira abertura no Mac

1. Baixe o DMG correspondente ao processador, abra e arraste **nod** para **Aplicativos**.
2. Informe o endereço HTTPS do time e clique em **Entrar no navegador**.
3. Entre com Google, abra **Chaves**, gere uma chave com o nome deste computador e cole no app.
4. Clique em **Conectar e abrir o nod**. A verificação Claude usa um turno curto da assinatura, como a sonda existente no projeto.

O endereço e a chave ficam cifrados em `Application Support/nod/conexao.enc`. A chave de cifra é protegida pelo Keychain; nada disso entra no pacote. Para reconfigurar ou verificar o Claude depois de instalar/autenticar, use **nod → Conexão / verificar Claude**. Reiniciar o app reconecta com a configuração salva e verifica o Claude novamente. Uma chave por computador; revogue em **Chaves** quando necessário.

Fechar o app encerra sua execução. Quando o computador some sem desconectar, o lease encerra o turno órfão, sem reenfileirar automaticamente. As decisões e consultas continuam pela web.

## Atualizar a partir da preview

Faça backup do Postgres e valide as migrações em uma cópia antes de atualizar o servidor. Instale o novo DMG sobre o app anterior, mantendo a configuração cifrada no Keychain. Valide conexão, execução, Parar e revogação de chave nas duas arquiteturas. Não há atualização automática. Esse caminho ainda depende de aceite real. Se falhar, preserve logs sem segredos, suspenda a indicação da candidata e restaure o servidor pelo backup testado ou por migração corretiva; reinstalar o DMG antigo não desfaz o banco.

## Gerar e publicar

`npm ci` usa as versões exatas de Electron e electron-builder do lockfile. `npm run desktop:build` compila app, preload e proxy e recusa dependências de servidor no bundle desktop. `npm run desktop:dev` permite HTTP somente em loopback para desenvolvimento; o app empacotado aceita só HTTPS.

O workflow `.github/workflows/desktop-release.yml` roda o gate completo com Postgres limpo, cria os dois DMGs em runners nativos, testa o proxy com o runtime empacotado, verifica assinatura e notarização e cria uma **release em rascunho** nas tags `v<VERSÃO>` que correspondem ao `package.json`. Execução manual guarda apenas os artefatos do workflow.

Configure estes secrets do GitHub, sem colocá-los no repositório:

| Secret | Conteúdo |
| --- | --- |
| `APPLE_CERTIFICATE_P12` | Exportação Developer ID Application em P12, codificada em base64 |
| `APPLE_CERTIFICATE_PASSWORD` | Senha da exportação P12 |
| `APPLE_ID` | Conta Apple usada na notarização |
| `APPLE_APP_SPECIFIC_PASSWORD` | Senha específica de app dessa conta |
| `APPLE_TEAM_ID` | Identificador do time Apple Developer |

`npm run desktop:mac` exige as variáveis equivalentes `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` e assinatura válida. Não publica automaticamente. Confirme instalação, conexão ao servidor e um turno real em um Mac Intel e outro com chip M antes de publicar o rascunho. A assinatura/notarização e esse aceite não foram realizados neste ambiente.

A página da release fornece os dois DMGs e SHA-256. Os colaboradores precisam ter acesso ao repositório se ele for privado. Não há atualização automática: o servidor anuncia a versão mínima e o app exige uma atualização quando necessário.

## Contratos e limites desta etapa

- `/api/maquina/{sessao,conectar,puxar,renovar,entregar,desconectar}`: POST com chave de máquina e `x-nod-versao`. `Origin` é recusado antes de autenticar; a chave é validada em transação escopada em cada requisição.
- O id da chave é o id da máquina; campos de identidade no corpo não mudam o escopo. A renovação não aceita eventos de domínio enviados pelo cliente; aceita os quatro sinais e deltas de texto limitados.
- Long-poll de até 20 s, timeout de cliente de 35 s. Durante execução, renovação a cada 1 s permite detectar Parar sem conexão iniciada pelo servidor. É um refinamento do intervalo inicial de 30 s do ADR-021. Falha de renovação manda abortar o executor.
- A sessão `--resume` não é reaproveitada no modo compartilhado: o histórico vem do servidor, evitando referenciar uma sessão que existe só em outro Mac. Afinidade por máquina pode recuperar essa otimização depois.
- Windows tem alvo NSIS preparado, mas resolução do CLI, interrupção de processos, armazenamento e instalação ainda precisam de testes nativos. Não é anunciado como suportado nesta release.

Referências: [segurança do Electron](https://www.electronjs.org/docs/latest/tutorial/security), [assinatura e notarização](https://www.electron.build/v26/docs/mac/), [runners Intel e ARM do GitHub](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
