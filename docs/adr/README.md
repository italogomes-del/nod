# Decisões de arquitetura

Cada arquivo é um ADR: uma decisão, o que mudou, e por quê.

**Regra do gatilho (desde 2026-09-16):** todo ADR decidido contra uma alternativa razoável traz uma seção **Gatilho de reversão** com condições VERIFICÁVEIS (número, evento, medição) que provariam o erro. Sem gatilho, um ADR só pode ser reaberto por opinião — que é o que este diretório existe para evitar. Refinamentos ganham seção própria datada, nunca reescrevem a decisão original.

> Revisados em bloco quando o nod deixou de ser SaaS B2B e virou **ferramenta interna** da Leapy,
> com o executor rodando na máquina de cada pessoa. Ver [a revisão completa](../internal-first.md).

| | Decisão | Status |
|---|---|---|
| [ADR-001](adr-001-modo-do-pooler-tamanho-do-pool-e-politica-de-deploy.md) | Modo do pooler, tamanho do pool e política de deploy | mantido |
| [ADR-002](adr-002-classificacao-de-dado-pessoal-por-origem-funcao-pura-def.md) | Classificação de dado pessoal por ORIGEM, função pura, default fechado | mantido |
| [ADR-003](adr-003-isolamento-em-duas-camadas-rls-restritiva-force-predicad.md) | Isolamento em duas camadas: RLS restritiva FORCE + predicado explícito, SET LOCAL por transação | revisado |
| [ADR-004](adr-004-trilha-imutavel-por-trigger-sem-texto-livre-prosa-em-tab.md) | Trilha imutável por TRIGGER, sem texto livre, prosa em tabela irmã apagável | mantido |
| [ADR-005](adr-005-uma-tabela-events-para-fluxo-tabelas-de-dominio-para-est.md) | Uma tabela events para fluxo + tabelas de domínio para estado com regra | mantido |
| [ADR-006](adr-006-particionar-events-por-tempo-sem-catch-all.md) | Particionar events por tempo, sem catch-all | revisado |
| [ADR-007](adr-007-a-fila-global-le-por-pessoa-sob-rls-item-vencido-em-cinz.md) | A fila global lê por PESSOA sob RLS, item vencido em cinza, servidor é fonte da verdade do tempo | mantido |
| [ADR-008](adr-008-busca-tsvector-portuguese-unaccent-com-allowlist-positiv.md) | Busca tsvector portuguese + unaccent com allowlist positiva | revisado |
| [ADR-009](adr-009-classificar-falha-de-turno-pelo-estado-de-protocolo-quat.md) | Classificar falha de turno pelo ESTADO DE PROTOCOLO, quatro sinais booleanos | revisado |
| [ADR-010](adr-010-fila-por-conversa-no-postgres-prazo-absoluto.md) | Fila por conversa no Postgres, prazo absoluto | revisado |
| [ADR-011](adr-011-travas-de-execucao-janela-de-rotina-unica-expiracao-idem.md) | Travas de execução: janela de rotina única, expiração idempotente | revisado |
| [ADR-012](adr-012-spi-de-tres-camadas-driver-instance-adapter.md) | SPI de três camadas Driver / Instance / Adapter | revisado |
| [ADR-013](adr-013-o-proxy-mcp-e-o-ponto-de-decisao-do-produto.md) | O proxy MCP é o ponto de decisão do produto | revisado |
| [ADR-014](adr-014-cli-do-fornecedor-dois-executores.md) | CLI do fornecedor: dois executores | invertido |
| [ADR-015](adr-015-credenciais-dois-regimes-opostos.md) | Credenciais: dois regimes opostos | revisado |
| [ADR-016](adr-016-sse-com-frames-numerados-buffer-de-replay-por-pessoa.md) | SSE com frames numerados, buffer de replay por PESSOA | revisado |
| [ADR-017](adr-017-um-container-metricas-ligadas-a-promessa-de-produto-alar.md) | Um container, métricas ligadas a promessa de produto, alarme externo | revisado |
| [ADR-018](adr-018-core-puro-guardado-pelo-compilador-pacote-unico.md) | Core puro guardado pelo compilador, PACOTE ÚNICO | revisado |
| [ADR-019](adr-019-a-sonda-de-disponibilidade-pergunta-ao-cli-nunca-le-a-cr.md) | A sonda de disponibilidade pergunta ao CLI, nunca lê a credencial | revisado |
| [ADR-020](adr-020-distribuicao-app-local-primeiro-web-obrigatoria-um-so-ad.md) | Distribuição: app local primeiro, web obrigatória, um só ADR | invertido |
| [ADR-021](adr-021-a-ponte-de-execucao-o-app-local-puxa-o-servidor-nunca-di.md) | A ponte de execução: o app local puxa, o servidor nunca disca | novo |
| [ADR-022](adr-022-a-localidade-do-turno-e-resolvida-por-regra-declarativa.md) | A localidade do turno é resolvida por regra declarativa, nunca escolhida pelo agente | novo |
| [ADR-023](adr-023-autoria-composta-todo-evento-carrega-quem-escreveu-e-sob.md) | Autoria composta: todo evento carrega quem escreveu e sob procuração de quem | novo |
| [ADR-024](adr-024-o-plano-de-turno-e-o-primitivo-do-nod-emitido-pelo-servi.md) | O plano de turno é o primitivo do nod, emitido pelo servidor e consumido pelo proxy | novo |
| [ADR-025](adr-025-quem-pede-e-quem-paga-sao-dois-campos-distintos-da-autor.md) | Quem pede e quem paga são dois campos distintos da autoria composta | novo |
| [ADR-026](adr-026-a-marca-de-nao-confiavel-e-propriedade-do-conteudo-carre.md) | A marca de não-confiável é propriedade do conteúdo, carregada no envelope | novo |
| [ADR-027](adr-027-sala-de-conversa-tem-visibilidade-propria-membership-e-g.md) | Sala de conversa tem visibilidade própria; membership é grant, não herança | novo |
| [ADR-028](adr-028-a-fronteira-do-proxy-e-a-fronteira-dos-mecanismos-de-pro.md) | A fronteira do proxy é a fronteira dos mecanismos de produto | novo |
| [ADR-029](adr-029-fail-closed-exige-estado-renderizado-nao-negacao-seca.md) | Fail-closed exige estado renderizado, não negação seca | novo |
| [ADR-030](adr-030-identidade-de-login-allowlist-por-email-semeada-nunca-provi.md) | Identidade de login: allowlist por e-mail semeada, nunca provisionamento | novo |
| [ADR-031](adr-031-a-chave-de-maquina-persiste-carrega-o-proprio-escopo-e-e-rev.md) | A chave de máquina persiste, carrega o próprio escopo e é revogável | novo |
| [ADR-032](adr-032-primeira-versao-bots-como-contatos.md) | Bots como contatos e colaboração visível | novo |
| [ADR-033](adr-033-criacao-conversacional-marketplace-intervalos.md) | Criação conversacional, Marketplace e intervalos | novo |
| [ADR-034](adr-034-gestao-e-exclusao-recuperavel-de-agentes.md) | Gestão e exclusão recuperável de agentes | novo |
