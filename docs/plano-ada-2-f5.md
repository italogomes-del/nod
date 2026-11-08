# Plano — ADA-2 F5: conversa com ferramentas numa linha, toque longo e composer + · mic

Tarefa 5b9a3a62 (quadro EngNod) · fatia 5 da ADA-2 · protótipo `nod-prototipos/ada-2` v2, jornada 2 · critérios 1, 2,
3, 5, 11, 13, #290 e #293 · depende da F1 (#644, na main) · alinhado à ADA-5 (#647) e à ADA-6 (#652) · decisão em
[ADR-156](adr/adr-156-conversa-do-celular-ferramentas-toque-longo-composer.md). 1 PR.

Fora: a pílula com os apps do bot (ADA-8), Fixar mensagem, o cartão do revisor.

## Arquitetura

Quatro mudanças de tela, sem servidor novo. Regra da [ADR-148](adr/adr-148-base-do-celular.md): forma em
`web/celular-base.css` dentro de `CONSULTA_CELULAR`; nenhuma ação some. O #290 é a única parte que vale no computador.

| Parte | Onde | Celular | Computador |
|---|---|---|---|
| (a) Usou N ferramentas | `web/telas/conversa.ts` (`frasePensou`, `renderPensar`, `renderResumoDasAcoes`), `web/interface.css` | sim | sim |
| (b) Toque longo | `web/lib/menu-segurado-da-fala.ts` (novo), `web/main.ts`, `web/lib/gaveta-bots.ts`, `web/telas/acoes-da-fala.ts` | sim | só o item novo no ⋯ |
| (c) Card em contorno | `web/celular-base.css` | sim | não |
| (d) Composer + · mic | `web/telas/conversa.ts`, `web/telas/quadro-real.ts`, `web/celular-base.css` | sim | não |

## Módulos

**(a) `conversa.ts`.** `frasePensou(duracaoMs, contagem)` ganha irmã `fraseFerramentas(contagem)` →
"Usou 3 ferramentas", "Usou 1 ferramenta", "Usou 3 ferramentas · 1 falhou". `renderPensar` com `fase:"pronto"`
desenha `<summary class="pensar-cab pensar-ferr" aria-label="Ver as 3 ferramentas usadas, pensou por 12 s"
title="Pensou por 12 s">` com o ícone de chave (16) do protótipo, o texto e `<span class="pensar-seta">›</span>`. O
corpo (lista de ações e tarefas) é o mesmo. Turno sem ferramenta (só pensou) mantém "Pensou por N s" (não há o que
listar). CSS em `interface.css`: `.pensar[data-fase=pronto] > .pensar-cab` inline-flex, gap 6, `500 14px`, `--ink-3`,
sem fundo/borda; `[open] .pensar-seta` gira 90°. No celular o summary já tem 44 (`celular-base.css:101`).

**(b) `menu-segurado-da-fala.ts` (novo, puro + DOM fino).**
- `itensDoMenuSegurado(fala, ctx)` monta a lista a partir do que já existe: primeiro Responder (`podeResponder`),
  Copiar, Criar tarefa disto (`ctx.temQuadro`); divisor; depois `itensDoMenu(...)` sem o "Copiar texto" repetido, mais
  Reportar (`relatar-mensagem`). Reações numa linha no topo (as mesmas de `acoesDaFala`). Testável sem DOM.
- `abrirMenuSegurado(mensagem, itens)` clona a posição da mensagem, aplica `.fala-segurada` (sobe com
  `--shadow-pop`) e `.cl-desfoca` no fundo, posiciona o `.menu-fala-seg` (240 px, raio 14, vidro, itens 46 px/16 px)
  acima ou abaixo conforme o espaço, foco no primeiro item, Esc/toque fora/voltar fecha, `role="menu"`.
- `main.ts`: no celular, `criarToqueLongo` em `.message` (delegado no `#mensagens`, ignora `SELETOR_INTERATIVO` e
  `pointerType === "mouse"`); o clique de cada item vai para o `acaoDoMenuDaFala` que já existe (mesmos `data-act`).
- `gaveta-bots.ts`: o listener de clique que alterna `.acoes-a-mostra` sai no celular (o toque simples não abre mais
  nada; a barra fica escondida no celular).
- CSS celular: `-webkit-touch-callout: none` e `user-select: none` só durante o segurar (classe), para o iOS não abrir
  a lupa/menu dele; a seleção normal continua fora do gesto.
- **Criar tarefa disto** (`data-act="criar-tarefa-da-fala"`): `tarefaDaFala(texto, bot, quando)` (puro) →
  `{titulo, descricao}` cortados em `LIMITES_QUADRO` (título no fim de palavra, até 80; descrição com a origem
  "Da conversa com X, 7/11 14:02" + texto). Chama `api.criarTarefa(botId, campos)`. Sucesso: aviso "Tarefa criada"
  com **Abrir** (abre a tarefa no quadro) e **Desfazer** (`quadro.desfazer` com o lote que a criação devolve, `api.desfazerLoteQuadro`). Erro: aviso com a
  mensagem do servidor; `sem_quadro` não chega a acontecer porque o item só aparece com quadro. Botão desabilitado
  durante a chamada (dois toques não criam duas). Também entra no ⋯ do computador.

**(c) `celular-base.css`.** `.cp`, `.cl` (card de lote): borda `--line`, raio 16, fundo `--surface`. `.cp-sim`:
transparente, `--ink`, borda 1.5 px `--ink`, raio 22, 44, `600 15px`. `.cp-nao`: texto `--ink-2`, 44. Perigo:
contorno e texto `--danger`. Decidido: a linha `.a2-feito` do protótipo já existe como o recibo do card (sem mudança).

**(d) Composer.** Conversa (`conversa.ts:1845`): o markup ganha a ordem `+ · .box(textarea, pílula do ditado,
parar) · mic/enviar`, com o `+` (`.mais-campo`) e o par mic/enviar fora do `.box` só no celular — feito com CSS
(`display: contents` no wrapper + `order`), sem mudar a árvore no computador. Se o `order` não bastar para o foco
seguir a ordem visual, o markup muda uma vez para a ordem nova em todos os tamanhos (o computador fica visualmente
igual por CSS). A troca mic ↔ enviar é a classe `.tem-texto` no `.box`, que o input já liga hoje para o send; nada é
regravado. Enviar com contorno: 46, `--ink`, borda 1.5 px, transparente. Sem ditado (`htmlBotaoDitado()` vazio) o
enviar fica sempre à vista. Vidro nos redondos: `color-mix(--surface 72%)` + `backdrop-filter: blur(20px)
saturate(1.6)`, o mesmo do topo. Posição: `bottom: calc(max(env(safe-area-inset-bottom), var(--teclado, 0px)) + 8px)`
com `.teclado-aberto` (NOD-381) como hoje.
Quadro e tarefa (`quadro-real.ts:588`, `pilulaDoQuadro`): o `.qc-clipe` vira o + redondo (`data-act="abrir-mais-quadro"`
abre a `folha-mais` com Anexar; com um item só, chama o anexar direto), `.qc-txt` na pílula, `.qc-enviar` com
contorno e o ditado como mic redondo. Mesmo CSS, classes compartilhadas (`.cmp-redondo`, `.cmp-campo`).

## Dados e migrações

Nenhuma. Nenhum campo novo; `quadro.criar_tarefa` grava como hoje.

## APIs

Nenhuma rota nova. Usa `POST /agentes/:id/quadro/tarefas` (`src/adapters/http/rotas/quadro.ts:137`, `Rota.acao =
quadro.criar_tarefa`) e, para desfazer, `POST /agentes/:id/quadro/lotes/:lid/desfazer` (`quadro.desfazer`).

## Ações

Ações: nenhuma ação nova. **Criar tarefa disto** reusa `quadro.criar_tarefa` (vivo, rota acima, no chat
`gerir_quadro criar_tarefa`); o Desfazer reusa `quadro.desfazer` (o lote da criação). **Responder** e **Copiar** são da tela, sem
rota: Responder põe a citação no campo e o envio é `conversas.enviar`; Copiar usa a área de transferência. O + e o mic
abrem o que já existe (folha do +, ditado). `npm run paridade` e o piso não mudam.

## Bordas e erros

- Toque longo × rolagem: `criarToqueLongo` cancela com 10 px de movimento; o clique depois do segurar é engolido
  (400 ms). Toque longo num link/botão/`summary` dentro da fala não abre o menu.
- iOS: sem `touch-callout`, a lupa do sistema não briga; Copiar copia o texto inteiro (a seleção parcial some no
  celular — suposição S4).
- `navigator.clipboard` indisponível (http, permissão): cai no `document.execCommand("copy")` com textarea oculta;
  falhando, aviso "Não deu para copiar".
- Mensagem do próprio usuário: Responder e Copiar, sem Criar tarefa? Não: Criar tarefa vale para qualquer fala.
  Reportar só na fala do bot (como hoje).
- Fala vazia (só anexo): Copiar e Criar tarefa somem.
- Card: o caso perigo continua vermelho; o card decidido vira recibo como hoje.
- Composer: textarea cresce até 6 linhas e rola dentro; a fileira nunca passa de 390 − 2×12; com o teclado a fileira
  fica 8 px acima dele; o Parar ocupa o lugar do enviar durante o turno.
- Movimento reduzido: o menu aparece sem escala, só opacidade.

## Testes

- **Unit** (`npm run test:unit -- <arquivo>`):
  - `tests/unit/web/conversa-pensar.test.ts`: `fraseFerramentas` (0/1/N, falhas, singular/plural),
    `renderResumoDasAcoes` com "Usou 3 ferramentas", › e aria com a duração; turno sem ferramenta mantém "Pensou por".
    Atualizar os testes que esperam "Pensou por … · N ações".
  - `tests/unit/web/menu-segurado-da-fala.test.ts`: ordem dos itens, divisor, sem quadro sem "Criar tarefa disto",
    fala vazia, fala do usuário sem Reportar, nenhum `data-act` do ⋯ some (comparação com `itensDoMenu`).
  - `tarefaDaFala`: corte em palavra, limites, origem.
  - `celular-base.test.ts`: as regras novas estão dentro de `CONSULTA_CELULAR`; tokens 44/46/16.
- **Integração**: `POST /agentes/:id/quadro/tarefas` com título/descrição no limite gerados por `tarefaDaFala` (já
  coberto pela rota; um caso novo com o texto longo).
- **Chrome** (`tests/concurrency/conversa-ada2-f5-chrome.test.ts`, 390×844 com toque):
  linha "Usou N ferramentas" abre a lista; segurar 500 ms abre o menu, Copiar põe o texto na área, Responder cita no
  campo, Criar tarefa cria (stub) e mostra Abrir/Desfazer; toque simples não abre nada; arrastar não abre; card com
  pílula de contorno e "Agora não" em texto; composer: + / campo / mic nas pontas, 46 de altura, campo 16 px, digitar
  troca mic por enviar, acima do teclado simulado, sem passar da largura; o mesmo no quadro e na tarefa.
  A 1280×800 (sem toque): só a linha das ferramentas mudou; card e composer iguais (critério 13).
- **Regressão**: `quadro-composer-chrome` (#647), testes Chrome da ADA-6 (#652), `node scripts/alvos-44px/rodar.ts`.
- Suíte completa (`npm run check`) uma vez antes de pedir revisão.

## Riscos

1. Toque longo × seleção de texto no iOS real (o Chrome headless não reproduz a lupa). Mitigação: classe só durante o
   gesto; teste manual no iPhone no QA.
2. Composer no quadro já tem 34 testes Chrome (#647): mexer no `.qc-pil` pode quebrar. Mitigação: classes novas por
   cima, mesmos `data-act`, rodar a suíte do quadro a cada commit do passo 6.
3. Testes que conferem "Pensou por" no pronto (unit e Chrome do pensamento) vão quebrar de propósito: atualizar no
   mesmo commit.
4. `display: contents` e foco/ordem de leitura: se o leitor de tela ler fora de ordem, muda o markup (plano B acima).
5. Auditoria de 44 px: os redondos de 46 e os itens de 46 passam; conferir o item do ⋯ novo.

## ADRs

- ADR-156 (nova, neste PR): emenda a ADR-129 §5 e a ADR-113, aplica a ADR-148 e a ADR-135.
- Respeita: ADR-148 (forma no celular, nenhuma ação some), `regioes.ts` (composer não regravado), web só `import type`
  de `src/`.

## Suposições (para a Ada e o Gil confirmarem; sigo com elas)

- S1 (Ada): N em "Usou N ferramentas" = total de chamadas do turno; falhas como " · 1 falhou"; a duração sai do texto
  e vai para o title/aria.
- S2 (Ada): turno que só pensou, sem ferramenta, continua "Pensou por N s".
- S3 (Gil): no celular o toque simples não mostra mais a barra de ações; tudo vai para o toque longo, com os itens do ⋯
  depois do divisor (nada some).
- S4 (Gil): Copiar copia o texto inteiro; a seleção parcial deixa de existir no balão do celular.
- S5 (Ada): Criar tarefa disto cria sem agente e no status padrão (não dispara trabalho), com título = início da fala e
  descrição = texto + origem; aviso com Abrir e Desfazer; só aparece se o bot tem quadro; entra também no ⋯ do
  computador.
- S6 (Gil): no quadro e na tarefa, o + abre a folha do + com o que existir (hoje só Anexar) e, com um item só, o
  seletor de arquivo direto.
- S7 (Gil): sem ditado disponível, o enviar de contorno fica sempre à vista no lugar do mic.
- S8 (Gil): o card de lote recebe o mesmo contorno; o cartão do revisor fica como está.

## Revisões do plano

- **/plan-eng-review** (decidido sem perguntar): sem migração nem rota; o menu é puro + DOM fino para testar sem
  navegador; reusar `acaoDoMenuDaFala` evita duas implementações de Copiar/Responder; dois toques em Criar tarefa
  protegidos por botão desabilitado; o plano B do composer evita foco fora de ordem; regressão do quadro rodada a cada
  commit do passo 6.
- **/plan-design-review**: a linha das ferramentas segue o protótipo (14 px `--ink-3`, ícone 16, › que gira); o menu
  tem alvo de 46 e foco/Esc; o card mantém o perigo em vermelho; vidro igual ao topo (um material só); movimento
  reduzido respeitado; estados vazios (fala só com anexo) cobertos.
- **/acao-no-chat**: seção "Ações" acima — nenhuma ação nova; reusa `quadro.criar_tarefa` e `quadro.desfazer`.

## Passos (commits)

1. `docs: ADR-156 e plano da ADA-2 F5` (este PR, em draft).
2. `ADA-2 F5: as ferramentas do turno numa linha "Usou N ferramentas" (#290)` — conversa.ts, interface.css, testes.
3. `ADA-2 F5: toque longo na mensagem abre Responder, Copiar e Criar tarefa disto` — menu-segurado-da-fala.ts,
   main.ts, gaveta-bots.ts, acoes-da-fala.ts, testes unit.
4. `ADA-2 F5: card de aprovação em contorno no celular` — celular-base.css, teste.
5. `ADA-2 F5: composer + · campo · mic na conversa (#293)` — conversa.ts, celular-base.css.
6. `ADA-2 F5: o mesmo composer no quadro e na tarefa` — quadro-real.ts, celular-base.css, regressão do quadro.
7. `ADA-2 F5: testes Chrome a 390×844 e auditoria de 44 px` — conversa-ada2-f5-chrome.test.ts, alvos-44px.
