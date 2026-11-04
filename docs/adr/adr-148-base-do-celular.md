# ADR-148 — A base do celular: a forma muda, as ações não

Status: aceita (2026-11-03, ADA-2 F1) · Emenda a [ADR-094](adr-094-celular-e-a-mesma-web-instalavel.md) (item 3, "no
celular o layout só reorganiza o que existe"), só no celular.

## Contexto

A auditoria a 390 px (ADA-2) achou o quadro com 755 px de largura (a meta em `nowrap` de `paginas.css`), alvos de 28 a
32 px, campos de 13–14 px (o iOS dá zoom ao focar), a tarefa aberta numa caixa dentro da tela e o topo em degradê por
cima do conteúdo. O protótipo v2 do Gil (ADA-2) pede mais do que reorganizar: tamanhos, pesos e superfícies próprios do
celular. O item 3 da ADR-094 não deixava isso explícito.

## Decisão

1. **No celular a forma pode mudar; as ações não.** Tamanho, peso, superfície, quebra de linha e posição podem ser
   próprios do celular; nenhuma ação nova nem tirada, sem API nem migração por causa da forma. Mudança de fluxo (tab
   bar, abas, toque longo) segue em PR de fase próprio, citando esta ADR.
2. **Uma folha só para a base**, `web/celular-base.css`, carregada depois de `mobile.css`, inteira dentro da consulta
   canônica (`CONSULTA_CELULAR`, `web/lib/celular.ts`). `tests/unit/web/celular.test.ts` recusa regra fora dela: a
   janela estreita no computador não muda (critério 13 da ADA-2).
3. **Tokens de forma** em `tokens.css`: `--cel-alvo` (44), `--cel-campo` (16, campo sem zoom no iOS) e `--cel-corpo`
   (16). São medidas, não cor: iguais nos dois temas.
4. **Topo de vidro só quando rolado** (`web/lib/topo-encolhe.ts`): parado no topo a faixa não tem fundo; rolado,
   `topo-encolhido` liga `backdrop-filter`. Blur só na faixa e nas pílulas, nunca em lista. A escuta é de rolagem
   passiva com um quadro de animação, só lê `scrollTop` (a rolagem guardada é da ADA-12) e reavalia na troca do
   `hidden` do quadro. Sem sentinela com IntersectionObserver: o `#timeline` e a `.qd-conteudo` são regravados a cada
   render.
5. **Nada passa da largura**: a 390 px `scrollWidth` = 390 em conversa, barra, quadro e tarefa.

## Gatilho de reversão

Se uma fase do celular precisar de uma ação que o computador não tem, ela volta a esta ADR e decide aqui antes.
