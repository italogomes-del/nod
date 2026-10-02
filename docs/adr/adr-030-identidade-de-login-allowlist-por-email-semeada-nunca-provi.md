# ADR-030 — Identidade de login: allowlist por e-mail semeada, nunca provisionamento

**Status** novo · **Origem** E1.0 da Jornada 01 (LEA-7), decidido em 2026-09-16

## Decisão

Um login Google vira uma `pessoa` por **consulta**, nunca por criação. `pessoas` ganha a coluna
`email`, preenchida **só** pelo seed rodando como `nod_dono`. O callback do OAuth aceita a conta
quando, e só quando: `hd` = o domínio da organização, `email_verified = true` **e** o e-mail casa uma linha de
`pessoas`. Qualquer outra combinação recebe a MESMA recusa (sem distinguir "domínio errado" de "não
cadastrado", porque a diferença diria a quem está de fora quem tem acesso ao nod).

Admitir alguém no nod é uma linha no seed + deploy, deliberadamente. `nod_app` continua só com
`GRANT SELECT` em `tenants`/`pessoas`, e `pessoas` continua exceção nomeada no gate de RLS.

A allowlist é a fronteira de segurança; `hd` é defesa em profundidade. Mesmo que `hd` fosse
forjável, o atacante precisaria de um endereço do domínio já semeado.

A coluna é **single-valued** por decisão: alias de e-mail não é suportado; a pessoa entra pelo
endereço primário que o Google devolve no `id_token`. Suportar vários exigiria tabela
`pessoa_emails`, que é escopo maior.

### O login de desenvolvimento (stub) fica, trancado

O épico E1 dizia "o stub `marlon|ana` some". Revisto na aprovação do plano (2026-09-16): o perigo
nunca foi existir um login de mentira, e sim ele ser o único e poder ficar ligado onde não deve.
Ficou assim:

- `NOD_LOGIN` é obrigatório: `google` ou `stub`. Sem ele o servidor não sobe — o nod nunca escolhe o
  stub sozinho.
- Com `stub`, o servidor só escuta em loopback (a trava de `listen` continua valendo para o stub).
- O stub não tem mais nomes fixos: lista as pessoas do cadastro.
- Os testes nunca precisaram do stub: cunham o cookie direto (`cunharCookie`).

## Contexto

`pessoas` é só leitura para `nod_app` (`0001_fundacao.sql:30`) e é uma das três tabelas **sem RLS**
(`tests/conformidade/gate-rls.ts`). O ADR-021 já assumia "login Google Workspace restrito ao
domínio da organização"; o ADR-019 já proibia usar a identidade reportada pelo CLI para autorizar.

## Alternativas rejeitadas

### Provisionamento automático no callback

Exigiria uma de três coisas, todas piores: (1) `GRANT INSERT ON pessoas TO nod_app` — escrita numa
tabela sem RLS, sem predicado de tenant nem de pessoa, exatamente a superfície que o ADR-003 fecha
no resto do schema; (2) pôr `pessoas` sob `nod_escopar_tabela` — a dona da linha seria a pessoa que
ainda não existe, e `listarTodas` (fonte dos laços de fundo) quebraria; (3) credencial de `nod_dono`
no processo do servidor, contra o ADR-015(B). Além disso, `hd` autentica o domínio, não autoriza a
pessoa: conta de serviço, alias ou grupo do Workspace entrariam sem revisão humana.

## Gatilho de reversão

Reabrir o provisionamento se QUALQUER uma ocorrer:

1. mais de **4 deploys num trimestre** cujo único conteúdo seja adicionar pessoa ao seed;
2. mediana entre "entrou no time" e "consegue logar no nod" acima de **2 dias úteis**, medida em
   3 admissões consecutivas;
3. o evento de log `login_recusado` com `motivo: "sem_pessoa"` passar de **10 por semana**.

Se reaberto, a forma já está escolhida: rota administrativa autenticada por sessão de pessoa já
admitida, executando o INSERT por um caminho `nod_dono` isolado — **nunca** `GRANT INSERT` para
`nod_app`.

## Reversibilidade

Alta. A coluna é nullable e o mapeamento é uma consulta.

## Emenda (2026-10-02)

**Contexto.** O nod deixou de pressupor um único domínio Workspace fixo no código. Exigir um `hd`
específico amarrava o produto a uma organização e impedia o uso por quem não tem Workspace.

**Decisão.**
- A allowlist por e-mail no cadastro (`pessoas.email`) passa a ser a **única** exigência fixa. O
  princípio deste ADR não muda: login vira `pessoa` por consulta, nunca por criação, e toda recusa é
  a mesma resposta.
- `NOD_GOOGLE_DOMINIO` (opcional) restringe o login a um domínio Workspace: com ele, `hd` e o e-mail
  precisam ser desse domínio, e a regra original volta inteira.
- Sem domínio configurado, só entram contas em que o Google responde pelo e-mail: Gmail, ou e-mail do
  próprio domínio devolvido em `hd` (`googleEhAutoridade` em `src/adapters/http/sessao-google.ts`).
  Conta Google criada sobre um e-mail de terceiro não entra, porque o Google não é autoridade sobre
  aquele endereço.
- O e-mail do dono no seed vem de `NOD_SEED_EMAIL`; endereço de pessoa não fica no código. Vazio =
  sem login Google para ele.

**Consequência.** Sem `NOD_GOOGLE_DOMINIO`, a defesa em profundidade do `hd` some e a allowlist fica
sozinha como fronteira. Quem opera o nod para uma organização com Workspace deve configurar o domínio.
