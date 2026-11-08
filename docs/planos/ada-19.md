# ADA-19 — Celular F4: tab bar, Sua vez como aba e recentes

Fatia 4 da ADA-2. Protótipo `nod-prototipos/ada-2` v2 (`6f1f02e`), jornada 1, passos 2.5–2.6. Critérios da ADA-2
cobertos aqui: **2, 4, 6, 7, 9, 11, 12 e 13**. Vale **só no celular** (`CONSULTA_CELULAR`, `ehCelular()`); o computador
não muda. Depende da F1 (PR #644, já na main: `celular-base.css`, `topo-encolhe.ts`, tokens `--cel-*`).

Regra: **1 PR por issue**. Este PR leva primeiro o plano e depois os commits da implementação.

## Escopo

1. **Tab bar** nas telas raiz do celular: pílula de vidro com **Conversas**, **Quadros** e **Sua vez** (ícone de 22 px
   + rótulo 500 11px; a ativa numa pílula suave `color-mix(ink 7%)`, peso 600, `aria-current="page"`), e ao lado o
   **botão redondo da busca** (60 px, `aria-label="Buscar"`). Não lidas viram **um ponto** na aba Conversas; os pedidos
   viram a **contagem** de Sua vez. Sem dica de gesto.
2. **Sua vez como aba**, só com **Precisa de você**. Linha: mascote 40 px, quem pede (600 16px + papel 13px), o pedido
   em até 2 linhas (15px, clamp 2), o motivo (500 12px, "Pergunta · Lançar o Nod 1.0", "Decisão · Conversa") e a hora.
   Tocar abre a conversa **já no pedido**.
3. **Título grande** "Conversas" (700 30px/1.15, −.02em) que encolhe ao rolar e vira o título pequeno no centro do topo.
4. **Segurar o ‹** da conversa abre a **folha de recentes** (`role=dialog`, "Conversas recentes"), linhas de 60 px.

Fora de escopo: chips com folha (8), composer/teclado (5, 10), lista agrupada da conversa — são F2/F3. A aba
**Quadros** só lista e abre (o quadro em si é o de hoje, ADA-8/ADR-146).

## O que já existe (reusar, não refazer)

| Precisa | Já existe | Onde |
|---|---|---|
| Inicial do celular | `renderSidebar` → ramo `celular.ativo()` | `web/main.ts:1803`, `1956-1977` |
| Mostrar/esconder a inicial, histórico | `criarCelular`, `.app.bots-abertos`, `MARCA_HISTORICO` | `web/lib/gaveta-bots.ts`, `web/lib/inicio-celular.ts:74` |
| Topo encolhe | `ligarTopoEncolhe`, `estaEncolhido`, `LIMIAR_ENCOLHE` | `web/lib/topo-encolhe.ts` |
| Não lidas | `temNovas` / `naoLidaDe`, contagem `naoLidos` | `web/main.ts:1011-1018`, `1952-1955` |
| Contagem de pedidos | `pedidosAbertos` / `contarAbertas` (1 por fio, sem vencidos; = selo do Dock) | `web/lib/avisos.ts:67-74` |
| Itens de Sua vez | `estado.suaVez: SuaVezDto`, `api.suaVez`, `hidratar-sua-vez` | `src/contracts/api.ts:72-84`, `web/estado/reducer.ts:623` |
| Abrir conversa no pedido | `verPerguntaNaConversa(conversa, agente, decisaoId)` + `levarAoAlvo` | `web/main.ts:4327`, `web/lib/levar-ao-alvo.ts:20` |
| Toque longo | `criarToqueLongo` (450 ms, 10 px) | `web/lib/toque-longo.ts:36` |
| ‹ volta | `botaoAbrirBots` → `celular.voltarAoInicio()` | `web/main.ts:2022`, `5656`; `gaveta-bots.ts:167` |
| Busca cheia | `abrirBusca()` | `web/main.ts:420-427` |
| Lista de quadros | `GET /quadros` → `QuadroDaPessoaDto[]` | `src/adapters/http/rotas/quadro.ts:234`, `web/lib/api.ts:303` |
| Recência por bot | `frota.agentes[].ultimaMensagem {previa, em}` | `src/contracts/api.ts:38` |
| Auditoria de 44 px | `scripts/alvos-44px/rodar.ts` a 390×844 | — |

Nada disso exige servidor novo.

## Arquitetura

```
                       ┌─────────────── celular.ativo() ───────────────┐
 estado (reducer) ───▶ │ renderSidebar (inicial)                         │
  frota, suaVez,       │   ├─ topo: conta · título pequeno · trabalhos · + │
  naoLidas             │   ├─ aba = Conversas | Quadros | Sua vez         │
                       │   │    ├─ Conversas: título grande + lista atual │
 abaDoInicio (módulo) ─▶│   │    ├─ Quadros: lista de GET /quadros         │
                       │   │    └─ Sua vez: lista "Precisa de você"       │
                       │   └─ nav.tab-bar (vidro) + botão busca           │
                       └────────────────────────────────────────────────┘
 conversa (stage) ── #cabecalho ‹ ──(segurar 450 ms)──▶ folha .folha-recentes
```

- **A tab bar mora na inicial do celular** (o `renderSidebar` no ramo `celular.ativo()`), não em `#cabecalho`. Assim
  ela só existe nas telas raiz e some sozinha quando a conversa, o quadro ou a tarefa entram (a inicial fica `inert` e
  escondida por `.bots-abertos`). Não há segundo mecanismo de mostrar/esconder.
- **A aba ativa é estado de tela do cliente**, um módulo pequeno (`abaDoInicio`), como o `modo()` do quadro em
  `quadro-na-tela`. Não entra no reducer nem na URL. Ela vai na chave do `lembrar("sidebar", …)` em
  `redesenharSidebar()` (`main.ts:3009`) para redesenhar ao trocar.
- **Sua vez no celular não navega para `Tela{tipo:"sua-vez"}`**: vira a aba. Quem hoje navega para lá no celular
  (o sino com 2+ pedidos, `destinoDoAlvo` dos deep links, `main.ts:5213`) passa a ligar a aba Sua vez e mostrar a
  inicial. No computador, `Tela{tipo:"sua-vez"}` segue igual.
- **A aba Sua vez reusa os dados de `estado.suaVez`**, filtrados por uma função pura; a renderização da linha é nova
  (a do computador, `renderItem`, tem botões de decisão inline que o celular não usa aqui).

## Módulos

### Novo: `web/lib/tab-bar-celular.ts` (puro, testável sem DOM)

```ts
export type AbaDoInicio = "conversas" | "quadros" | "sua-vez";
export const ABAS: readonly AbaDoInicio[];
export const MAXIMO_CONTAGEM = 99;            // 100+ vira "99+"
export const RECENTES_VISIVEIS = 8;

export function textoDaContagem(n: number): string;          // "" | "1".."99" | "99+"
export function rotuloDaAba(aba, { pedidos, naoLidas }): string;
//   "Sua vez, 3 pedidos" · "Conversas, há não lidas" — vai no aria-label
export function itensDaAbaSuaVez(suaVez: SuaVezDto | null, agora: number): LinhaDoPedido[];
//   só abertos e não vencidos, 1 por fio (mesma regra de contarAbertas), mais antigo em cima
export function motivoDoPedido(item): string;                 // "Pergunta · <quadro|conversa>", "Decisão · …"
export function recentes(agentes, conversaAberta, limite = RECENTES_VISIVEIS): LinhaRecente[];
//   ordena por ultimaMensagem.em desc; sem mensagem fica fora; a aberta marcada
export function destinoDaAbaQuadros(quadros: QuadroDaPessoaDto[]): { tipo: "vazio" } | { tipo: "direto"; quadro } | { tipo: "lista"; grupos };
export function abaDoDestino(destino): AbaDoInicio | null;   // deep link/sino → aba
```

Regra de ouro: a contagem da aba é **o mesmo número** de `pedidosAbertos` (selo do Dock e sino). Um teste trava isso.

### Novo: `web/telas/tab-bar-celular.ts` (HTML puro, string)

`renderTabBar(aba, contagens)`, `renderAbaSuaVez(linhas)`, `renderAbaQuadros(destino)`, `renderFolhaRecentes(linhas)`.
Sem `innerHTML` de dado cru: tudo por `esc()` como o resto de `web/telas`.

### Novo: `web/tab-bar-celular.css`

Carregado depois de `mobile.css` e de `celular-base.css`, **um só `@media` igual a `CONSULTA_CELULAR`**, nada fora
(mesma catraca de `celular.test.ts`, estendida a este arquivo). Fora da consulta a tab bar recebe `display:none` por
nunca ser renderizada (o markup só sai no ramo celular), então o computador não carrega nada visível.

Medidas do protótipo: `--tab-altura: 60px`; tabs `border-radius 30px`, `padding 4px`; posição `left/right 16px`,
`bottom: calc(env(safe-area-inset-bottom) + 2px)`; conteúdo da inicial com
`padding-bottom: calc(env(safe-area-inset-bottom) + var(--tab-altura) + 24px)`. Ponto 8 px `var(--ink)` com
`box-shadow 0 0 0 2px var(--surface)`. Blur **só** na pílula das abas e no botão da busca (ADR-148: nunca em lista).
Folha de recentes com `max-height: calc(100dvh - env(safe-area-inset-top) - 12px)` (critério 12: dvh, nunca vh).

### Mudanças em `web/main.ts`

1. Ramo celular do `renderSidebar` (`1956-1977`): monta o topo novo (conta · título pequeno · trabalhos · +), o
   conteúdo da aba e a tab bar. **Sai** a `.inicio-barra` com o input "Buscar" (`main.ts:1976`) — a busca vira o botão
   redondo que chama `abrirBusca()`. **Sai** o sino do topo no celular (a aba Sua vez o substitui) e o botão de não
   lidos do topo (vira o ponto).
2. `ACOES`: `"aba-do-inicio"` (troca a aba, redesenha, rola ao topo se tocar na já ativa), `"abrir-pedido"` (chama
   `verPerguntaNaConversa` com o id do pedido; sem alvo, cai na conversa como hoje), `"abrir-recente"`.
3. `navegar` (`3481-3500`) e o sino: no celular, `tipo:"sua-vez"` vira `abaDoInicio.trocar("sua-vez")` +
   `celular.voltarAoInicio()`. **Atenção** ao guarda de texto em `inicio-celular-historico.test.ts`: a linha
   `const paraInicial = celular.ativo() && tela.tipo === "inicio";` fica intacta; o desvio de Sua vez entra antes
   dela.
4. Toque longo no ‹: `criarToqueLongo` ligado a `#cabecalho .abrir-bots.voltar-bots`; ao segurar, abre a folha e
   **engole o clique** que viria depois (mesmo cuidado de `abrirMenuSegurado`). `aria-label` do ‹ passa a "Voltar
   para Conversas (segure para as recentes)". O teclado tem caminho: `Shift+Enter`/menu de contexto no ‹ também abre
   a folha, e a folha também é alcançável pelo leitor de tela num botão "Recentes" só para leitor (`.so-leitor`).
5. Título grande: `ligarTopoEncolhe(() => document.querySelector(".inicio-topo"), [listaDaAbaAtiva])` com um segundo
   par ligar/desligar a cada troca de aba. O ligamento de `#cabecalho` (`main.ts:264`, guardado por regex em
   `topo-encolhe.test.ts:100`) **não muda**.
6. `filtrarBots` / o caso especial de `.inicio-busca` no focusout (`main.ts:7050`, `7272`): o input sai do celular;
   o filtro continua no computador. O guarda de texto `closest(".inicio-busca")) { redesenharAdiada(); return; }`
   segue no código (computador ainda tem o campo); se mudar, o teste é atualizado no mesmo commit.

### Aba Quadros (suposição — confirmar com Ada e Gil, ver ADA-14)

Hoje é 1 quadro por bot. A ADA-14 (PR #697, ADR-153) leva para N:N com projetos e `GET /quadros` com `nome`,
`projetoId` e `bots`. Suposição adotada, que funciona antes e depois da ADA-14:

- A aba lista **os quadros da pessoa** (`GET /quadros`), agrupados **por bot** hoje (`agenteNome`), e **por projeto**
  quando a ADA-14 entrar (o agrupamento é um campo da função pura, troca num lugar só). Nome: `nome ?? "Tarefas"`.
- **1 quadro** → a aba abre direto a lista com ele em destaque (não pula para a tela: a aba é raiz e precisa voltar
  sem susto).
- **0 quadros** → estado vazio calmo: "Ainda não há quadros. Peça a um bot para criar um." com botão para Conversas.
- Tocar num quadro abre a conversa do bot **na página Tarefas da pílula** (ADA-8/ADR-146), via
  `quadroNaTela.trocar("quadro")` depois do `navegar`. Quadro compartilhado abre `Tela{tipo:"quadro-compartilhado"}`.
- Quadros compartilhados comigo entram num grupo "Compartilhados com você" no fim (hoje esse grupo está na inicial).
- A lista é buscada ao abrir a aba (com cache curto no módulo; invalida no `invalidar("quadros")` se existir, senão a
  cada abertura). Erro de rede: "Não deu para carregar os quadros." + "Tentar de novo".

## Dados, migrações e APIs

- **Sem migração. Sem rota nova. Sem contrato novo.** Usa `GET /quadros`, `GET /quadros/compartilhados`, a frota
  (`ultimaMensagem`) e `GET sua-vez`, que já existem.
- Nenhum dado novo em localStorage (os recentes vêm da frota; não guardamos histórico próprio).

## Ações

**Ações: nenhuma ação nova.** A F4 só muda navegação e estado de tela no cliente (trocar aba, abrir conversa no
pedido, abrir folha de recentes, abrir quadro). Não há rota de pessoa que não seja GET, então `Rota.acao`,
`src/domain/acoes` e `docs/paridade.piso.json` não mudam, e `tests/conformidade/paridade.test.ts` segue verde sem
toque. O "abre a conversa com o Gus" do protótipo é navegação. O QA testa só a tela.

## Bordas e erros

| Caso | Comportamento |
|---|---|
| Zero pedidos | Aba Sua vez sem número; conteúdo "Nada esperando por você." (frase calma, sem ilustração grande). |
| Muitos pedidos | "99+" na aba; `aria-label` com o número real ("Sua vez, 134 pedidos"). Pílula da contagem não cresce além de 3 caracteres. |
| Muitos não lidos | Continua **um ponto** (não número), por design. `aria-label` "Conversas, há não lidas". |
| Sua vez carregando | Esqueleto de 3 linhas de 76 px (mesma família de `ESQUELETO_DO_INICIO`). |
| Sua vez com erro / fora do ar | Linha "Não deu para atualizar." + "Tentar de novo"; incidentes e fora do ar ficam **fora** da aba (suposição; computador continua mostrando). |
| Pedido vencido | Fora da aba e fora da contagem (mesma regra do Dock). |
| Pedido sem conversa da pessoa | Toque cai em `destinoDoAlvo` como hoje (não quebra). |
| Pedido cujo alvo não aparece em 3 s | `verPerguntaNaConversa` já cai em `faixa-trabalhos`. |
| Recentes vazio | Folha mostra "Sem conversas recentes." Com só a aberta, ela aparece marcada " · aberta". |
| Segurar o ‹ e soltar | Não volta (o clique é engolido). Mover > 10 px cancela o segurar. |
| Folha aberta + voltar do sistema / Esc | Fecha a folha primeiro; segundo voltar volta à inicial. |
| Teclado aberto | Não há campo na inicial depois desta fatia (a busca vira tela cheia), então a tab bar nunca disputa espaço com o teclado. Se um campo voltar à inicial, ela se esconde com `:has(input:focus)` — anotado para a F2. |
| Safe-area | `env(safe-area-inset-bottom)` na tab bar e no padding da lista; folha respeita `safe-area-inset-top`. |
| Paisagem baixa (max-height 500) | Mesma tab bar; altura 52 px via token; teste visual a 844×390. |
| Reduzir movimento | Título encolhe sem transição; folha abre sem slide. |
| Leitor de tela | `nav[aria-label="Navegação"]`, botões com `aria-current="page"`, contagem dentro do `aria-label`, `aria-hidden` no ponto e no número visual; folha `role=dialog`, `aria-modal`, foco preso e devolvido ao ‹. |
| Alvos | Abas ≥ 60×44, busca 60×60, linhas 76/60 px — passa em `scripts/alvos-44px` claro e escuro. |
| 390 px | `scrollWidth === 390` na inicial com as três abas. |
| Computador | Nada muda: sem tab bar, Sua vez continua tela, input "Buscar" da barra lateral continua (critério 13). |

## Testes

Unitários (vitest, sem jsdom, como o resto de `tests/unit/web`):

- `tests/unit/web/tab-bar-celular.test.ts` — `textoDaContagem` (0, 1, 99, 100, negativo), `rotuloDaAba`,
  `itensDaAbaSuaVez` (vencidos fora, 1 por fio, ordem), **contagem da aba === `pedidosAbertos`** (propriedade com
  geradores pequenos), `motivoDoPedido`, `recentes` (ordem, limite 8, aberta marcada, sem mensagem fora),
  `destinoDaAbaQuadros` (0/1/N, agrupa por bot, `nome ?? "Tarefas"`), `abaDoDestino`.
- `tests/unit/web/tab-bar-celular-tela.test.ts` — HTML: `nav` com 3 botões + busca, `aria-current` só na ativa,
  ponto só com não lidas, número escapado, linha do pedido com `data-act="abrir-pedido"` e os ids, folha com
  `role=dialog`; escape de nome/pedido com `<script>`.
- `tests/unit/web/celular.test.ts` — estender: `tab-bar-celular.css` com exatamente um `@media` igual à consulta,
  nada fora, carregado depois de `celular-base.css`.
- `tests/unit/web/tab-bar-celular-css.test.ts` — regras: alvos ≥ 44, folha com `dvh` e sem `vh`, `backdrop-filter`
  só na pílula e na busca, `prefers-reduced-motion` sem transição.
- `tests/unit/web/inicio-celular-historico.test.ts` — novo caso no DOM falso: segurar o ‹ abre a folha e não chama
  `history.back()`; tocar volta; Sua vez no celular troca a aba em vez de empurrar histórico.
- Guardas de texto existentes (`navegar`, `topo-encolhe` regex): continuam passando; se um precisar mudar, muda no
  mesmo commit com o porquê.

Manual/QA (sem e2e de navegador no repo): `NOD_LOGIN=stub`, Chrome a 390×844 e 844×390, claro e escuro;
`node scripts/alvos-44px/rodar.ts claro|escuro`; `tela.capturar` da inicial a 390 e 1440 (o 1440 prova o critério 13).

```
Cobertura por critério
 2 alvos 44 ........ css test + alvos-44px
 4 safe-area ....... css test (env()) + QA
 6 encolhe ......... topo-encolhe (existente) + css reduced-motion + QA
 7 vidro ........... css test (blur só na pílula/busca)
 9 lista agrupada .. aba Quadros agrupada + Sua vez (tela test)
11 minimalismo ..... QA visual (Gil)
12 dvh ............. css test (folha)
13 computador ...... celular.test (consulta) + tela.capturar 1440
```

## Riscos

1. **Guardas de texto em `main.ts`** quebram se mexer no `navegar` ou no focusout. Mitigação: o desvio de Sua vez
   entra antes da linha guardada; rodar `inicio-celular-historico` a cada commit.
2. **Toque longo no ‹ vs. clique**: no iOS o `click` chega depois do `touchend`. Mitigação: o mesmo flag de "segurou"
   de `abrirMenuSegurado`, testado no DOM falso.
3. **Duas inscrições de `ligarTopoEncolhe`** (cabeçalho e inicial): cada uma tem seu `desligar`; a da inicial é
   religada a cada troca de aba. Vazamento seria escuta duplicada — teste conta `addEventListener`.
4. **ADA-14 em paralelo** muda o formato de `GET /quadros`. Mitigação: a função pura lê só `id/agenteId/agenteNome`
   hoje e `nome/projetoId` se vierem (opcionais); quem fizer merge depois ajusta o agrupamento num lugar.
5. **Sumir com o sino e o input "Buscar" do celular** pode surpreender quem já usa. É o protótipo aprovado; a busca
   continua a um toque (botão redondo) e o sino vira a aba.
6. **Recentes pela frota** mostram por bot, não por conversa secundária. Aceito nesta fatia (1 conversa por bot na
   inicial hoje).

## ADRs

- Segue **ADR-148** (a forma muda, as ações não): tab bar, aba e toque longo são mudança de fluxo e vão neste PR de
  fase próprio, citando a ADR-148, sem ação nova (gatilho de reversão não disparado).
- **Sem ADR nova** (a 153 já foi tomada pela ADA-14; evita colisão). Uma **emenda curta na ADR-148** registra: "no
  celular, Sua vez é aba da inicial, não tela; o computador mantém a tela".
- Respeita ADR-146/ADA-8 (páginas da pílula) ao abrir um quadro.

## Passos (commits, em ordem, todos neste PR)

1. `docs: plano da ADA-19` — este arquivo.
2. `ADA-19: tab-bar-celular puro` — `web/lib/tab-bar-celular.ts` + `tests/unit/web/tab-bar-celular.test.ts`.
3. `ADA-19: HTML da tab bar, Sua vez, Quadros e recentes` — `web/telas/tab-bar-celular.ts` + teste de tela.
4. `ADA-19: CSS da tab bar no celular` — `web/tab-bar-celular.css`, `index.html`, extensão de `celular.test.ts` e
   teste de CSS.
5. `ADA-19: inicial do celular com abas` — `main.ts` (ramo celular, `ACOES`, sai a barra Buscar e o sino do topo no
   celular, título grande com `ligarTopoEncolhe`).
6. `ADA-19: Sua vez vira aba no celular` — desvio em `navegar`/sino/deep link + `abrir-pedido` com
   `verPerguntaNaConversa`.
7. `ADA-19: segurar o ‹ abre as recentes` — toque longo, folha, foco, Esc/voltar + teste no DOM falso.
8. `ADA-19: aba Quadros` — lista de `GET /quadros`, vazio/erro, abrir na página Tarefas.
9. `docs(adr-148): emenda da F4` — emenda curta.
10. Correções da revisão e do QA (se houver).

Testes do que mudou + `npm run typecheck` a cada commit; `npm run check` uma vez antes da revisão.

---

## Revisão de engenharia (/plan-eng-review)

**Scope challenge.** Menor mudança que entrega: tudo no cliente, uma lib pura, uma tela, um CSS, e ligações em
`main.ts`. Recusado: mover Sua vez para o reducer como `aba` (espalharia estado de tela de celular pelo computador);
criar rota `/quadros/do-celular` (o `GET /quadros` basta); guardar recentes em localStorage (a frota já tem
`ultimaMensagem`). 8 arquivos novos/alterados de código — dentro do limite.

**Arquitetura.** OK. Ponto de atenção: `main.ts` (9 100 linhas) cresce; a lógica fica fora dele (lib + tela), e ele
só liga eventos. Sem acoplamento novo com o servidor.

**Qualidade de código.** Reuso de `pedidosAbertos`, `verPerguntaNaConversa`, `criarToqueLongo`, `ligarTopoEncolhe`,
`abrirBusca`. Nenhuma duplicação de regra de contagem (travada por teste).

**Testes.** Diagrama acima. Lacuna conhecida: sem e2e de navegador; coberta por QA manual a 390 px e
`alvos-44px`. Teste de propriedade para a contagem.

**Performance.** A aba Quadros faz 1 GET ao abrir (cache no módulo). Redesenho da inicial já é memoizado por
`lembrar("sidebar")`; a aba entra na chave. Blur só em 2 elementos pequenos. Escuta de rolagem passiva + rAF.

**Modos de falha.**

| Falha | Teste? | Tratamento? | Visível? |
|---|---|---|---|
| `GET /quadros` falha | sim | sim (erro + tentar) | sim |
| `suaVez` null | sim | sim (esqueleto) | sim |
| Alvo do pedido não aparece | já existe | sim (faixa-trabalhos) | sim |
| Clique após segurar o ‹ | sim | sim | — |
| Escuta duplicada do topo | sim | sim | — |

Nenhum gap crítico (falha silenciosa sem teste).

**Fora de escopo:** F2/F3 (chips, composer, teclado), N:N de quadros (ADA-14), Atividade dentro de Sua vez.

## Revisão de design (/plan-design-review)

| Passo | Nota | O que levou a 10 |
|---|---|---|
| 1. Arquitetura da informação | 9/10 | Três raízes claras; busca separada do lugar. Falta só Quadros N (Gil). |
| 2. Estados | 9/10 | Tabela de bordas cobre vazio, carregando, erro, muitos, parcial. |
| 3. Jornada | 8/10 | Sino→aba e deep link→aba descritos; toque longo tem caminho de teclado. |
| 4. Risco de "cara de IA" | 9/10 | Sem cards, sem ícones decorativos, sem gradiente; ponto em vez de número. |
| 5. Design system | 9/10 | Tokens `--cel-*`, `--ink`, `--surface`; medidas do protótipo. |
| 6. Responsivo e acessibilidade | 9/10 | 44 px, safe-area, dvh, reduced-motion, `aria-current`, foco preso na folha. |
| 7. Decisões abertas | — | Ver abaixo. |

Estados por tela:

| Tela | Vazio | Carregando | Erro | Cheio |
|---|---|---|---|---|
| Conversas | `INICIO_VAZIO` (existe) | `ESQUELETO_DO_INICIO` (existe) | existente | lista + título encolhe |
| Quadros | "Ainda não há quadros…" | 3 linhas esqueleto | "Não deu para carregar" + tentar | agrupado por bot |
| Sua vez | "Nada esperando por você." | 3 linhas de 76 px | "Não deu para atualizar" | lista, clamp 2 |
| Recentes | "Sem conversas recentes." | — (frota já carregada) | — | até 8, aberta marcada |

## Suposições (Ada e Gil confirmam)

1. **Aba Quadros com N quadros**: lista agrupada por bot (por projeto depois da ADA-14), nome ou "Tarefas", 0 →
   vazio que leva às Conversas; tocar abre a conversa na página Tarefas. **Gil/Ada.**
2. **Sua vez no celular** mostra só abertos não vencidos; vencidos, incidentes e fora do ar ficam fora da aba (o
   computador continua mostrando). **Ada.**
3. **Recentes** = bots ordenados pela última mensagem, até 8, com a aberta marcada. **Gil.**
4. **Sai no celular**: a barra "Buscar" de baixo (vira o botão redondo), o sino e o botão de não lidos do topo (viram
   aba e ponto). **Gil.**
5. A tab bar **só nas telas raiz**; conversa, quadro e tarefa sem ela (do protótipo). O + continua no topo.
6. Tocar na aba já ativa rola a lista ao topo.

## GSTACK REVIEW REPORT

| Revisão | Status | Achados |
|---|---|---|
| Eng (/plan-eng-review) | CLEAR (plano) | 0 críticos; 6 riscos com mitigação; lacuna e2e coberta por QA |
| Design (/plan-design-review) | CLEAR (plano) | média 9/10; 1 decisão aberta (Quadros N) |
| Ações (/acao-no-chat) | Ações: nenhuma ação nova | paridade sem mudança |

Decisões não resolvidas: aba Quadros com N quadros (Gil/Ada, ADA-14) e o recorte de Sua vez no celular (Ada).
