# ADR-073 — Camada de conversa pt-BR

**Status** novo · decidido em 2026-10-04 (plano em docs/plano-modo-ligacao.md)

## Decisão

Regras puras e testadas em `src/domain/ligacao-*.ts`, com relógio injetado:

- **VAD por energia** no servidor (piso adaptativo, limiar maior com o bot falando) decide início e fim de fala.
- **Fim de turno:** 600 ms de silêncio + final do STT; +800 ms se a frase termina em conjunção, preposição ou hesitação;
  −300 ms em fecho ou resposta curta; teto de 3 s.
- **Falas de espera** gravadas uma vez por voz e tocadas do cache (nunca TTS ao vivo no caminho crítico):
  reconhecimento (300 ms, ≤40%, só em pedido), pensando (1,6 s e 4 s), ferramenta (1,2 s), tarefa longa, não entendi,
  ociosidade, quedas; sem repetir entre as últimas ⌈n/2⌉ nem em 60 s; textos neutros em gênero.
- **Texto falável:** sem markdown; código, tabela e link vão para o chat; até ~60 palavras por resposta; corte em
  frases pt-BR que nunca quebra em "Sr.", "1.000,50", "14h30", "v1.2.3" ou URL.
- **Interrupção:** o cliente baixa o volume na hora; o servidor confirma com 2 palavras fora do backchannel, 1 palavra
  de parada ou 600 ms de fala; sem confirmação em 1,2 s, o volume volta. "Uhum", "tá" e "aham" nunca interrompem.
- **Eco:** fala sobreposta à do bot que repete ≥60% das palavras dele é descartada.

## Metas

Primeiro som p50 ≤1,0 s; conteúdo (Claude) p50 ≤2,0 s. Medido em 2026-10-04 no UAT local (whisper base + `say` +
Claude Code real, M1): STT ~200 ms depois do fim da fala; primeiro conteúdo 1,6–2,1 s depois da vez decidida; com
ferramenta, ~3,6 s, com espera tocando aos ~1,2–1,5 s.
