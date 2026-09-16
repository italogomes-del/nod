# ADR-019 — A sonda de disponibilidade pergunta ao CLI, nunca lê a credencial

**Status** decidido · **Origem** perguntas sobre alvos de distribuição e execução local

## Decisão

O nod NUNCA inspeciona Keychain, arquivo de token ou variável de ambiente para decidir se um fornecedor está autenticado. A única fonte de verdade é o comando machine-readable do próprio CLI (`claude auth status --json`, `cursor-agent status --format json`, `codex login status`), executado com timeout curto e buffer limitado, do qual saem apenas campos de EXIBIÇÃO sanitizados. Três regras acopladas: (1) presença de variável de ambiente NUNCA é prova de autenticação — a sonda valida com uma chamada real; (2) a identidade que o CLI reporta (email, organização) é cosmética e é PROIBIDA para autorização no produto, que vem só do tenant sob RLS do ADR-003; (3) o contrato de snapshot tem três estados distintos — { state, reason, authenticated } — e existe um gate pré-spawn que recusa o turno com motivo tipado antes de gastar qualquer coisa.

## Contexto

O ADR-014 já pôs o CLI do fornecedor no container com chave por tenant, mas não disse COMO o produto decide que uma credencial serve. Essa decisão parece trivial e tem um histórico de erro caro em código real. Além disso, a pergunta 3 do Marlon ('o app web alcança o modelo local?') expôs que a experiência de 'nem precisei autenticar' do OpenMausBot é herança de processo, não descoberta — e que o nod hospedado não a terá.

## Alternativas rejeitadas

### Ler o arquivo de credencial do fornecedor (~/.claude/.credentials.json e equivalentes)

É exatamente o erro que o OpenMausBot cometeu e reverteu. O teste em server/drivers/claude.test.ts:2409-2411 documenta o issue #108: a versão que lia o arquivo reportava usuários LOGADOS como deslogados, porque no macOS o token OAuth mora no Keychain do login, não em arquivo. O comentário acima de claudeAuthStatus em claude.ts:63 registra a decisão de não inspecionar: a credencial pode estar no Keychain, num JSON, ou em backends futuros.

### Insistir na leitura de arquivo com múltiplos nomes candidatos

O driver do Factory droid (server/drivers/acp/droid.ts:25-43) faz isso e mostra o preço: três nomes (auth.v2.file, auth.v2.loginkeychain, auth.v2.keyring) descobertos por engenharia reversa do binário 0.196.0, e o próprio comentário admite que checar um só 'reports a fresh signed-in login as logged out'. Com 2-3 engenheiros não há orçamento para manter engenharia reversa de credenciais de três fornecedores.

### Aceitar a presença de variável de ambiente como prova (o atalho do Cursor)

probeCursorAuth retorna true se CURSOR_API_KEY estiver preenchida, sem validar nada. Uma chave expirada, revogada ou com typo passa no snapshot como autenticada, a UI mostra verde, e a falha só aparece dentro do turno. No OpenMausBot isso é caso raro; sob o ADR-014, onde TODA autenticação é por chave, vira o caso ÚNICO.

### Construir sign-in por PKCE colado à mão, como o ClaudeLoginController

400+ linhas de captura de link por pipe, com implicações jurídicas que o próprio cabeçalho do arquivo enumera, e sem equivalente para o Cursor (lá é API key ou nada). Escopo demais para um time começando do zero, e desnecessário quando a chave é por tenant.

## Evidência

server/drivers/claude.ts:62-95 (claudeAuthStatus: exec de `claude auth status --json`, timeout 8000ms, maxBuffer 65536, exige status.loggedIn === true, descarta o erro do processo, extrai só email/orgName/authMethod com sanitização); o comentário em claude.ts:55-60 declarando que a credencial não é inspecionada; server/drivers/claude.test.ts:2409-2411 documentando o issue #108; server/drivers/acp/droid.ts:25-43 (o contra-exemplo dos três nomes de arquivo); server/drivers/acp/cursor.ts (o atalho de env var sem validação); server/contracts.ts:370-380 (o contrato de snapshot); src/components/EngineSetup.tsx:31 e :36 (as duas linhas que separam needsSignIn de needsCli); server/drivers/acp/core.ts:451-459 (gate pré-spawn com stopReason 'auth_required').

## Consequências

- A UI consegue oferecer o botão certo em vez de uma mensagem genérica, porque 'imagem sem CLI' e 'chave do tenant inválida' são estados diferentes com ações diferentes.
- Nenhum turno é cobrado por uma credencial que já se sabia inválida — o gate recusa antes do spawn, com motivo tipado que entra na trilha do ADR-004.
- O produto fica dependente de um contrato não-versionado com um binário de terceiro: se o fornecedor renomear o campo ou passar a imprimir banner antes do JSON, todos os tenants ficam 'deslogados' ao mesmo tempo. A mitigação obrigatória é um teste de contrato contra o binário REAL no CI, não contra um fake — o pin de versão do ADR-014 sozinho apenas congela o problema até o upgrade obrigatório.
- Trocar de conta no CLI nunca muda permissão no produto, porque autorização vem só do tenant. Sem essa regra escrita, alguém liga as duas identidades e cria escalada de privilégio.
- A sonda é cara (execução externa com timeout), então precisa de cache com TTL curto invalidado por evento desde o primeiro dia — barato agora, caro depois que a UI assumir leitura síncrona.

## Reversibilidade

Alta. É uma função de sonda atrás do SPI do ADR-012; trocar a fonte de verdade é mudar uma implementação de Driver. O que é caro de reverter é a regra de identidade — se email do CLI virar chave de autorização em algum lugar, desentrelaçar isso depois é migração de permissão, não refatoração.

## Revisitar quando

Quando um fornecedor passar a oferecer um endpoint de validação de chave de verdade (aí a sonda deixa de ser exec e vira HTTP); quando o teste de contrato quebrar no CI por mudança de formato do CLI; ou quando aparecer a primeira proposta de usar a identidade do fornecedor para qualquer decisão de permissão — nesse dia, a conversa é sobre este ADR.

