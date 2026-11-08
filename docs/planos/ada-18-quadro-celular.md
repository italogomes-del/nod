# ADA-18 · Celular F3: quadro em lista agrupada, visão no título e colunas com snap

Plano de engenharia da fatia 3 da ADA-2 (protótipo `nod-prototipos/ada-2` v2, jornada 3, telas
`p_quadro`, `p_quadro_view`, `p_quadro_colunas`, `p_quadro_menu` e `p_quadro_mover`). Cobre os
critérios 1, 2, 8, 9, 11, 12 e 13 da ADA-2. Vale **só no celular** (`CONSULTA_CELULAR`, de
`web/lib/celular.ts`). Depende da F1 (PR #644, `addd5d02`), que já está na main.

Fora do escopo: o composer único e a resposta no quadro (ADA-4/5/6), os gestos da pílula (ADA-8),
prioridade e labels (o protótipo deixa de fora "até o campo existir").

Regra fixa: **1 PR por issue**. Este PR nasce em draft com este plano e recebe a implementação.

## 1. O que muda para quem usa

1. **Lista agrupada sem fundo** (visão padrão). Cada status é um grupo: cabeçalho cinza de 13 px
   com o ícone do status, o nome, a contagem e o `+`. Linhas de 52 px com o título na largura toda,
   o ID embaixo e o avatar à direita. A 1ª tarefa fica a 231 px do topo da página (com o topo da F1
   aberto). Há divisor só entre grupos, nunca entre linhas.
2. **Visão no título**. O nome do quadro vira o título da página; tocar nele abre uma folha com
   Lista, Colunas e Minhas tarefas (a atual marcada) e, abaixo de um divisor, Ordem das colunas.
   A escolha fica gravada por quadro e volta igual na próxima abertura e em outro aparelho.
3. **Colunas**. Colunas de 280 px, com a próxima espiando à direita, `scroll-snap` por coluna e
   pontos embaixo indicando a coluna atual. Só a faixa das colunas rola de lado; a página continua
   com `scrollWidth = 390`.
4. **Toque longo na linha** (ou no card da coluna) abre um menu: Mover para…, Atribuir, Copiar link
   (e Prazo, ver S1). Mover abre numa folha "Mover VER-5 para" com linhas de 56 px, ícone do status
   e o atual marcado.
5. **⋯ do topo** leva a Pessoas, Atividade, Prazo do quadro e Ordem das colunas.

No computador (acima de 600 px ou sem toque) nada muda: a grade e a forma Lista|Quadro atuais seguem
iguais (critério 13).

## 2. Arquitetura

O desenho segue a ADR-148: **a forma muda, as ações não**. Tudo o que o celular faz chama as mesmas
ações do registro que o computador já usa. A única extensão de contrato é dar à visão um campo no
`exibir` do quadro (seção 4), que já é por quadro e já é jsonb.

```
quadro-na-tela.ts (controlador)
  ├─ estado: visao ("lista" | "colunas" | "minhas"), lido de preferencias.quadroExibir[id].visao
  ├─ celular() ? desenharCelular(visao) : desenho atual (sem mudança)
  │     ├─ listaDoCelular()      web/telas/quadro-celular.ts  (novo, puro: dados → HTML)
  │     ├─ colunasDoCelular()    web/telas/quadro-celular.ts
  │     ├─ folhaDaVisao()        web/telas/quadro-celular.ts
  │     ├─ menuDaTarefa()        web/telas/quadro-celular.ts  (toque longo)
  │     └─ folhaDeMover()        reaproveita menuDeMover/naFolha de colunas-quadro.ts
  ├─ toqueLongo.ts               web/lib/toque-longo.ts (novo: 500 ms, cancela com 10 px de movimento)
  ├─ pontosDasColunas.ts         web/lib/pontos-das-colunas.ts (novo: IntersectionObserver → ponto ativo)
  └─ ações → api.quadro.lote([...]) (já existe) e api.exibirQuadro(id, {visao}) (já existe)
```

Telas continuam funções puras que devolvem HTML (`web/telas/*`), com eventos por `data-act`
resolvidos no controlador, como o resto do quadro. Nada de framework novo.

## 3. Módulos e arquivos

| Arquivo | O que muda |
|---|---|
| `web/telas/quadro-celular.ts` (novo) | `listaDoCelular`, `colunasDoCelular`, `folhaDaVisao`, `menuDaTarefa`, `menuDoTopo`. Puro, testável em unit. |
| `web/telas/quadro.ts` | `linha()` ganha o ID embaixo do título e `data-codigo` para o toque longo; `lista()` aceita `semFundo` e `divisorEntreGrupos`. Sem mudança no HTML do computador. |
| `web/telas/quadro-real.ts` | `quadroDaMeta` passa a chamar o desenho do celular quando `celular()`; `topoDoQuadro` ganha o título que abre a visão e o ⋯ com o menu do topo (só no celular). O `menuDePrazo` com `select` nativo vira folha no celular (critério 8). |
| `web/telas/colunas-quadro.ts` | `menuDeMover` ganha a variante de folha com linhas de 56 px e o atual marcado. |
| `web/lib/quadro-na-tela.ts` | estado `visao`, leitura/gravação via `exibirQuadro`, ligação do toque longo, das folhas e dos pontos. |
| `web/lib/vista-do-quadro.ts` | `vistaMinhas(tarefas)`: aplica `ehComigo` e achata em lista única ordenada por coluna. |
| `web/lib/toque-longo.ts` (novo) | detector de toque longo com cancelamento por rolagem. |
| `web/lib/pontos-das-colunas.ts` (novo) | ponto ativo pela coluna mais visível. |
| `web/quadro-celular.css` (novo) | tudo dentro de `CONSULTA_CELULAR`, como `celular-base.css`; usa `--cel-alvo`, `--cel-corpo`. |
| `web/paginas.css` | sem mudança (segue escondendo Lista\|Quadro no celular; a visão nova a substitui lá). |
| `src/contracts/quadro.ts` / `src/contracts/preferencias*` | `ExibirDoQuadro` ganha `visao?: "lista" \| "colunas" \| "minhas"`. |
| `src/use-cases/raio-x.ts` | `exibirDoQuadro` valida `visao` (enum) além dos booleanos. |
| `src/repositories/raio-x.repo.ts` | `exibirQuadro` faz merge da chave nova no jsonb (sem trocar o objeto inteiro). |
| `src/domain/acoes/conversa.ts` | `preferencias.exibir_quadro` passa de `ESTADO_DA_TELA` a viva pela via `gerir_quadro` (seção Ações). |
| `src/contracts/ferramentas-quadro.ts` / `src/use-cases/quadro.ts` | op `exibir` no `gerir_quadro`, executada pelo mesmo caso de uso `exibirDoQuadro`. |

## 4. Dados e migrações

**Nenhuma migração.** A visão entra no jsonb `preferencias.quadro_exibir` (migração 0149), que já é
por quadro (`{ [quadroId]: { recolhidas, compacto } }`) e tem teto `QUADROS_COM_EXIBIR_MAX`. Passa a
ser `{ recolhidas, compacto, visao }`. Ausente = `"lista"`. Leitura tolerante: valor desconhecido
vira `"lista"`.

Se a Ada escolher o caminho B de prazo (S1), aí sim entra a migração aditiva
`0152_prazo_da_tarefa.sql` (`ALTER TABLE quadro_tarefas ADD COLUMN prazo date NULL`, com ROLLBACK),
num commit separado e só depois da emenda à ADR-148.

## 5. APIs

- `PUT /preferencias/quadros/:id/exibir` (ação `preferencias.exibir_quadro`, já existe): aceita
  `visao`. Corpo parcial; o servidor faz merge. 400 para `visao` fora do enum.
- `gerir_quadro` ganha a op `{ tipo: "exibir", visao }` no quadro corrente (mesma validação, mesmo
  caso de uso, mesmo dono). Chamada pelo chat por id do quadro.
- Mover, Atribuir, Ordem das colunas, Pessoas e Prazo do quadro usam o lote do quadro que já existe
  (`aplicarLoteQuadro`). Nenhuma rota nova.

## 6. Ações

Ações novas: **nenhuma**. Uma ação existente ganha via de chat (`preferencias.exibir_quadro`).

| Gesto no celular | Ação do registro (`src/domain/acoes`) | Via de chat | Situação |
|---|---|---|---|
| Mover para… | `quadro.mudar_tarefa {status}` | `gerir_quadro` | reaproveitada, viva |
| Atribuir | `quadro.mudar_tarefa {agente}` | `gerir_quadro` | reaproveitada, viva |
| Ordem das colunas | `quadro.mover_coluna` | `gerir_quadro` | reaproveitada, viva |
| Pessoas | `quadro.adicionar_pessoa` / `quadro.tirar_pessoa` | `gerir_quadro` | reaproveitada, viva |
| Prazo do quadro (⋯) | `quadro.editar {prazo}` | `gerir_quadro` | reaproveitada, viva |
| Troca de visão | `preferencias.exibir_quadro {visao}` | `gerir_quadro` op `exibir` | **muda de `ESTADO_DA_TELA` para viva** |
| Copiar link | — (sem efeito no servidor) | o bot já responde com o link `?tarefa=CÓDIGO` | fica fora do registro, como os demais gestos só de tela |
| Prazo da tarefa | não existe (ver S1) | — | follow-up ou emenda à ADR-148 |
| Atividade (⋯) | leitura do histórico que já existe | — | só leitura |

Como a troca de visão fica viva (checklist do `/acao-no-chat`):

1. **Registro**: em `src/domain/acoes/conversa.ts`, `preferencias.exibir_quadro` troca
   `chat: ESTADO_DA_TELA` por `{ via: "gerir_quadro", contrato: "paridade-quadro" }`, com `schema`
   (`{ quadro, visao?, recolhidas?, compacto? }`) e `casoDeUso: exibirDoQuadro`. `validarRegistro`
   passa a exigir os três, como já exige das `quadro.*`.
2. **Rota.acao**: `PUT /preferencias/quadros/:id/exibir` já declara `acao: "preferencias.exibir_quadro"`;
   sem mudança.
3. **Executor único**: o `case "exibir"` de `aplicarLoteQuadro` chama `exibirDoQuadro`, o mesmo da
   rota. Nenhuma regra duplicada.
4. **Ferramenta**: `PROPRIEDADES_QUADRO` ganha `visao` (enum, com descrição "visão do quadro no
   celular: lista, colunas ou minhas") e a descrição do `gerir_quadro` cita a op.
5. **Teste de contrato**: caso novo em `tests/integration/paridade-quadro.test.ts` — a mesma troca pela
   rota e pela ferramenta deixa `preferencias.quadroExibir[id]` igual; `visao` inválida dá o mesmo
   erro pelas duas vias.
6. **Piso**: o caso entra no piso de cobertura das ações vivas (o `fuzz-acoes` ganha o semeio do
   quadro, como no NOD-443).
7. **`npm run paridade`** verde no commit da ação.

Mover e Atribuir por id pelo chat já funcionam hoje (`gerir_quadro mudar_tarefa {tarefa: "VER-5",
status | agente}`); o plano só cobra um teste de regressão de que o toque longo manda exatamente esse
lote.

## 7. Bordas e erros

- **Quadro vazio**: grupos vazios mostram só o cabeçalho com `0` e o `+`; sem nenhum status com
  tarefa, estado vazio inline ("Nada por aqui. Toque em + para criar.") — sem modal, como no NOD-460.
- **Muitas colunas** (>6): os pontos viram contador "3/9" acima de 7; o snap segue por coluna; a
  folha da visão lista as colunas para pular direto (âncora).
- **Minhas tarefas sem tarefas**: estado vazio inline "Nada com você agora." com atalho para Lista.
- **Toque longo × rolagem**: 500 ms parado; cancela se o dedo andar mais de 10 px ou se houver
  `scroll` no contêiner; `contextmenu` e seleção de texto desligados na linha
  (`-webkit-touch-callout:none; user-select:none`). Toque curto continua abrindo a tarefa. Vibração
  curta (`navigator.vibrate?.(10)`) quando houver.
- **Toque longo × snap**: na visão Colunas o toque longo só arma depois que o snap assenta
  (`scrollend`, com fallback de 120 ms).
- **Falha ao mover/atribuir**: otimista com volta; toast de erro com "Tentar de novo". Conflito de
  concorrência (outro bot mexeu) recarrega a tarefa e avisa.
- **Falha ao gravar a visão**: a visão muda na hora e fica em memória; erro silencioso com nova
  tentativa na próxima troca (é preferência, não dado).
- **Visão desconhecida vinda do servidor**: cai em Lista.
- **Rotação / sair do celular**: ao passar de 600 px, volta ao desenho do computador sem perder a
  visão gravada.
- **Acessibilidade**: título é `button` com `aria-haspopup="dialog"` e `aria-expanded`; a folha da
  visão é `role="dialog"` com `aria-modal` e foco preso; opções com `role="menuitemradio"` e
  `aria-checked`. Toque longo tem equivalente sem gesto: botão ⋯ por linha visível só para leitor de
  tela (`.so-leitor`) e atalho de teclado (`Shift+F10`/`ContextMenu`). Faixa de colunas com
  `aria-roledescription="carrossel"` e cada coluna `role="group"` com rótulo "Coluna 2 de 5:
  Implementando". Pontos são `aria-hidden` (o rótulo da coluna já informa). Alvos ≥ 44 px
  (`--cel-alvo`), corpo 16 px. `prefers-reduced-motion` tira o `scroll-behavior:smooth`.
- **Folhas**: `max-height: 85dvh` com rolagem interna (critério 12) e safe-area embaixo.

## 8. Testes

Unit (`tests/unit/web/`):
- `quadro-celular.test.ts`: lista agrupada (cabeçalho com ícone, contagem e `+`; ID embaixo; sem
  divisor entre linhas e com divisor entre grupos), colunas (280 px por classe/variável, pontos),
  folha da visão (atual marcada, Ordem das colunas presente), menu da tarefa (itens e `data-act`),
  estados vazios.
- `vista-do-quadro.test.ts`: `vistaMinhas` (só `ehComigo`, ordem por coluna, vazio).
- `toque-longo.test.ts`: dispara em 500 ms; cancela com 10 px; cancela com scroll; não dispara no
  toque curto.
- `pontos-das-colunas.test.ts`: ponto ativo pela coluna mais visível; contador acima de 7.
- `quadro-real.test.ts` / `colunas-quadro.test.ts`: o HTML do computador não muda (snapshot) —
  critério 13.

Integração (`tests/integration/`):
- `paridade-quadro.test.ts`: `exibir {visao}` pela rota e pela ferramenta; inválida = 400 igual;
  merge não apaga `recolhidas`/`compacto`.
- `raio-x` / preferências: leitura tolerante de `visao` ausente ou desconhecida.

Chrome real, celular 390×844 (`tests/concurrency/quadro-celular-chrome.test.ts`, novo, no molde do
`quadro-jornada-chrome`):
- Medidas: linha = 52 px; linha da folha de mover = 56 px; 1ª tarefa a 231 px do topo; coluna =
  280 px; `document.scrollingElement.scrollWidth === 390` nas três visões.
- Snap: rolar a faixa assenta em múltiplo da coluna; o ponto acompanha.
- Visão: trocar para Colunas, recarregar, continua Colunas.
- Toque longo → Mover → folha → status novo aparece no grupo certo; toque longo + arrasto não abre
  menu.
- Folha com `select` nativo não aparece em nenhum fluxo do quadro no celular (critério 8).
- Regressão do computador (1280×800): grade e Lista|Quadro iguais.
- Prints das cinco telas anexados ao PR para o Gil comparar com o protótipo.

## 9. Riscos

- **ADR-148 e a via nova de chat**: dar chat a `preferencias.exibir_quadro` não cria ação, mas estende
  o schema. Registro um adendo curto na ADR-148 ("a visão do quadro no celular é preferência por
  quadro; vive em `preferencias.exibir_quadro`, com via `gerir_quadro`"). Se a Ada achar que a visão
  não deve ir ao chat, o commit 4 sai e o resto fica igual.
- **Toque longo no iOS** abre o menu nativo de link/seleção se o CSS falhar: cobrir no Chrome com
  emulação de toque e conferir no Safari do Gil.
- **231 px depende do topo da F1**: se o topo mudar, o teste de medida quebra de propósito — a medida
  vira constante única em `web/lib/celular.ts`.
- **`quadro-na-tela.ts` tem 3.363 linhas**: a lógica nova vai para módulos novos e o controlador só
  liga; nada de crescer o arquivo além do necessário.
- **Conflito com ADA-17** (chip de prazo) e com ADA-4/5/6 (composer na mesma tela): rebase por merge
  da main antes de cada push grande; as áreas tocadas são diferentes, mas o topo é comum.

## 10. ADRs tocadas

- **ADR-148 (base do celular)**: seguida (forma muda, ações não; CSS dentro de `CONSULTA_CELULAR`;
  tokens `--cel-*`; `scrollWidth = 390`). Adendo sobre a visão (risco 1). Prazo da tarefa, se for o
  caminho B, exige emenda antes do código.
- **ADR-135 (registro único de ações)**: seguida (seção 6).
- Sem ADR nova.

## 11. Passos (commits no mesmo PR)

1. `ADA-18: plano de engenharia` — este documento.
2. `ADA-18: lista agrupada do celular` — `quadro-celular.ts`, `quadro-celular.css`, ajustes em
   `linha()`/`lista()`, unit + snapshot do computador.
3. `ADA-18: visão no título com Lista, Colunas e Minhas tarefas` — folha da visão, `vistaMinhas`,
   estado no controlador, `visao` no contrato/caso de uso/repo (merge no jsonb), unit + integração.
4. `ADA-18: troca de visão pelo chat` — registro vivo, op `exibir` no `gerir_quadro`, contrato em
   `paridade-quadro`, fuzz, `npm run paridade`, adendo na ADR-148.
5. `ADA-18: colunas de 280 px com snap e pontos` — faixa, `pontos-das-colunas.ts`, unit.
6. `ADA-18: toque longo com Mover, Atribuir e Copiar link` — `toque-longo.ts`, menu, folha de mover
   de 56 px, equivalente acessível, unit.
7. `ADA-18: ⋯ do topo com Pessoas, Atividade, prazo e ordem` — menu do topo, prazo do quadro em folha
   (sem `select`).
8. `ADA-18: e2e do celular com as medidas` — `quadro-celular-chrome.test.ts`, prints.
9. (Só se S1 = B) `ADA-18: prazo da tarefa` — emenda ADR-148, migração aditiva, `prazo` em
   `quadro.mudar_tarefa`, contrato, item Prazo no toque longo.

`npm run check` completo uma vez antes de pedir revisão; testes do que mudou a cada commit.

## 12. Suposições para decidir

Para a **Ada** (produto):
- **S1 — Prazo da tarefa.** A tarefa não tem prazo no modelo (só o quadro e a coluna). Suposição:
  tirar Prazo do toque longo nesta fatia e abrir follow-up, como o protótipo faz com prioridade e
  labels. Alternativa B: emendar a ADR-148 e criar `quadro_tarefas.prazo` + `prazo` em
  `quadro.mudar_tarefa` (commit 9). Coordenar com a ADA-17.
- **S2 — Onde a visão é gravada.** A issue diz "em `preferencias.salvar`". Suposição: gravar no
  `exibir` por quadro (`preferencias.exibir_quadro`), que já existe e é por quadro, sem migração; o
  `preferencias.salvar` é global e ainda não tem via de chat (onda NOD-397).
- **S3 — Visão pelo chat.** Suposição: sim, pela op `exibir` do `gerir_quadro` (seção 6). Sem isso, a
  visão fica só na tela e o commit 4 sai.
- **S4 — Minhas tarefas** = o filtro Comigo (`ehComigo`: status Precisa de você e não decidido por
  outra pessoa), em lista plana. Hoje quem é atribuído às tarefas são bots, então "atribuídas a mim"
  ficaria quase sempre vazio.
- **S5 — Copiar link** copia `…/quadro/<id>?tarefa=CÓDIGO`; pelo chat, o bot responde com esse link
  (sem ação no registro).

Para o **Gil** (design):
- **S6 — Filtros**: manter os atuais (Todas, Comigo, agentes, Trabalhando) com a estética do
  protótipo (ativo em pílula com ícone, os outros em texto).
- **S7 — Muitas colunas**: pontos até 7, contador "3/9" acima disso.
- **S8 — Ordem das colunas** aparece na folha da visão (como no protótipo) e também no ⋯.
- **S9 — Toque longo**: 500 ms com vibração curta; equivalente acessível por ⋯ só para leitor de tela.

## 13. O que depende de pessoa

- Ada: S1 a S5 (S1 muda o escopo; as outras seguem com a suposição se não houver resposta).
- Gil: S6 a S9 e o confronto visual dos prints com o protótipo.
- Nenhuma credencial, OAuth ou infra.
