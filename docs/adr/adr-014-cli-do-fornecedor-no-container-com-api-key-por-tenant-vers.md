# ADR-014 — CLI do fornecedor no container com API key por tenant, versão exata pinada, teste de fumaça e imagem do browser separada

**Frente** Execução · **Status** decidido · **Épicos** E10, E2, E4, E5, E9, E11

## Decisão

Executar o turno como processo filho do CLI do agente dentro do container, autenticado por ANTHROPIC_API_KEY do tenant, com --strict-mcp-config e --setting-sources project desde o primeiro dia. Três travas obrigatórias: (1) versão EXATA do CLI pinada no Dockerfile, nunca tag flutuante, para que rollback de imagem seja rollback de verdade; (2) teste de fumaça no CI que roda um turno real contra a imagem construída antes de promover; (3) tabela de flag floors copiada desde o começo. A imagem do browser (E11) é SEPARADA da imagem base. Diretório de trabalho por TURNO, apagado ao fim.

## Contexto

E10.3 exige chave por tenant com ambiente do executor começando vazio. A rodada anterior deixou 'CLI vs API direta' em aberto porque parecia que CLI implicava assinatura e login interativo — o código desfaz isso.

## Alternativas rejeitadas

### API direta (fetch contra /v1/messages), reescrevendo o loop de agente

O custo está medido nos dois repos. No OpenMausBot: openai-chat.ts (543 linhas) + openai-chat-protocol.ts + chat-mcp-tools.ts (303) + chat-tool-approval.ts (46) + mcp-bridge.ts (363) + permission-proxy.ts (246) — ~1.600 linhas só para chegar a um agente com ferramentas e aprovação. No Buzz: agent.rs (1874) + llm.rs (7973) + mcp.rs (1222) + permission.rs (1047), ~27.400 no crate. E o resultado é mais pobre: as capabilities do driver de API direta (openai-chat.ts:509) são quatro; o driver de CLI (claude.ts:1964-1979) declara onze. Para 2-3 engenheiros, é o loop de agente virando produto secundário.

### ACP (JSON-RPC por stdio) como no Buzz

É um CLI por baixo do mesmo jeito (crates/buzz-acp/src/acp.rs:457 faz tokio::process::Command::new), então não economiza imagem nem versionamento — só troca o protocolo, e custa uma camada de negociação (initialize, session/new, session/prompt) para manter.

### Box / cloud computer rodando o agente fora do container

boxagent.ts:294 devolve 'unavailable' para toda pergunta de aprovação, o que mata E4 e E5 na origem. E exige exportar a chave da Leapy para dentro de servidor de terceiro (box.ts:779).

### CLI por tag flutuante, confiando no rollback do PaaS

O rollback da imagem não reverte o CLI, e a tabela CLAUDE_FLAG_FLOORS (claude.ts:288-291) prova que a degradação não é graciosa: 'uma flag desconhecida é um erro de argumento duro, então passá-la a um CLI antigo falharia TODO turno em vez de degradar'. --strict-mcp-config exige 1.0.60, --setting-sources exige 1.0.122, --autocompact exige 2.1.122. Erro total, não parcial.

## Evidência

A favor do CLI: server/drivers/claude.ts:185 preserva ANTHROPIC_API_KEY quando vem do ambiente da instância e só apaga a herdada do pai, com o comentário em claude.ts:182-184 explicando que uma chave 'riding along in the parent's env' viraria cobrança que o usuário nunca autorizou. docs/self-hosting.md:300-305: com chave de workspace salva, 'todo bot Claude roda nela', o custo vai para o ledger e 'ninguém precisa fazer login'. CLI e chave por tenant são EIXOS INDEPENDENTES. Isolamento: claude.ts:1108-1109 passa --strict-mcp-config e --setting-sources project, e inheritsUserConfig (claude.ts ~196) existe como escotilha — por padrão o bot NÃO herda MCP, skills, hooks nem CLAUDE.md. Custo de imagem: o Dockerfile instala ~30 bibliotecas Chrome via apt mais agent-browser pinado em DOIS lugares (o comentário diz 'Pin here and in server/browser-engine-release.ts together') — quatro eixos de versão independentes.

## Consequências

- Herdamos skills, MCP e hooks do ecossistema de graça, mas herdamos a superfície de configuração que precisa ser fechada. Sem --strict-mcp-config e --setting-sources project, o agente lê configuração do container inteiro e o isolamento de E2 é ficção.
- As ~30 libs Chrome só existem para E11, que é o épico mais adiável e bloqueado juridicamente (E11.5). Carregá-las na imagem que roda a fila de E3 faz todo deploy da fila pagar o download do Chrome.
- O CLI é processo de terceiro com filesystem próprio que recebe dado de aprendiz. --strict-mcp-config impede LER config; não impede ESCREVER transcrição, cache ou log de crash. Daí o diretório de trabalho por turno, apagado ao fim — não confiar no restart do PaaS para limpar. Telemetria do CLI desligada por variável na allowlist do ADR-015.
- Cada turno consome memória e descritores: teto de turnos simultâneos por container vira parâmetro de capacidade.
- E10.2 exige que o terceiro provedor em diante seja um INSERT, não um deploy. Isso só é compatível com CLI pinado se o catálogo tiver DOIS níveis: motor global (tenant_id nulo) pode exigir binário e portanto deploy; motor de cliente (tenant_id preenchido) é sempre HTTP/API, com o campo de comando de instalação forçado a vazio por constraint — que é exatamente o que E10.2 já pede.
- Sobra tempo de engenharia para o que é o produto (fila, aprovação tipada, trilha) em vez de para o loop de agente.

## Reversibilidade

média — o SPI (ADR-012) é o que torna isso reversível: trocar CLI por API direta é escrever um novo ProviderAdapter, não refazer o servidor. O que NÃO é reversível barato é o que a UI passar a assumir das capabilities do CLI: se ela já expõe steering mid-turn e effort, um driver de API direta chega sem eles e a regressão é visível para o cliente.

## Revisitar quando

Três sinais: uma atualização do CLI quebrar turnos em produção mais de uma vez em seis meses; cold start começar a doer no relógio da fila; ou surgir motor sem CLI (modelo brasileiro, endpoint de cliente). O terceiro não pede troca — pede um segundo driver ao lado.

