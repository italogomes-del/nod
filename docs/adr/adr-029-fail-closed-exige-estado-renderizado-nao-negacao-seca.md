# ADR-029 — Fail-closed exige estado renderizado, não negação seca

**Status** novo · **Origem** comparação OpenMausBot × hermes-agent nas quatro features core

## Decisão

Toda negação por indisponibilidade do servidor é renderizada com nome, causa e relógio — 'conector indisponível: servidor fora há 4 min' — e nunca aparece como recusa genérica ou silêncio. Fail-closed continua sendo a política; o que este ADR fixa é a superfície. Três classes com render distinto: ferramenta negada (turno continua, agente pode escalar), conector gerenciado indisponível (a capacidade some, o trabalho do dia continua degradado) e plano de turno ausente (nenhum trabalho começa).

## Contexto

O ADR-013 fixou 'servidor mudo = negado'. Aplicado ao trabalho do DIA, que por ADR-014 invertido roda local com a assinatura da pessoa, uma queda de 20 minutos deixa o time inteiro sem ferramenta nenhuma. Negar uma ferramenta e derrubar o Slack no meio de uma conversa são classes de dano diferentes e foram tratadas como a mesma coisa.

## Alternativas rejeitadas

### Cache local do último catálogo válido

É autoridade local por outro nome, e o Hermes mostra aonde isso leva: bridge.py devolve {} em qualquer exceção e segue ('Connector search failed silently'), que é fail-open puro.

### Manter negação seca e resolver com documentação

Vocês já decidiram que silêncio é estado renderizado. Negação sem causa visível é exatamente o silêncio que a decisão proíbe.

## Evidência

tools/connectors/gateway/bridge.py (verificado: degrada em silêncio, fail-open) como o anti-padrão. index.ts:2733 waitForChatRoomMember do OMB como o padrão certo em outro contexto: espera, narra a espera, e só pula com a razão escrita na sala.

## Consequências

- Exige um SLA do servidor da organização antes de a política virar operação.
- Todo motivo de negação vira enum por ADR-004, compartilhado com o enum de motivo de passe do grupo.

## Reversibilidade

Alta. É superfície.

