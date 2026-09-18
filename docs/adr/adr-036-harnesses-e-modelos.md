# ADR-036 — Harness por agente, escolha automática e catálogo progressivo

Definido em 2026-09-18. Complementa ADR-012, ADR-014, ADR-019 e o documento de modelos.

## Decisão

Harness é o software que executa o agente; modelo é a inteligência usada por ele. Novos agentes nascem com `harness=auto` e `modelo=auto`. O servidor resolve a escolha antes de emitir o plano, usando apenas harnesses prontos no computador que puxou a tarefa. Ordem editorial: Claude Code/Sonnet, depois Codex/GPT-5.6 Sol. A preferência explícita da máquina precede essa ordem quando disponível. Uma escolha explícita do agente nunca troca de fornecedor silenciosamente.

O ambiente de desenvolvimento mantém `NOD_EXECUTOR=catcher`, explicitamente identificado como simulação. `NOD_EXECUTOR=auto`, ou produção sem essa variável, ativa a descoberta dos harnesses integrados. Falta de conta no modo real nunca rebaixa a execução para simulação. `NOD_MODELO` continua sendo um override administrativo para novos agentes; use `auto` para habilitar a escolha automática. A migração 0013 não altera modelos existentes.

A preferência é copiada para o turno ao enfileirar, inclusive em rotinas, delegação, retomada e duplicação. O plano captura o harness e o modelo resolvidos; `executor` mantém o significado anterior de local/catcher nos contratos e na autoria. Não há migração destrutiva de eventos antigos. A fila de computadores remotos só reivindica tarefas compatíveis com os harnesses anunciados; anúncios são vinculados à chave e ao escopo, nunca ao corpo.

## Experiência

Nenhum campo adicional na criação. Na conversa, um atalho discreto abre o seletor. No perfil, a opção recomendada vem antes de “Personalizar modelo”. Um único dropdown associa modelo e harness, com grupos, descrições curtas, navegação nativa por teclado e opções desconectadas desabilitadas. “Automático” restaura os padrões em qualquer momento. Detalhes técnicos e disponibilidade ficam em uma segunda expansão. Editar uma preferência não concede novos acessos.

## Execução e isolamento

Claude mantém `--tools ""`, `--strict-mcp-config` e a allowlist do plano. A descoberta de produção usa `auth status` (JSON por padrão), versão e help, sem inferência paga. Os scripts de sonda empírica continuam separados.

Codex usa `exec --json`, `--ignore-user-config`, `--ignore-rules`, `--ephemeral`, `--strict-config`, sandbox read-only, aprovação externa pelo proxy nod e ferramentas nativas de execução, navegador, plugins e apps desabilitadas. Versões sem as flags de isolamento são recusadas antes do prompt. A autenticação vem do CLI da pessoa; chaves OpenAI herdadas e variáveis de banco são removidas. Um launcher 0600 contém o token e chama o proxy MCP; o token não entra em argv. O diretório temporário é apagado no finally. Os eventos JSONL são normalizados; custo desconhecido permanece null.

O fluxo com seleção de harness recompõe contexto a partir do histórico e memória do nod e não usa resume nativo, evitando misturar sessões entre fornecedores/modelos. Isso limita o histórico explícito às últimas 20 mensagens de até 1.000 caracteres cada, conforme o contrato existente; a memória persistida complementa o contexto. Trocar modelo limpa também a sessão legada da conversa. Não existe repetição automática depois de efeitos externos.

## Limites desta entrega

Claude Code e Codex têm drivers. Cursor e Hermes aparecem como integrações em preparação, sem permitir seleção. Grok é tratado como modelo/provedor a ser exposto por um harness compatível, não como um executável inventado. Nenhum driver ACP ou API xAI é simulado como integração pronta.

O catálogo de modelos é editorial, não uma garantia de habilitação na assinatura. O estado de login não prova saldo, cota ou acesso a cada modelo. Erros do fornecedor durante uma tarefa seguem o encerramento existente do nod. Descoberta dinâmica de modelos e uma integração ACP exigem testes próprios antes de serem habilitadas.

Adicionar um harness requer: declarar id/catálogo, implementar o SPI, sondagem sem inferência, parser e política de ferramentas, registrar nos hosts, validar anúncio remoto e adicionar testes de processo/MCP/interrupção. Alterar somente o catálogo não habilita execução.

## Validação local

Medido em 2026-09-18: `npm run check` passou com 700 testes (377 unitários, 225 integração, 49 conformidade e 49 concorrência). `npm run build` e `npm run desktop:build` passaram. O proxy compilado respondeu ao initialize JSON-RPC usando Node 24.19.0; o runtime Electron não estava instalado neste checkout, portanto isso não valida o aplicativo nativo. A interface foi inspecionada no navegador, incluindo seleção, detalhes de disponibilidade, cancelamento e retorno do foco. Os testes de drivers usam CLIs falsos e incluem processo, interrupção e handshake MCP; não houve inferência paga nem aceite real das contas/modelos.

## Referências consultadas

- [OpenMausBot — Agent engines](https://docs.openmausbot.com/docs/providers): descoberta de instalação e login e normalização por drivers.
- [Hermes — Bot Mode](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/bot-mode.md): identidade do bot independente da conexão.
- [Codex — execução não interativa](https://developers.openai.com/codex/noninteractive) e [configuração](https://developers.openai.com/codex/config-reference): eventos JSONL, sandbox e MCP.
- [Claude Code — CLI](https://code.claude.com/docs/en/cli-reference): autenticação e modo não interativo.
