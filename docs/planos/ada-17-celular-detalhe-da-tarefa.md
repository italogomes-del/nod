# ADA-17 — Celular F2: detalhe da tarefa no padrão da base mobile

Fatia 2 da ADA-2. Protótipo: [nod-prototipos/ada-17](https://gamefik.github.io/nod-prototipos/ada-17/) (base: ada-2 v2, jornada 4).
Critérios da ADA-2 cobertos: 1, 2, 3, 5, 6, 7, 8, 10, 11, 12, 13 e #294. Vale só no celular (`CONSULTA_CELULAR`).
Base: F1 ([PR #644](https://github.com/gamefik/nod/pull/644)) e [ADR-148](../adr/adr-148-base-do-celular.md).

Revisões aplicadas a este plano: checklist do /plan-eng-review (escopo, arquitetura, testes, falhas), do
/plan-design-review (hierarquia, estados, acessibilidade, minimalismo) e do /acao-no-chat (seção Ações, conferida em
`src/domain/acoes/quadro.ts`).

## 1. O que muda (resumo)

No celular, a tarefa aberta deixa de ser a página de duas colunas (principal + `aside.qd-lado` com selects) e vira:

1. **Topo**: título grande + código; ao rolar, o título encolhe para a pílula do topo ("VER-1 · título…").
2. **Bandeja de chips** que rola de lado: Status, Responsável, Prazo (ver S1), Branch e "Ajustes". Cada chip abre uma
   **folha** (bottom sheet); nenhum `<select>` nativo no celular.
3. **Descrição**.
4. **Atividade única**: execuções (#294), eventos do histórico, movimentos e comentários numa linha do tempo só,
   por hora. "Ver N execuções anteriores" recolhido.
5. **Um composer só** (o `.qc-wrap` sticky que já existe), acima do teclado. Responder a um comentário é contextual
   ("Respondendo a Ana ✕"), não um segundo campo.

No computador nada muda (critério 13).

## 2. Arquitetura

- **Render condicional pela forma**: `tarefaAberta()` (web/telas/quadro-real.ts) ganha um irmão
  `tarefaAbertaCelular()` em **web/telas/tarefa-celular.ts**. `quadro-na-tela.ts` escolhe por
  `matchMedia(CONSULTA_CELULAR).matches` e redesenha na troca (listener `change`). Motivo: a linha do tempo única e a
  bandeja mudam a ordem do DOM; só CSS não dá sem mexer no desktop. O markup do desktop fica byte a byte igual
  (teste de snapshot do `tarefaAberta` existente continua passando).
- **Mesmos dados, mesmas ações**: o celular consome o mesmo `TarefaDto` + `ExtrasDaTarefa` e dispara os mesmos
  handlers (`data-campo="status"|"agente"`, `com-enviar`, `cancelar-trabalho`, `repetir-trabalho`…). Nenhuma API nova.
- **Folhas**: generalizar o `.qd-folha` do NOD-420 (menu de coluna) num módulo **web/lib/folha.ts**
  (`abrirFolha({titulo, corpo, aoFechar})`: foco preso, Esc/arrastar/toque fora fecha, devolve o foco ao chip,
  `max-height: calc(100dvh - var(--teclado, 0px) - safe-area)`). O menu de coluna passa a usar o módulo (sem mudança visual).
- **Teclado**: **web/lib/teclado-visivel.ts** escuta `visualViewport` (resize/scroll) e grava `--teclado` no `:root`.
  Composer e folha somem pela área visível (critério 5 e 12). Sem `vh` em lugar nenhum novo.
- **Topo encolhido**: `ligarTopoEncolhe` já liga `topo-encolhido`; acrescento `data-titulo` no cabeçalho com
  "código · título" quando há tarefa aberta, e o CSS mostra esse rótulo só encolhido. Reduzir movimento: sem transição.

## 3. Módulos e arquivos

| Arquivo | Mudança |
|---|---|
| web/telas/tarefa-celular.ts (novo) | `tarefaAbertaCelular`, `bandejaDeChips`, `linhaDoTempo` (puros, `esc` em todo texto de fora) |
| web/telas/folhas-da-tarefa.ts (novo) | corpo das folhas: status (+ confirmar cancelamento com motivo), responsável (busca, Bots/Pessoas, Sem responsável), ajustes (7 linhas de 52) |
| web/lib/folha.ts (novo) | abrir/fechar folha, foco, gesto; reusado pelo menu de coluna |
| web/lib/teclado-visivel.ts (novo) | `--teclado` via visualViewport |
| web/lib/quadro-na-tela.ts | escolher o render; handlers de chip → folha → mesmo caminho do select; toque longo no comentário; "Respondendo a" no composer |
| web/lib/topo-encolhe.ts | `data-titulo` com a tarefa aberta |
| web/telas/trabalhos-da-tarefa.ts | exportar a linha da execução no formato #294 (mascote 28, "Vera está trabalhando", "passo 3 de 5 · 2 min", ›) sem mudar a saída do desktop |
| web/celular-base.css | todas as regras novas, dentro da `@media` da F1 |
| docs/adr/adr-148-base-do-celular.md | emenda F2 (toque longo, folhas de propriedade, render por forma) |

## 4. Dados e migrações

**Nenhuma migração** (ADR-148: a forma muda, as ações não). Ver S1 e S2 para os dois pontos do protótipo que pediriam dado novo.

## 5. APIs

Nenhuma rota nova. Usa as existentes: mudar tarefa (status/agente/motivo), comentar, comentários da tarefa
(comentários + atividade + criada por), trabalhos da tarefa (cancelar/repetir/recado), desfazer movimento.

## 6. Ações (registro em src/domain/acoes)

- **Nenhuma ação nova.** A tela só aciona ações que já existem e já têm `Rota.acao`, executor único e teste de contrato:
  - Status, cancelar com motivo, responsável → `quadro.mudar_tarefa` (`status`, `motivo`, `agente`).
  - Comentar / responder (S2) → `quadro.comentar` (`tarefa`, `texto`).
  - Cancelar/repetir execução → `quadro.cancelar_trabalho`, `quadro.repetir_trabalho`; desfazer → `quadro.desfazer_movimento`.
- **Pelo chat** (jornada 5 do protótipo): "passa a VER-1 para Em revisão", "passa ela pro Gus", "responde a Ana na VER-1"
  já saem pelas mesmas ações via gerir_quadro. O card do chat com diff/Desfazer é do chat, fora desta fatia.
  "põe prazo sexta" depende de S1.
- Piso: `npm run paridade` deve continuar verde sem entrada nova. Se a Ada escolher S1-b ou S2-b, entra parâmetro novo
  no schema, teste de contrato, paridade e emenda da ADR-148 (gatilho dela), no mesmo PR.
- QA: tocar cada chip/folha e conferir que a mesma mudança feita pelo chat (por id da tarefa) aparece igual na atividade.

## 7. Bordas

- **Teclado aberto**: composer cola em cima do teclado (`--teclado`); a folha aberta com teclado (busca do responsável)
  encolhe pela área visível, nunca passa por baixo.
- **Folha sobre o teclado**: ao abrir uma folha, o composer perde o foco (o teclado desce); a busca da folha sobe o teclado
  e a folha usa `100dvh - --teclado`.
- **Tarefa sem branch**: o chip Branch some (o `TarefaDto.branch` é sempre sugerido; só mostro se houver branch real/PR —
  igual ao desktop, que mostra quando `t.branch` existe). Sem prazo: chip "Sem prazo" (ver S1).
- **Sem responsável**: chip "Sem responsável" em cinza.
- **Comentário longo**: quebra de linha (`overflow-wrap: anywhere`), sem rolagem horizontal (critério 1); 4000 caracteres
  como hoje.
- **Offline/erro ao salvar**: troca otimista no chip; falhou → volta ao valor anterior e mostra "Não salvou. Voltou para
  Fazendo. Tentar de novo" (texto do protótipo). Comentário segue a lógica de pendente/falhou/dúvida que já existe.
- **Tarefa bloqueada com pergunta**: o form de resposta da pergunta continua no corpo (é a resposta à pergunta, não comentário).
- **Rotação / sair do celular**: o `change` do matchMedia redesenha a vista e preserva rascunho (`textarea[id]`) e rolagem.
- **Reduzir movimento**: sem transição no topo e nas folhas.
- **Muitas execuções**: só a atual e as do dia aparecem; "Ver N execuções anteriores" abre o resto.

## 8. Testes

- **Unit (vitest, tests/unit/web/)**:
  - `tarefa-celular.test.ts`: bandeja (chips certos por estado, sem `<select>`), linha do tempo ordenada por hora com os
    4 tipos, recolhido de execuções antigas, `esc` em título/comentário/motivo (injeção), tarefa sem branch/sem responsável.
  - `folhas-da-tarefa.test.ts`: status com Cancelada abrindo confirmação com motivo; responsável com busca e grupos.
  - `folha.test.ts`: foco preso, Esc fecha e devolve o foco, max-height em dvh.
  - `teclado-visivel.test.ts`: `--teclado` com visualViewport falso.
  - `topo-encolhe.test.ts`: `data-titulo` com tarefa aberta, limpo ao voltar.
  - `celular.test.ts` (F1): continua recusando regra fora da consulta; novo teste recusa `vh` e `select` visível no celular.
  - `quadro-real` existente: o desktop sai igual (critério 13).
- **Componentes (happy-dom)**: chip → folha → escolher status chama `mudarTarefa` com o mesmo payload do select; falha
  reverte e mostra a mensagem; toque longo (500 ms) no comentário abre Responder/Copiar texto/Copiar link; "Respondendo a"
  some no ✕ e no envio.
- **e2e no celular**: Playwright com perfil iPhone (390×844, `hasTouch`, `isMobile`), `NOD_LOGIN=stub`: abrir tarefa, trocar
  status pela folha, comentar com teclado, responder a um comentário, sem rolagem horizontal (`scrollWidth <= innerWidth`),
  alvos ≥ 44. Mesmo roteiro em desktop 1280×800 conferindo que nada mudou.
- `npm run check` uma vez antes da revisão.

## 9. Riscos

1. **Prazo da tarefa não existe** (modelo, contrato e ação). O protótipo pressupõe. → S1.
2. **Responder a comentário não tem dado de "responde a"**. → S2.
3. **Duas árvores de markup** (desktop/celular) podem divergir com o tempo. Mitigação: as duas consomem os mesmos helpers
   puros (chipSt, linha da execução, comentário) e os handlers são os mesmos `data-act`/`data-campo`.
4. **Toque longo** conflita com seleção de texto e com o gesto do iOS. Mitigação: `user-select: none` só no cabeçalho do
   comentário, cancelar o timer em `pointermove > 8px`, e "Responder" também acessível pelo link visível do card.
5. **visualViewport** se comporta diferente no iOS Safari e no Android Chrome. Mitigação: e2e nos dois perfis e fallback
   (`--teclado: 0`) quando não existir.
6. **"Copiar link do comentário"** precisa de âncora (`#c-<id>`) no link da tarefa; o link da tarefa existe
   (`LinkDeTarefa`), a âncora é nova só no cliente (rolar até o comentário). Se der trabalho, sai "Copiar link" da tarefa.
7. **Pessoas no responsável**: depende das pessoas do quadro; se o quadro não tiver, a folha mostra só Bots + "Você".

## 10. ADR

Emenda curta na ADR-148 ("F2: detalhe da tarefa"): (a) a forma pode trocar a árvore de render por `CONSULTA_CELULAR`
desde que os handlers e as ações sejam os mesmos; (b) toque longo como atalho, nunca o único caminho; (c) propriedades
em folha, sem select nativo. Sem ADR nova.

## 11. Passos (commits) — 1 PR

1. `ADA-17: plano` (este arquivo).
2. `ADA-17: folha e teclado` — web/lib/folha.ts, teclado-visivel.ts, menu de coluna migrado + testes.
3. `ADA-17: detalhe no celular` — tarefa-celular.ts (topo, bandeja, descrição, linha do tempo) + escolha por forma + testes.
4. `ADA-17: folhas de status, responsável e ajustes` — folhas-da-tarefa.ts + handlers + erro/desfazer + testes.
5. `ADA-17: execuções #294 na atividade` — linha da execução no formato novo + recolhido + testes.
6. `ADA-17: composer único e responder` — tira `.qd-com-form` no celular, "Respondendo a", toque longo + testes.
7. `ADA-17: topo encolhe com o título` — topo-encolhe + CSS + teste.
8. `ADA-17: e2e celular e emenda da ADR-148`.

## 12. Suposições (Ada e Gil confirmam)

- **S1 — Prazo**: a tarefa não tem prazo hoje (só o quadro tem). Suposição: **o chip Prazo fica fora nesta fatia**
  (atrás da flag `prazoDaTarefa`, desligada) e abro follow-up "Prazo da tarefa" (migração + `prazo` no
  `quadro.mudar_tarefa` + desktop + chat). Alternativa S1-b: fazer aqui — fura a ADR-148 e dobra o escopo.
- **S2 — Responder**: sem schema novo. "Respondendo a Ana" manda o comentário com a citação curta no texto
  (`> Ana: primeiras palavras…` + resposta) via `quadro.comentar`; o card renderiza a citação a partir do texto.
  Alternativa S2-b (follow-up): `responde_a` no comentário, com migração, para o "Respondo qual?" do chat.
- **S3**: prioridade e labels ficam de fora até o campo existir (já anotado no protótipo).
- **S4**: no Ajustes, "Quadro" mostra o quadro e abre a mesma escolha do "Mover para" de hoje.
- **S5**: o card de chat com diff/Desfazer (jornada 5) é do chat e fica fora desta fatia; aqui só garantimos que as
  mudanças pelo chat aparecem na atividade com "· pelo chat" quando o lote vier da conversa (dado `pedidoPor` já existe).
- **S6**: execuções antigas recolhidas a partir da 2ª do dia anterior ("Ver N execuções anteriores").
