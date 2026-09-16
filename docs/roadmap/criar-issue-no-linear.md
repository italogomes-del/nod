# Criar issue no Linear (esteira Linear → Cursor → gstack)

Como transformar uma issue de `docs/roadmap/<jornada>/issues.md` numa task do Linear que entra na
esteira automática. Direto, em checklist. Vale para humano e para agente com a ferramenta do Linear.

> **Restrição:** só crie tasks de jornadas cuja pasta tenha `office-hours.md`. Sem ele, a Descoberta
> da trilha `produto` devolve a task para Todo. Hoje só a **jornada-01** está pronta; a jornada-02
> ainda está em arquivos soltos, fora de pasta.

## 1. Em 30 segundos

- [ ] Confirme que a pasta da jornada tem `office-hours.md`.
- [ ] Procure no projeto **Nod** uma task com o mesmo **ID no título** — se existe, pare (não duplique).
- [ ] Crie no time **Leapy**, projeto **Nod**, status **Todo**, responsável = a pessoa dona (humano).
- [ ] Título: `<ID> — <título da issue>` (sem `[US]`/`[Issue]`).
- [ ] Labels: exatamente **uma** `jornada-NN` + exatamente **uma** de `trilha` (tabela §3).
- [ ] Descrição: cópia fiel do bloco da issue, no modelo do §4.
- [ ] Para cada "Depende de", crie a relação **blocked by** apontando para a task já criada.
- [ ] Anote `Linear: LEA-123` no `issues.md`, abaixo do cabeçalho da issue.

Crie as tasks **na ordem de dependência** do `issues.md` (a bloqueadora antes da bloqueada).

## 2. Campos

| Campo | Valor |
|---|---|
| Time | **Leapy** (chave LEA) |
| Projeto | **Nod** |
| Status | **Todo** — SEMPRE. As automações disparam na *mudança* de status; nunca crie direto em Descoberta/Planejamento/Pronto para Dev/Verificação. |
| Título | `<ID> — <título da issue>`, igual ao cabeçalho do `issues.md`, sem `[US]`/`[Issue]`. O ID liga a task à issue; o agente da Descoberta procura por ele. |
| Labels | uma `jornada-NN` (= nome da pasta) + uma `trilha` (§3). |
| Responsável | a pessoa dona da task (humano). Não delegar para agente na criação. |
| Descrição | cópia fiel do bloco da issue (§4). |
| Relações | `blocked by` para cada "Depende de". |

## 3. Qual trilha usar

Uma label do grupo `trilha`, escolhida por esta tabela. Na dúvida entre duas, use a **mais completa**.

| A issue é… | trilha | Caminho na esteira |
|---|---|---|
| `[US]`: valor direto para uma persona | `produto` | Descoberta (/spec) → Revisar descoberta → Planejamento (/autoplan) → Revisar plano → Pronto para Dev → Verificação |
| `[Issue]` de decisão (entregável = ADR) | `produto` | idem; passa pelas revisões humanas |
| `[Issue]` enabler técnico com costuras e aceite claros | `eng` | Planejamento → Revisar plano → Pronto para Dev → Verificação |
| mudança visível de interface | `design` | como eng, com revisão de design |
| bug | `investigação` | Descoberta (/investigate) → Revisar descoberta → Pronto para Dev → Verificação |
| ajuste trivial (texto, config, <~10 linhas) | `simples` | Pronto para Dev → Verificação |

## 4. Modelo de descrição

Copie o bloco da issue nesta ordem (omita seções que não existem na issue):

```markdown
> <User story, quando for [US]>

**Contexto/porquê:** <2-3 linhas + ADRs que estende/reverte>

**Costuras:** <arquivos e funções concretos>

**Escopo / Fora de escopo:** <a linha vermelha>

**Aceite = o teste:** <qual teste, em qual modo: unit / integration / conformidade / concurrency>

**Depende de:** <issues anteriores>

**Fonte:** docs/roadmap/<jornada>/issues.md#<âncora-da-issue>
```

## 5. Exemplo completo — E1.2 (pronta para criar)

- **Título:** `E1.2 — Entrar no nod com minha conta Google da Leapy`
- **Labels:** `jornada-01`, `produto` (é `[US]`)
- **Status:** Todo · **Responsável:** dono humano da task
- **Relação:** *blocked by* `LEA-…` (a task da E1.1)
- **Descrição:**

```markdown
> Como colaborador da Leapy, quero entrar no nod pelo navegador com minha conta Google Workspace
> (@leapy.com.br), para que minha sessão e minha autoria sejam realmente minhas — não o stub marlon/ana.

**Contexto/porquê:** substitui POST /api/sessao/entrar {pessoa} pelo OAuth Google. O callback valida
hd=leapy.com.br + e-mail verificado, mapeia e-mail → pessoa (E1.1) e cunha o mesmo cookie assinado
{tenantId, pessoaId} que já existe (cunharCookie).

**Costuras:** src/adapters/http/sessao.ts (novo handler OAuth + callback), roteador.ts (rota pública),
reusa cunharCookie/lerCookieSessao.

**Escopo / Fora de escopo:** e-mail de outro domínio ou não-mapeado → 403 (recusa, não provisiona).
Não emite token de máquina (E1.3), não abre NOD_HOST (E1.5). O stub marlon/ana coexiste atrás de flag
até E1.6.

**Aceite = o teste:** tests/integration — callback simulado com e-mail Leapy mapeado cunha cookie
válido; e-mail de outro hd → 403; e-mail sem pessoa → 403.

**Depende de:** E1.1.

**Fonte:** docs/roadmap/jornada-01/issues.md#e12--us-entrar-no-nod-com-minha-conta-google-da-leapy
```

## 6. Criando via agente (ferramenta do Linear)

Chamada de criar issue:

```
team:        "Leapy"
project:     "Nod"
state:       "Todo"
title:       "E1.2 — Entrar no nod com minha conta Google da Leapy"
description: <o markdown do §4/§5>
labels:      ["produto", "jornada-01"]      # uma trilha + uma jornada
assignee:    <a pessoa dona da task>
blockedBy:   ["LEA-…"]                        # os IDs das "Depende de" já criadas
```

Antes: procure no projeto Nod um título com o mesmo ID (não duplique). Depois: atualize o `issues.md`
com `Linear: LEA-123` logo abaixo do cabeçalho da issue.

## 7. Pôr na esteira

Só mova a task para fora de Todo **quando todas as bloqueadoras estiverem em Done**. Mova para o
**primeiro** status da trilha:

| trilha | Primeiro status |
|---|---|
| `produto`, `investigação` | Descoberta |
| `eng`, `design` | Planejamento |
| `simples` | Pronto para Dev |

Nos status **Revisar descoberta** e **Revisar plano** a esteira espera um humano: responda nos
comentários e mova para o próximo status.
