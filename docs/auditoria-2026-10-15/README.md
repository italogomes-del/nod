# Auditoria do núcleo do Nod: relatório único

Data: 15/10/2026. Para: Marlon. Base: `origin/main 81a1c532`.

**Para ler com conforto:** abra [`relatorio.html`](relatorio.html) no navegador (baixe o arquivo e dê dois cliques). Ele tem o resumo e os dois relatórios completos em abas, e precisa de internet só para a fonte e para renderizar o Markdown. A mesma página existe como artifact privado do Claude na conta **marlonwlv@gmail.com**: https://claude.ai/artifact/LNh1qsxnCWYbvYyEjv64kw. O acompanhamento das correções é o projeto **Núcleo confiável** no Linear (time NOD).

Este arquivo junta duas auditorias que rodaram em paralelo na madrugada e na manhã de 15/10:

- **Auditoria de código:** [`auditoria-de-codigo.md`](auditoria-de-codigo.md). Nove subsistemas do núcleo e dez cenários de uso percorridos pelo código, com 139 agentes. Resultado: **92 achados confirmados** (9 de severidade alta), 5 plausíveis, 3 refutados e 20 não verificados. Os ids são letras com número: A1, B1, E1…
- **Forense do banco de produção (somente leitura):** [`forense-de-producao.md`](forense-de-producao.md). Os seus 9.794 turnos, os relatos de bug, as frentes, as rotinas, os pedidos entre bots, as contas e os eventos, com 58 agentes. Resultado: **23 achados confirmados**. Os ids são C1 a C23.

Cada achado passou por um autor, que o encontrou, e por um cético, que tentou derrubá-lo. "Confirmado" quer dizer que o caminho foi conferido linha a linha no código, e que o forense também contou os casos em produção. **Quase nenhum achado foi reproduzido rodando o sistema.** Conferi pessoalmente os três mais graves da auditoria de código: A1 e A2 se confirmam no código, e A1 é regressão do commit `d14c7b1e`.

---

## 1. O que está acontecendo, em uma página

**O caminho feliz funciona, e o banco está íntegro.** Não há corrupção de estado:
- nenhum elo quebrado nas cadeias de retomada;
- os 1.149 trabalhos têm o estado gravado igual ao derivado;
- o outbox entregou 64.526 de 64.528 itens, em 0,3 a 0,5 s;
- 93,7% dos turnos terminam bem, sem contar o dia 12/10.

**O problema é outro: o sistema segura e mata trabalho em silêncio.** Isso se repete em quatro padrões, nos dois relatórios.

1. **O limite passou da IA para a conta, mas quase todo o resto ainda decide pela IA ou pela origem do turno.**
   - O portão da cota segura a IA inteira, e a conta Team ficou livre e sem uso por cerca de 40 h, com 38 turnos presos.
   - Turnos já na fila guardam a IA de quando nasceram.
   - Frentes da pessoa, triagens de colega, rotinas sem frente e o retorno do lote morrem em vez de esperar.
   - Notas prometem "Seguindo com X" e nada segue.
2. **Estados sem saída e sem aviso.**
   - Máquina "zumbi" depois de 60 a 90 s de silêncio.
   - Turno de ligação encerrada que trava a fila.
   - Parada que nunca fecha e mata rotinas e pedidos no despacho.
   - Pedido de colega que espera para sempre.
   - Janelas de rotina que somem do histórico.
3. **Relógio errado ou fato copiado no nascimento do turno.**
   - A retomada mede a queda pela *criação* do turno, então uma frente longa caída é abandonada na hora (E1 = C4).
   - Anexo, marca de contaminação, pedido original e IA da sessão não passam para o turno seguinte.
4. **O que o servidor sabe não chega à tela.**
   - A barra só relê quando o estado de um trabalho muda.
   - O EventSource fica meio aberto sem perceber.
   - Botões não fazem nada, por exemplo "Rodar no <máquina> desta vez" (C1).

**E o servidor ficou duas horas fora hoje.** Entre 08:07 e 10:12, ninguém conseguia usar o banco, e o reiniciei às 10:12 com a sua autorização. A causa junta três achados:
- o pool tem só 5 conexões (`src/db/client.ts:15`);
- as chamadas a conectores rodam dentro da transação do banco (forense C17);
- o Docker marca o contêiner como `unhealthy`, mas não reinicia.

O gatilho foi a rotina de Gmail da Clarice: 14 chamadas `GMAIL_ADD_LABEL_TO_EMAIL` com `timeout_transporte`. Essa rotina roda às 8h, 13h e 18h nos dias úteis e pode repetir o problema.

---

## 2. Ordem de ataque

Ordem por impacto dividido pelo tamanho do PR. **[DECISÃO]** marca o que precisa de decisão sua ou de ADR antes de codar. Os ids apontam para os relatórios completos.

### Lote 0: o servidor não pode cair por causa de um conector (hoje ou amanhã)
1. Tirar a chamada HTTP a conectores e a execução de itens aprovados de dentro da transação (C17).
2. Prazo para pegar uma conexão do pool e pool maior, para o servidor falhar a requisição em vez de travar inteiro.
3. Healthcheck que reinicia de fato: o processo sai quando a saúde falha N vezes, ou um autoheal.
4. Monitor externo em `/api/saude`, já previsto pela ADR-017 e ainda inexistente. Hoje quem descobriu a queda fui eu, por acaso.
5. Teto de reenvios em `aposLimite`, `aposTrocaDeConta` e `repetirNaConversa` (forense C5 ≈ código B1). Já gerou 682 turnos e 682 avisos em 32 minutos no dia 12/10.

### Lote 1: a máquina recebe trabalho de novo (1 a 2 dias)
- **A1 (regressão de 13/10, conferida):** máquina só com o Codex nunca puxa turno, e toda mensagem é negada mandando entrar no Claude Code. Causa: `desktop/main.ts:529` e `motor/main.ts:247` anunciam `comContas["claude-cli"] ?? principal`, e o Claude sempre tem inventário no mapa, mesmo sem login.
- **A2 (conferido):** silêncio de 60 a 90 s deixa a conexão viva com o inventário "ausente" para sempre (`rotas/ponte.ts:426-433`). A tela diz "pronto" e o servidor nega toda mensagem.
- **A3:** turno-cérebro de uma ligação encerrada fica pendente e trava a fila da máquina com voz.
- **A4, A9:** `conectar` responde 409 para sempre depois de o processo morrer e voltar em menos de 90 s; o laço puxa antes do primeiro `conectar`.

### Lote 2: cota por conta e uma regra única de espera (3 a 5 dias) [DECISÃO: emenda à ADR-099 §7]
- O portão olha a conta que o turno usaria, e não a IA. Quando a conta preferida entra em reserva, a fila passa para outra conta livre da mesma IA, se o modo e a regra de corporativa permitirem.
- Todo turno de fundo (frente, retorno do lote, rotina, triagem) espera com `acordar_em`. Quem decide é o tipo do turno, não a origem. Achados: G1, C2, C7, D1, H2, C6, D7, D8; forense C2, C9, C11.
- Trocar a IA ou a conta do bot reescreve os turnos pendentes dele (forense C3).
- **Decidir:**
  - a conta corporativa entra no trabalho de fundo?
  - rotina sem frente espera ou falha com a hora da volta?
  - frente em Automático espera na sessão ou troca de IA?

### Lote 3: queda, deploy e retomada (3 a 4 dias)
- **E1 = C4:** gravar `interrompido_em` e usá-lo nos três leitores. A mudança é pequena e faz a retomada automática de frente e de pedido voltar a funcionar.
- **E2 a E6, E8, G3:** aprovação com o turno "despachando" numa máquina que dormiu; Parar com a máquina fora; tolerância de 30 a 60 s ao deploy; adoção depois do deploy. Complementa a NOD-218.

### Lote 4: pedidos entre bots e Parar (2 a 3 dias) [DECISÃO: a parada vale para rotina e delegação?]
- **H1:** no fan-out, um resultado parcial é entregue como final.
- **F1:** Parar não cancela o pedido ao colega, e a resposta dele reabre o trabalho parado.
- **F2:** a parada aberta mata rotinas e pedidos no despacho.
- **H3 a H5, G9, F3.**
- Fechar o pedido quando o colega o trata numa conversa com a pessoa (bugs `a5d1121a` e `e3f3c0e3`).
- Trava de pedido repetido por par: o Leonardo fez 22 pedidos ao Ze 1 em 24 h (forense C7).

### Lote 5: a tela diz a verdade (2 a 3 dias)
- **Web:** watchdog de ping no EventSource, `retomar()` que reabre a fonte meio aberta, releitura ao voltar para a janela, e `dono.ts` sem contar turno de sala.
- **Infraestrutura:** desligar o HTTP/3 no Caddy (centenas de quedas por "no recent network activity").
- **Achados:** J1 a J3, D3, G8, G12, I6, e o custo que hoje não inclui o Codex (D4, D5, D9, D10).
- **Notas e botões de contas:** C1, C3, C4, C5, C8, C9, B5, L1, L2, C12, A5.

### Lote 6: rotinas (2 a 3 dias)
- I1 a I10 da auditoria de código.
- Do forense:
  - janela pulada ou interrompida com desfecho registrado (C8, C9);
  - pré-voo que ignora a pergunta das voltas (C10);
  - `turnoAberto` fora do O(janelas × turnos) (C16);
  - retomada redundante (C18).
- Decidir o que fazer com uma execução de rotina atrasada há mais de um período do cron.

### Lote 7: herança entre turnos e sessão do CLI (2 a 3 dias) [DECISÃO e ADR: B3]
- **B3 vem primeiro:** hoje a produção nunca retoma a sessão do CLI (`permitirResume: !daPonte`). Escolher entre sessão por máquina e "sem sessão" muda o desenho de K2 e B8.
- **D2, B2, K1 a K3, B4:** uma retomada leva o mesmo pedido, com o anexo, a marca de contaminação e a IA corretos.

### Lote 8: dados e polimento
- Backfill de `executor` em 2.179 turnos (C13, C23). Recalcular o custo inflado depois de `--fork-session`, com até US$ 170 num único turno (C14).
- Classificador de erro, causa da entrega sem `result`, relato da fala da pessoa (C12, C19, C20).
- Lotes 9 a 11 da auditoria de código: frentes e fecho, salas e cópia de bot, polimento de harness.

---

## 3. Para destravar à mão hoje

Nada disto foi executado. Prefira sempre a ação pela tela (Parar, responder), que grava os eventos. Os detalhes estão em [`forense-de-producao.md` §7](forense-de-producao.md).

1. **Rotina de Gmail da Clarice (`b1706cdb`):** pausar até sair o Lote 0, ou acompanhar a janela das 13:00. Ela pode derrubar o servidor de novo.
2. **Perguntas pendentes do Leonardo:** a decisão `4f191137` (rotina `57b9b36b`) vence às 13:15. A `e749ec80` (rotina `3ecfa179`) venceu às 11:19.
3. **Turno `dcdbf4af`, rotina de 10 min da Clarice:** pará-lo pela tela. Assim a próxima janela já nasce no Codex.
4. **Os 19 a 22 pedidos do Leonardo ao Ze 1 e os 3 ao Cartola:** decidir antes de 16/10 13:00. Se ficarem, saem todos em série quando a cota renovar.
5. **As 9 rotinas presas desde 14/10 10:00:** se ficarem, rodam na renovação com a instrução de dois dias atrás. Pare-as pela tela se a janela nova valer mais.
6. **Cota do Claude:** esperar até 16/10 13:00, ou pôr a Team em primeiro e mandar uma fala a um bot do Claude. Isso é inferência pelo código, não foi testado, e a Team é corporativa.
7. **Frente `a305c426` do Milton**, na fila desde 14/10 10:56: usar "Fazer aqui" se não quiser esperar.

---

## 4. Decisões de produto pendentes

1. O portão da cota passa a ser por conta, e a conta corporativa pode ser usada no trabalho de fundo?
2. Rotina sem frente, triagem e retorno do lote esperam o limite ou falham com a hora da volta?
3. Frente em Automático troca de IA na hora ou espera na sessão (D7)?
4. Bot com IA fixa ganha fallback para outra IA ou só para outra conta?
5. A parada vale para rotina e delegação (F2)?
6. Sessão do CLI em produção: por máquina ou sem sessão (B3, pede ADR)?
7. "Testar agora" fura a reserva da cota (I9)?
8. O que fazer com uma execução de rotina atrasada além de um período do cron? Pausa automática depois de N "sem novidade"?
9. Prazo para turno preso a máquina morta (G8)?
10. Sala repete o turno (L1, L4)? Turno sem alvo no modo "perguntar" roda onde há conta (C12)?
11. Cópia de bot herda o modo de aprovação (M4)?
12. Religar as pendências, desligadas desde 06/10 com 70 abertas?

---

## 5. Lacunas

- **Nada foi reproduzido rodando o sistema.** Antes de priorizar E4, B1, A2 e E5, vale medir em produção:
  - a duração do deploy;
  - as cadeias de `reenvios`;
  - os eventos `laco_renovar_falhou` e `adocao_falhou`.
- **Fora do escopo:**
  - voz além do A3;
  - computador do bot;
  - conectores e marketplace;
  - segurança do hook;
  - isolamento entre tenants;
  - instalação e atualização do app;
  - o modo local, com o servidor no Mac.
- **Cenários sem veredito consolidado:**
  - tarefa por voz absorvida pelo turno vivo;
  - "×N" de acesso fechando a gêmea de outro turno;
  - aprovar depois do Parar;
  - renomear o bot muda a pasta;
  - o deploy drena o motor da VM no meio de uma frente.
- **Fora desta auditoria:** o relato do Breno. A conta dele em produção não tem turnos nem máquinas, e falta saber a que servidor o app dele está ligado.
- **Linear:** nenhum achado tem issue própria.
