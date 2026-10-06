# ADR-079 — A parada ativa fica visível na conversa, e mandar mensagem a desfaz

Status: proposto (não implementado) · Data: 2026-10-05 · Complementa a ADR-024 (parada persistida) e a ADR-029 (o que a
conversa mostra quando nada roda). Implementação: issue [#154](https://github.com/marlonwlv/nod/issues/154).

## Contexto

Medido no nod diário em 2026-10-05, 22:25–22:35. Na conversa com o Leonardo, o Marlon mandou "??" e "tá demorando
muito… vou pedir ela pra te passar", apertou **Parar** às 22:31:50 e, minutos depois, relatou que "o nod diário travou
de novo". O que havia:

- `paradas` com uma linha ativa para a conversa (`encerrada_em` nulo), gravada pelo Parar;
- o turno de 22:28 `interrompido` com `parado_pela_pessoa`, sem ter rodado (`attempted: false`), e sem nada na
  conversa além da linha "■" da parada, que já tinha rolado para cima;
- o botão da conversa continuava sendo "Parar" (ele só aparece com turno vivo) e o compositor aceitava mensagem nova
  como se tudo estivesse normal; a mensagem entrava na fila e era interrompida em silêncio.

A parada funcionou como desenhada (ADR-024: nada roda até retomar). O que faltou foi a conversa dizer isso.

## Decisão

1. **Faixa fixa enquanto a parada vale.** Com `paradas.ativa(conversa)` verdadeira, a conversa mostra, colada ao
   compositor, uma faixa de estado (design system, tom "alerta"): "**Parado por você às 22:31.** Nada roda nesta
   conversa até você retomar." com o botão **Retomar**. A faixa não rola com o histórico e some ao retomar. A parada
   geral (todas as conversas) ganha a mesma faixa com "Parado por você em todas as conversas".
2. **Mandar mensagem retoma.** Enviar texto numa conversa parada encerra a parada e enfileira o turno, numa transação
   só (`enviarMensagem` chama o `retomar` quando há parada ativa); a linha "■ retomado" entra antes da mensagem. O
   botão de enviar diz **Retomar e enviar** enquanto a faixa está lá, para não surpreender.
3. **O que foi barrado não se perde.** O turno interrompido com `parado_pela_pessoa` por mensagem da própria pessoa é
   mostrado como "esta mensagem não rodou: a conversa estava parada" (aviso de estado, tom neutro), com "Mandar de
   novo" — a mesma regra do executor indisponível (ADR-029), com outra causa.
4. **Rotina e delegação respeitam a parada em silêncio**, como hoje: só a mensagem da pessoa a desfaz.

## Alternativas descartadas

- **Só a linha "■" no histórico:** é o que existe; rolou para cima e virou "travou".
- **Bloquear o compositor enquanto parado:** obriga dois cliques para dizer "continue"; a pessoa que fala com o bot
  quer que ele volte.
- **Retomar sozinho depois de N minutos:** o Parar é o freio de emergência (ADR-024); ele não pode soltar sozinho.

## Gatilho de reversão

Se alguém usar a conversa parada como bloco de notas ("anote isso, mas não faça nada") e se queixar de o bot ter
voltado ao receber a mensagem, o item 2 volta a pedir confirmação ("Retomar e enviar?") em vez de retomar direto.
