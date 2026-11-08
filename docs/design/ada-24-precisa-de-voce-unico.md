# ADA-24 · Um único "Precisa de você"

Pergunta e aprovação moram na tarefa e em Sua vez.

- Protótipo: https://gamefik.github.io/nod-prototipos/ada-24/
- Tarefa: 441bbad6-f4b9-4f6c-8e62-edf40284720d (quadro da Ada)
- Relacionadas: ADA-28 (Sua vez/linha discreta), ADA-25, ADA-6, ADA-15 (fora do escopo)

## O problema

Hoje uma tarefa que precisa do Marlon gera até três coisas soltas:

- a decisão de `pedir_a_pessoa` ou `pedir_aprovacao`, como cartão no chat;
- o balão "Preciso de você no quadro" (status `voce`, em quadro.ts:491-509);
- a tarefa na coluna Precisa de você.

Sua vez só lê decisões (listar-sua-vez.ts), então uma tarefa movida à mão para Precisa de você não aparece lá. Responder num lugar não fecha o outro.

## A proposta

Dentro de uma tarefa, os três mecanismos viram uma decisão só, ligada à tarefa. A mesma decisão aparece:

- na tarefa (bloco "Precisa de você");
- em Sua vez (item com as mesmas ações);
- no chat, só como uma linha discreta com link, sem cartão duplicado.

Responder em qualquer um resolve todos. No chat livre, sem tarefa, nada muda.

## Telas (canvas)

| Jornada | Telas | O que mostra |
|---|---|---|
| J1 · Pergunta numa tarefa | #J1-0 hoje, #J1-1 a #J1-6 | Linha discreta no chat, a tarefa no quadro, item em Sua vez, a resposta e Sua vez vazia de novo, a tarefa com "respondida", a linha com ✓ |
| J2 · Aprovação de efeito externo | #J2-1 a #J2-4 | A aprovação na tarefa (o efeito à vista: Gmail · enviar e-mail · anexo), aprovou, Sua vez, a linha com ✓ |
| J3 · Responder pelo chat | #J3-1 a #J3-4 | Caixa "Respondendo à NOD-510", a resposta com "↩ respondendo", o chat livre sem mudança, a tarefa atualizada |
| J4 · Movida à mão | #J4-1 | NOD-507 em Precisa de você sem pergunta entra em Sua vez só com "Abrir a tarefa" |
| J5 · Estados | #J5-1 vazio, #J5-2 já respondida, #J5-3 erro | Sua vez vazia, "já respondida na tarefa" sem ação, erro com "Tentar de novo" |

A história é a NOD-510 "Exportar o quadro em CSV" (Xumbrega).

- **Pergunta:** "O CSV leva as tarefas arquivadas também? São 312 a mais que as 41 ativas." Opções: Só as ativas (recomendada) ou Todas.
- **Aprovação:** "Mando o CSV de outubro para financeiro@engnod.com.br?"

## Decisões para o Marlon

- **D1. Onde mora a aprovação de efeito externo.** Dentro de uma tarefa, mora na tarefa e em Sua vez, com só a linha no chat. No chat livre, o cartão continua no chat (e em Sua vez). **Recomendado.**
- **D2. Uma decisão só.** `status voce` com pergunta, `pedir_a_pessoa` e `pedir_aprovacao` viram a mesma decisão ligada à tarefa. O balão "Preciso de você no quadro" sai do chat e vira a linha. Uma tarefa em Precisa de você sem pergunta também entra em Sua vez, só com "Abrir a tarefa".
- **D3. Responder pelo chat.** "Responder" na linha abre a caixa "Respondendo". Texto livre resolve quando só uma decisão combina.
- **D4. Corrida.** A primeira resposta vence. Os outros lugares mostram "já respondida em X", sem ação, e o efeito roda uma vez.
- **D5. Prazo.** Decisão de tarefa não vence em 24 h enquanto a tarefa estiver em Precisa de você.
- **D6. Erro.** O item fica aberto com "Tentar de novo" e nada é executado.

## Conferido no código (C)

- A decisão já tem `turnoId` e prazo de 24 h (`PRAZO_DECISAO_MS`).
- listar-sua-vez.ts já busca `trabalhosDosTurnos` (NOD-114), então a ligação decisão → tarefa existe pelo turno.
- `pedir_a_pessoa` cria a decisão e a mensagem `pedido_a_pessoa`; `pedir_aprovacao` cria a decisão "aprovacao".
- `status voce` passa por `quadro.responder` e manda o aviso "Preciso de você no quadro".
- A caixa "Respondendo" reaproveita o markup real de pergunta.ts:142.

## Suposições (S)

1. Há um campo de mensagem embaixo de Sua vez.
2. Texto livre com duas decisões abertas faz o bot perguntar qual delas.
3. O item respondido some de Sua vez ao sair da tela.
4. Uma tarefa cancelada ou movida para fora de Precisa de você fecha a decisão com "fechada: a tarefa saiu de Precisa de você".

---

## Revisão de design (/plan-design-review)

Esta frente não tem quem responda às perguntas da skill, porque é uma sessão sem pessoa. Por isso, em cada achado foi escolhida a opção recomendada, registrada abaixo como auto-decisão. O Marlon aprova ou corrige tudo na tarefa.

- **Classificação:** OPERATE (UI de app). Sem DESIGN.md no repo; o vocabulário vem dos tokens do nod (`--ink`, `--ink-2`, `--ink-3`, `--line`, `--line-strong`, `--signal`, `--danger`, `--surface`) e dos componentes das ADA-28/25/6.
- **Nota inicial:** 6/10. A ADA-28 já resolvia a aprovação numa tarefa; faltavam a pergunta, a tarefa movida à mão, a resposta pelo chat e os estados.

### Pass 1 · Arquitetura da informação: 7 → 9

O que se vê primeiro em cada lugar:

- **chat:** a linha "NOD-510 precisa de você · Responder · Abrir";
- **tarefa:** o bloco Precisa de você no topo, com a pergunta e as opções;
- **Sua vez:** o item com o título da tarefa, a pergunta e as ações.

```
Chat ───────── linha discreta ──┐
Tarefa ─────── bloco no topo ───┼── mesma decisão (id) ── resolve tudo
Sua vez ────── item com ações ──┘
```

**Achado:** o contador de Sua vez na lateral não acompanhava os itens (sempre 3).

**Auto-decisão:** o contador reflete o número real em cada tela (4, 3, 3, 3, 4, 0). Aplicado.

### Pass 2 · Estados: 5 → 9

| Superfície | Vazio | Erro | Sucesso | Parcial |
|---|---|---|---|---|
| Sua vez | "Nada esperando você" (uma vez, sem ponto azul), EngNod "1 bloqueada" | Sinal de 6px `--danger`, "Não consegui mandar. Nada foi enviado." + Tentar de novo | O item sai ao sair da tela (S3) | Tarefa sem pergunta: só "Abrir a tarefa" |
| Tarefa | Sem o bloco | Igual ao de Sua vez | "Respondida por você · Só as ativas" | "Já respondida em Sua vez" em `--ink-3`, sem ação |
| Linha no chat | Não existe | Igual ao de Sua vez | ✓ + resposta | "Já respondida" |

O carregamento usa o padrão do app (sem esqueleto novo).

**Achado:** o estado vazio repetia "nada esperando você" duas vezes, mantinha o ponto azul e o EngNod ainda dizia "1 precisa de você".

**Auto-decisão:** uma frase só, sem o ponto, e a contagem do EngNod corrigida. Aplicado.

### Pass 3 · Jornada e emoção: 7 → 8

| Passo | O usuário faz | O usuário sente | O que sustenta |
|---|---|---|---|
| 1 | Vê a linha no chat | "Tem algo meu, mas não é urgente" | Linha discreta, sem cartão gritando |
| 2 | Abre Sua vez | "Está tudo aqui" | Pergunta e aprovação juntas com a tarefa |
| 3 | Responde | "Resolvido de uma vez" | Os outros lugares fecham sozinhos (D4) |
| 4 | Aprova um envio | "Sei o que vai sair" | O efeito à vista: app, ação e anexo |

O ganho de 5 anos é parar de caçar a mesma pendência em três lugares.

**Pendência:** a ordem dos itens em Sua vez fica fora do escopo.

### Pass 4 · Risco de AI slop: 8 → 9

- Sem grade de cards: os itens são mensagens em lista.
- Sem fundo chapado, botões só em contorno ou texto.
- Uma cor de sinal, input em pílula embaixo.
- Nenhuma rejeição dura.
- **Litmus:** produto reconhecível SIM, âncora visual SIM (o bloco Precisa de você), cards necessários SIM (cada item é a interação), sem sombras decorativas SIM.

**Achado:** o avatar "Você" usava o mascote da Ada.

**Auto-decisão:** anel EU (`qd-anel qd-anel-voce`, 20px). Aplicado.

### Pass 5 · Design system: 8 → 9

Componentes novos:

- `a24-linha-ativa` (pílula com inset 1px `--line-strong`);
- `a24-ja` (`--ink-3`);
- `a24-erro-sinal` (6px `--danger`);
- `a24-vazio`.

Todos usam tokens existentes. A caixa Respondendo e a linha discreta vêm da ADA-28 e do código.

**Pendência:** não há DESIGN.md no repo. Fica como dívida conhecida, fora desta tarefa.

### Pass 6 · Responsivo e acessibilidade: 6 → 7

O canvas foi conferido em 1440 e 390 (o QA do canvas roda as duas larguras). Outros pontos:

- As ações são texto com alvo mínimo de 32px na versão de computador.
- O estado de erro não depende só de cor: tem texto e sinal.
- "Já respondida" usa texto e não só cinza.

**Pendência:** o layout no celular segue a ADA-28 e está fora desta versão. Foco por teclado e `aria-live` no item que fecha ficam para a implementação.

### Pass 7 · Decisões em aberto

As decisões D1–D6 vão ao Marlon, com a recomendação marcada. As suposições S1–S4 dependem de validar com ele ou com o tech lead.

### Fora do escopo

Celular (segue a ADA-28), notificação push, ordem de Sua vez e a ADA-15.

### O que já existe

- Sua vez e a linha discreta (ADA-28).
- Os componentes de tarefa e de quadro (ADA-25 e ADA-6).
- A decisão com `turnoId` e `trabalhosDosTurnos`.

### Tarefas de implementação

- [ ] **T1 (P1)** Ligar a decisão à tarefa e fazer Sua vez listar também as tarefas em Precisa de você sem decisão (listar-sua-vez.ts).
- [ ] **T2 (P1)** Dentro de uma tarefa, trocar o cartão e o balão "Preciso de você no quadro" pela linha discreta (quadro.ts:491-509, pergunta.ts).
- [ ] **T3 (P1)** Resolução única: a primeira resposta vence, os outros lugares mostram "já respondida em X" e o efeito roda uma vez.
- [ ] **T4 (P2)** Prazo de 24 h suspenso enquanto a tarefa estiver em Precisa de você; fechar a decisão quando a tarefa sair dela.
- [ ] **T5 (P2)** Estado de erro com Tentar de novo; foco por teclado e `aria-live`.

```
+====================================================================+
|         DESIGN PLAN REVIEW — COMPLETION SUMMARY                    |
+====================================================================+
| System Audit         | sem DESIGN.md; tokens do nod; UI de app     |
| Step 0               | 6/10, foco em estados e na resposta pelo chat|
| Pass 1  (Info Arch)  | 7/10 → 9/10                                 |
| Pass 2  (States)     | 5/10 → 9/10                                 |
| Pass 3  (Journey)    | 7/10 → 8/10                                 |
| Pass 4  (AI Slop)    | 8/10 → 9/10                                 |
| Pass 5  (Design Sys) | 8/10 → 9/10                                 |
| Pass 6  (Responsive) | 6/10 → 7/10                                 |
| Pass 7  (Decisions)  | 0 resolvidas, 6 para o Marlon (D1–D6)       |
+--------------------------------------------------------------------+
| NOT in scope         | 4 itens                                     |
| What already exists  | escrito                                     |
| Decisions made       | 4 auto-decisões aplicadas no protótipo      |
| Overall design score | 5/10 → 7/10                                 |
+====================================================================+
```

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | issues_open | score: 5/10 → 7/10, 4 decisions |

**VERDICT:** a revisão de design rodou com auto-decisões (sessão sem pessoa); a revisão de engenharia ainda não rodou (eng review required).

**UNRESOLVED DECISIONS:**
- D1–D6 aguardam a aprovação do Marlon na tarefa ADA-24.
- O celular e a acessibilidade de teclado/`aria-live` ficam para a implementação.
