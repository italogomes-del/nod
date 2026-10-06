# ADR-075 — Dados da ligação e LGPD

**Status** novo · decidido em 2026-10-04 (plano em docs/plano-modo-ligacao.md)

## Decisão

- `ligacoes` (0048): só colunas tipadas — estado, quem iniciou, provedores, voz, horários, motivo do fim, duração,
  contadores, custo estimado, latência p50/p95, avaliação. Uma viva por pessoa (índice único parcial). Sempre
  `visibility='privado'`.
- `ligacao_falas`: a prosa (quem falou, o quê, quando, se foi interrompida), apagável pela dona
  (`DELETE ligacoes/:id/falas`). O registro e o **resumo** (mensagem do bot) ficam.
- Na conversa, a linha **"Chat de voz · mm:ss"** é uma mensagem `sistema` com `payload.kind = "ligacao"`, criada no
  início e atualizada no fim (fica antes de tudo o que o bot fez durante a ligação).
- **Consentimento versionado** (`preferencias.voz_consentimento_versao`, `VERSAO_CONSENTIMENTO_VOZ`): antes da primeira
  ligação ("Concordo e ligar"; no onboarding, o próprio "Atender"). A versão sobe quando muda o provedor.
- **Sem poda automática** da transcrição: só a dona apaga. **Nenhum áudio** é gravado. Bots da equipe não atendem na v1.
- Evento `ligacao_mudou` → frame `ligacao.mudou` (só ids e estado, nunca fala).

## Por quê

A voz é dado sensível; o áudio sai do Brasil para o provedor (com DPA, decisão de 2026-10-03), mas nada fica guardado
além do texto que a própria pessoa controla.

## Emenda 2026-10-06 — ouvir uma resposta fora da ligação (NOD-180)

- Ouvir uma resposta manda o texto dela ao mesmo provedor de TTS da ligação. Por isso exige o **mesmo consentimento
  versionado** (`VERSAO_CONSENTIMENTO_VOZ`): sem ele, a rota recusa com `estado_invalido` antes de chamar o TTS. O texto
  do aviso já cobre ("a voz do bot também é gerada lá"); a versão não sobe.
- **Nenhum áudio é gravado** (nem em disco, nem em cache): cada "ouvir" sintetiza de novo, com `cache-control: no-store`.
- O **teto diário** de caracteres fica só em memória e zera no reinício; não há tabela nova nem registro por mensagem.
- Só respostas de bot próprio, prontas e de texto, na conversa própria dele. Sala e bot da equipe ficam de fora, como
  na ligação.
- O log `voz_leitura` leva ids e contagens, nunca o texto lido.

