# Protótipo: um dono por bot

Protótipo da [ADR-098](../../adr/adr-098-um-dono-por-bot.md) e do [plano](../../plano-um-dono-por-bot.md), feito em
2026-10-11 para o Marlon aprovar. O canvas interativo é a página "Um dono por bot" de
https://claude.ai/artifact/5G1k3LayQRehZoP4ZmuWyQ (privado, na conta em que foi criado). Esta pasta é a cópia que não
depende de acesso a ele.

- `telas/`: um PNG por quadro, 1440 × 900, gerados de `fonte/` com o `chrome-headless-shell` do Playwright.
- `fonte/`: o código das telas no formato do canvas de Design (`canvas.json` + um `.dc.html` por tela). Os quadros usam o
  desenho de barra lateral e conversa dos protótipos de 07/10 do mesmo canvas, não o CSS de `web/`; pode haver pequenas
  diferenças em relação ao app de hoje. Para reabrir num canvas novo, publique estes arquivos sob `project/`.
- A cena é a tarde de 11/10 com o Ze 1, o Leonardo e o PR #845 do gamefik. O dia real está em "Hoje"; o resto é a mesma
  tarde com a proposta. As falhas às 18:52 e 19:58, o Ze 2 pegando o B07/B08, os passos da frente do mobile e o texto das
  opções do cartão são exemplo.

## As telas

| Arquivo | O que mostra |
|---|---|
| `01-hoje.png` | Hoje, 11/10 20:33: Trabalhos com 13 linhas "volta às…", quase todas do Ze 1, e 1 trabalhando de fato |
| `02-conversa.png` | A conversa do Ze 1 é a dona: o Leonardo pede, o Ze 1 abre 3 frentes e volta com uma resposta só; o pedido das 17:29 entra na fila ("se for urgente, o Ze 2 começa da main"); acima do campo, uma linha: "Esperando a CI do #845 · 38 min · 2 pedidos na fila" |
| `03-bloco-aberto.png` | A linha aberta: o comando que espera (`gh pr checks 845 --watch`, última linha, tentativa 2 de 3), as frentes do dia e a fila |
| `04-precisa-de-voce.png` | Três tentativas sem verde: o Ze 1 para e pergunta na conversa, com opções; a linha diz "Esperando você · 2 pedidos na fila" e o avatar ganha o ponto azul |
| `05-trabalhos.png` | Trabalhos com uma linha por bot (Precisa de você 1, Trabalhando 2, Esperando 1, livres numa linha); o Ze 2 aberto mostra as frentes |
| `06-frentes.png` | Três frentes rodando: a linha "Começou 3 frentes…" na conversa e "Trabalhando em 3 frentes · 1 pedido na fila" acima do campo |
| `07-frentes-abertas.png` | A linha aberta com cada frente e o último passo; a do mobile mostra os passos até o comando que roda agora |
| `08-casos-da-linha.png` | Os casos da linha acima do campo, por prioridade: Esperando você > Trabalhando em N frentes > Esperando X > N na fila > livre (some) |
