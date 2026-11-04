# ADA-8 · Plano de engenharia: os gestos da pílula (quadro, chat e busca)

Base: `origin/main` @ `addd5d02`. 1 PR por issue. Revisões aplicadas no plano: eng (escopo, arquitetura, bordas, testes),
design (hierarquia, descoberta, motion, a11y) e ação no chat (seção Ações).

## 1. O mapa de hoje (celular e web)

A pílula do topo é a cápsula `.qd-pil` (nome do bot + doca de páginas + pontinhos, `web/telas/conversa.ts:1708`,
`web/telas/paginas.ts:41`). Dois reconhecedores de gesto independentes ouvem o mesmo dedo:

| Gesto | Onde | Dispara | Código |
| --- | --- | --- | --- |
| Toque no nome | todos | painel do bot (`alternar-detalhes`) | `web/telas/conversa.ts:1719` |
| Puxar ↓ 36 px | celular | abre a busca (a pílula segue o dedo, ½ até 30 px) | `web/main.ts:2104-2149`, `web/lib/descoberta-da-busca.ts:36-45` |
| Empurrar ↑ 36 px no miolo da busca | celular | fecha a busca | idem |
| Segurar 500 ms | celular | menu "Buscar na conversa" | `web/main.ts:2084`, `2117-2123` |
| Segurar 380 ms | celular | abre a doca | `web/lib/paginas-na-tela.ts:260-274`, `web/lib/paginas.ts:122` |
| Arrastar ↔ 36 px (decide o eixo em 6 px) | celular | troca de página, pílula "estica como líquido" | `web/lib/paginas-na-tela.ts:275-306`, `paginas.ts:116` |
| Segurar ícone da doca aberta | celular | menu do ícone | `paginas-na-tela.ts:231-238` |
| Arrastar ícone da doca aberta | todos | muda a ordem | `paginas-na-tela.ts:217-258` |
| Tocar fora | celular | fecha a doca | `paginas-na-tela.ts:264` |
| Hover 120 ms / sair 260 ms | web | abre / fecha a doca | `paginas-na-tela.ts:107-118` |
| Roda ou trackpad, **qualquer eixo** | web | troca de página | `paginas-na-tela.ts:134-145`, `paginas.ts:106` |
| Foco numa aba | web | abre a doca | `paginas-na-tela.ts:120-130` |
| ⌥← → / ⌥⇧← → (Alt fora do Mac) | web | troca / move a página | `web/lib/atalhos.ts:154`, `web/lib/setas-da-pilula.ts` |
| ⌘[ ⌘] | web | troca a página | `web/lib/atalhos.ts:144` |
| ← → no nome ou nas abas | web | troca a página (tablist) | `web/lib/quadro-na-tela.ts:2018-2029` |
| ⌘F, Esc | web | abre / fecha a busca | `web/main.ts:2038`, `descoberta-da-busca.ts` |
| Pontinhos | todos | só mostram (`pointer-events: none`, 5 px) | `web/paginas.css:44-46` |

### Por que a troca incomoda (os defeitos encontrados no código)

1. **Segurar tem dois significados que disparam juntos**: aos 380 ms abre a doca e aos 500 ms o menu da busca abre por
   cima (dois timers, um em cada módulo).
2. **A diagonal dispara os dois**: a página decide o eixo em 6 px com `|dx| >= |dy|`; a busca olha só o `dy` no fim.
   Um arrasto 40 → / 40 ↓ troca de página **e** abre a busca.
3. **Dois donos escrevem o mesmo `transform`** da `.qd-pil` a cada `pointermove` (translateY da busca e a esticada da
   página) — a pílula treme na diagonal.
4. **Sem alternativa visível por toque**: a doca nasce com largura 0 e só abre segurando; os pontinhos não recebem toque.
5. **Na web, rolar a roda sobre a pílula troca de página** (`passoDaRoda` aceita o eixo vertical): passar o mouse
   rolando pelo topo troca a página sem querer.
6. **`touch-action` misto**: a cápsula é `pan-y` (paginas.css:6) e o nome é `none` (mobile.css:827): começar o gesto nos
   pontinhos/doca dá `pointercancel` no vertical.

### Por que a busca funciona (a referência)

Um eixo, um sentido, um resultado grande e visível; a pílula **segue o dedo** (½ do arrasto, teto 30 px) e volta se não
passar do limiar; o gesto inverso desfaz (empurrar ↑ fecha); há caminho visível (menu do segurar, ⌘F) e uma dica uma vez
só. Linear iOS segue o mesmo princípio: um gesto por superfície, troca de vista por toque no título/segmento visível, sem
gesto escondido como único caminho. (Multica mobile: sem fonte pública que eu tenha conseguido verificar; não usei.)

## 2. O mapa novo (poucos gestos, um sentido cada)

**Celular (toque)** — um reconhecedor só na cápsula, eixo travado em 10 px com dominância 1,5× (diagonal não faz nada):

| Gesto | Faz | Alternativa visível |
| --- | --- | --- |
| Tocar no nome | painel do bot (igual) | — |
| Puxar ↓ | busca (igual, a referência); empurrar ↑ no miolo fecha | menu do segurar |
| Deslizar ↔ | página anterior/próxima, **com a física da busca**: segue o dedo ½ até 30 px, troca além de 36 px, tranco na ponta | tocar nos pontinhos / menu |
| Tocar nos pontinhos (alvo 44×24 px) | abre/fecha a doca; tocar num ícone vai à página | — |
| Segurar 450 ms | **um menu só**: "Buscar na conversa" + as páginas (a atual marcada). Não abre mais a doca | — |

Ícone da doca aberta: segurar = menu do ícone, arrastar = ordem (igual). A "esticada de líquido" sai (dois tipos de
feedback para dois gestos irmãos confundiam); fica o seguir-o-dedo, igual ao da busca.

**Web**: hover/foco abrem a doca (igual); **a roda só troca no eixo horizontal** (trackpad de lado, `|dx| > 1,5·|dy|`);
teclado igual (⌥← →, ⌥⇧← →, ⌘[ ], ⌘F, Esc, setas no tablist).

Dica da primeira vez (toque): "deslize para o lado ou toque nos pontos".

**Rolagem (ADA-7/ADA-12)**: nenhum gesto novo no corpo (timeline, colunas do quadro, lista da tarefa). Tudo fica na
cápsula do topo, que não rola; a cápsula inteira passa a `touch-action: none` no celular (só ela).

## 3. Arquitetura

```
pointerdown na .qd-pil ──► gesto-da-pilula-na-tela (único dono do dedo e do transform)
   │ timer 450 ms ─────────────────────────────► menu (Buscar + páginas)
   │ pointermove: eixoDoGesto(dx,dy) ─ null ──► espera (≤10 px ou diagonal)
   │                         ├─ "y" ──► translateY(acompanhar(dy))  (busca)
   │                         └─ "x" ──► translateX(acompanhar(dx))  (página, se total > 1)
   └ pointerup: fimDoGestoDaPilula(...) ─► buscar | fechar-busca | pagina ±1 | tranco | nada
```

- **Novo `web/lib/gesto-da-pilula.ts`** (puro, sem DOM): `eixoDoGesto`, `acompanhar`, `fimDoGestoDaPilula`,
  `passoDaRodaHorizontal`, `SEGURAR_MS = 450`, `TRAVA_PX = 10`, `DOMINANCIA = 1.5`.
- **Novo `web/lib/gesto-da-pilula-na-tela.ts`**: o reconhecedor de toque, com callbacks (`buscaAberta`, `podeBuscar`,
  `abrirBusca`, `fecharBusca`, `abrirMenu`, `paginas: {total, atual, irPara}`, `reduzido`) e o "engolir o clique".
- **`web/lib/paginas-na-tela.ts`** perde o bloco do toque (segurar/arrastar/esticar) e expõe `abrir/alternar` da doca;
  fica com hover, foco, roda, reordem, dica e espiar.
- **`web/main.ts`** perde o reconhecedor da busca (2101-2160) e liga o novo; o menu da pílula ganha as páginas.
- **`web/telas/paginas.ts`/`paginas.css`**: pontinhos tocáveis no toque, alvo de 44×24 px. Implementado: seguem um
  `span` `aria-hidden` tratado pela classe (o teclado já abre a doca pela tablist); o clique deles alterna a doca no
  `paginas-na-tela.ts`, sem API nova de `abrir/alternar` (desvio registrado na emenda da ADR-146).

Dados/migrações: nenhum. APIs: nenhuma. ADR: emenda à ADR-146 (§6, o mapa de gestos) com gatilho de reversão.

## 4. Ações

Ações: nenhuma ação nova. Trocar de página e abrir a busca são estado de tela (ADR-135 §2); mover a ordem segue em
`paginas.ordenar` (vivo, já no registro). Sem rota nova; `npm run paridade` não muda.

## 5. Bordas e erros

Uma página só (sem doca): ↔ não faz nada, sem tranco. Busca aberta: ↔ e segurar desligados no miolo; só ↑ fecha.
Camada por cima (diálogo, Seu espaço, ligação): nenhum gesto. Dois dedos / `pointercancel`: solta sem efeito.
Movimento reduzido: sem acompanhar nem tranco (só a troca). Cabeçalho regravado no meio do gesto: o estado mora no
módulo e o transform é reaplicado no nó vivo. Clique depois de gesto: engolido só no cabeçalho (fora do item do menu).

## 6. Testes

- Unit (`tests/unit/web/gesto-da-pilula.test.ts`): eixo (10 px, 1,5×, diagonal = null), fim (busca só no y, página só no
  x, limiar 36, ponta), roda horizontal, menu com páginas.
- Chrome real (`tests/concurrency/quadro-chrome.test.ts`, toque por CDP): diagonal não faz nada; ↓ só busca; ↔ só página;
  segurar só menu (doca fechada); pontinho abre a doca; roda vertical não troca, horizontal troca.
- Ajustar `tests/unit/web/paginas.test.ts` e `descoberta-da-busca.test.ts` ao que saiu.

## 7. Riscos

Tirar a esticada muda o protótipo aprovado da NOD-445 (Gil revisa). Quem usava a roda vertical no mouse perde esse
atalho (fica hover + clique e ⌥← →). iOS Safari: o segurar pode abrir a lupa/seleção — `user-select: none` e
`-webkit-touch-callout: none` na cápsula.

## 8. Critérios de aceite

iOS Safari e Chrome Android:
1. Arrasto diagonal (40 px → e 40 px ↓) na pílula não troca de página nem abre a busca.
2. Puxar ↓ 36 px abre a busca e nunca troca a página; empurrar ↑ no miolo fecha.
   Suposição (QA do #651): fora da Conversa, a busca é "na conversa" e leva a ela (decisão da NOD-429, igual ao menu e
   ao ⌘F). "Nunca troca a página" quer dizer: o ↓ não anda para a página vizinha.
3. Deslizar ↔ 36 px troca uma página; a pílula segue o dedo durante o arrasto; abaixo de 36 px volta sem trocar.
4. Segurar 450 ms abre só o menu (Buscar + páginas, a atual marcada); a doca não abre; escolher uma página vai a ela.
5. Tocar nos pontinhos abre a doca; tocar num ícone vai à página e a doca fecha.
6. A rolagem da conversa, do quadro e da tarefa não muda (ADA-7/ADA-12 seguem verdes).

Desktop (Chrome, Safari, app do Mac):
7. Rolar a roda vertical com o mouse sobre a pílula não troca de página; o trackpad de lado troca uma por gesto.
8. Hover/foco abrem a doca; ⌥← →, ⌥⇧← →, ⌘[ ], ⌘F e Esc seguem iguais.

## 9. Passos (commits)

1. `gesto-da-pilula.ts` puro + testes.
2. Reconhecedor único no DOM; sai o toque de `paginas-na-tela.ts` e o da busca do `main.ts`.
3. Menu do segurar com as páginas; pontinhos tocáveis.
4. Roda só horizontal; dica nova; `touch-action` da cápsula.
5. Testes no Chrome por toque.
6. Emenda da ADR-146.

## Onde encosta

ADA-4/5/6 são a pílula do **composer** do quadro (envio, composer, resposta): nada aqui muda nela. ADA-7/ADA-12: a
rolagem; aqui nenhum gesto no corpo. NOD-461: o teclado fica como está. ADA-20 (Celular F5, toque longo na conversa):
o toque longo das mensagens não é da pílula.
