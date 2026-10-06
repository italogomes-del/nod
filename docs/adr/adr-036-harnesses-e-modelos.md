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

## Emenda (2026-10-05): o Codex com ferramentas, medido

**Contexto.** O caminho do Codex nunca tinha rodado com o CLI real (os comentários do driver diziam "não
homologado"). No primeiro uso em produção, nove turnos seguidos de um bot terminaram com zero chamadas de
ferramenta: o bot respondia, mas dizia que "a ferramenta está indisponível" a cada pedido de acesso.

**Medido com o codex-cli 0.147.0 e o gpt-5.6-sol** (`scripts/sonda-codex-ferramentas.ts`):
- `features.code_mode_host=false`, que o nod passava para isolar, fazia toda chamada MCP falhar antes de chegar ao
  proxy. Nessa versão o modelo chama as ferramentas MCP por um trecho de código (`functions.exec`) que roda nesse host.
- Sem essa chave, o Codex cancelava a chamada sob `approval_policy="never"`. Com
  `default_tools_approval_mode = "approve"` no servidor `nod`, a chamada chega e o resultado volta.
- `--strict-config` com uma chave que a versão não conhece (`features.skip_host_skill_discovery` no 0.147.0) derrubava
  o turno antes do modelo, com código 1.

**Decisão.**
- O host de code mode fica ligado e o servidor `nod` é aprovado sem pergunta ao Codex. A decisão de rodar uma
  ferramenta continua sendo só do proxy do nod (modo de aprovação do bot, cartão na conversa).
- As chaves de isolamento passam a ser negociadas com a versão instalada, de graça, na sonda do driver. Cai o que a
  versão não conhece; `features.shell_tool`, `features.unified_exec`, as chaves fora de `features.*` e os campos
  obrigatórios do servidor não caem, e sem eles o Codex fica indisponível com o motivo dito à pessoa.
- O erro que o Codex devolve passa a ir para o diagnóstico do turno (`erroCru`). Antes era descartado.

**O que fica em aberto.** Visto de dentro (a segunda pergunta da sonda), o modelo ainda lista `collaboration.*`
(subagentes), apesar de `features.multi_agent=false`, e, no 0.147.0, as skills embutidas do Codex, porque a chave que
as escondia não existe nessa versão. Nenhum dos dois dá terminal, rede ou escrita fora do sandbox do turno, mas o
isolamento "só o proxy nod" não está provado para o Codex como está para o Claude. O laço de voz pelo app-server
(ADR-076) usa as mesmas chaves e continua sem homologação com o Codex real.

**Gatilho de reversão.** Se uma versão do Codex passar a dar arquivo ou rede ao código de `functions.exec`, o host
volta a ser desligado e o Codex sai do catálogo até haver outro caminho para as ferramentas MCP.

## Emenda (2026-10-06): a cota que o CLI informa é mostrada, nunca usada como gate (NOD-179)

**Contexto.** "Limites desta entrega" diz que o login não prova saldo nem cota. O Claude Code passou a informar a cota
a cada turno, de graça, no `rate_limit_event` do stream-json: quanto já foi usado na janela de 5 horas e na semana, e
quando cada uma renova. A pessoa não tinha como ver isso no nod sem rodar `/uso` (que no Codex nem existia).

**Decisão.**
- O driver do Claude Code entrega o último `rate_limit` do turno (`usoDoPlano` no resultado). O servidor valida
  pelo domínio (`usoDoPlanoValido`: utilização entre 0 e 1,5, horários plausíveis, harness igual ao que rodou o
  turno) e grava uma linha por pessoa e CLI (0056, `uso_do_plano`, com RLS). A leitura mais nova vence; dado
  inválido é descartado com log e a entrega segue.
- `GET /api/uso-do-plano` devolve só as linhas da pessoa, em dados crus; a tela formata no fuso dela (ADR-007) com
  `estadoDoMedidor`. A tela fica na NOD-12.
- **Nunca gate.** Nenhum turno é bloqueado, adiado ou desviado para outra IA por este número, nem perto do limite.
  O fim de cota continua sendo o erro do próprio fornecedor no turno (`limite_da_assinatura`, NOD-168).
- Sem ler credencial nem chamar API do fornecedor (ADR-015/019) e sem processo extra só para medir.
- `/uso` num bot de outra IA não vira `/cost`: responde "O uso do plano está em Seu espaço › Conexão."

**Gatilho de reversão.** Se o Claude Code deixar de mandar o `rate_limit_event` ou mudar o formato, a linha para de
ser atualizada (o `medido_em` envelhece) e a tela mostra a última leitura com a hora; nada no turno depende dela. Se
um dia o número virar critério de decisão, isso pede ADR nova, não esta emenda.

## Emenda (2026-10-06): fixado e indisponível recusa, limite do plano com motivo próprio (NOD-171)

**Harness fixado e indisponível.** O UAT de 2026-09-18 deixou a ressalva UX-01: no app do Mac, o bot fixado num harness
que o Mac não tinha pronto ficava com o turno pendente para sempre, e a negação falava em "motor pronto". Agora:
- `resolverHarness` diz qual harness faltou; o despacho recusa com o inventário dele, e a negação nomeia o harness e o
  estado (não instalado, sem conta conectada, desatualizado).
- A reivindicação recebe os harnesses prontos de todas as máquinas vivas da pessoa: o turno fixado num harness que
  nenhuma delas tem pronto é reivindicado e recusado, em vez de ficar pendente. Harness em `sonda_lenta` conta como
  "pode ficar pronto" e o turno espera a re-sonda.
- Modelo fora da lista vira `executor_indisponivel` com `modelo_invalido`, não `entrada_invalida`. A negação leva o
  `modelo` no payload e a tela pede outro modelo: a IA está pronta, então nunca diz que ela "já voltou".
- A repetição das falas barradas (`repetirBarradosPorIa`) não repete a fala fixada num harness que ainda não está
  pronto, para não gerar uma negação nova a cada anúncio do Mac.

**Limite do plano.** `limite_do_plano` entra no enum de motivos de falha (0058). No Claude Code ele vem do protocolo:
`rate_limit_event` com `status: "rejected"` na mesma rodada do `result`, com a hora em que o plano volta
(`limiteVoltaEm`); `isUsingOverage: true` não conta como limite. No Codex só existe texto (`usage_limit_reached`, "You've
hit your usage limit"), classificado em `limite_de_uso`. Nos dois casos a conversa ganha a mensagem de sistema com
`payload: { kind: "limite_do_plano", harness, voltaEm }`, e a tela diz quando volta (no Codex, "parece", porque a hora
não vem do protocolo). A prova é por
fixtures e CLI falso: não se leva uma conta ao limite de propósito.

**Lista editorial.** Só cresce: entra o modelo que o `model/list` do Codex real mostrou e que passou num turno real do
UAT (`docs/uat-harnesses-e-modelos.md`). Os padrões do automático (Sonnet e GPT-5.6 Sol) não mudaram.

**Gatilho de reversão.** Se a recusa imediata do fixado irritar mais que a espera (a pessoa estava instalando o CLI
naquele minuto), o caminho é estender o `sonda_lenta` a "instalando", não voltar à fila pendente sem aviso.
