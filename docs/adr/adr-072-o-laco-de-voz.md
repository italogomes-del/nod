# ADR-072 — O laço de voz: turno `ligacao` próprio, fora da serialização

**Status** novo · decidido em 2026-10-04 (plano em docs/plano-modo-ligacao.md)

## Decisão

- Ligar cria, na mesma tx, a linha em `ligacoes`, a mensagem "Chat de voz" e um turno `origem='ligacao'` (0047/0048,
  `turnos.ligacao_id`). O turno **não serializa** com o trabalho do bot nos dois sentidos (os dois `NOT EXISTS` de
  `reivindicar` ignoram `ligacao`), passa na frente da fila e só vai para máquina que anunciou `ligacao` no `conectar`.
- O plano tem modo `ligacao`: catálogo da conversa sem `pedir_a_pessoa` nem artefatos, mais `iniciar_tarefa` e
  `desligar`; sem terminal; sem a sessão da conversa; prompt de voz (`montarPromptLigacao`) e `ligacaoVoz` com o modelo
  rápido (`MODELO_LIGACAO_CLAUDE` = Haiku 4.5 pelo id; Codex: `gpt-6-luna`; trocáveis por `NOD_MODELO_LIGACAO_*`).
- **Claude Code:** `claude -p` com stream-json e stdin aberto a ligação inteira, `--system-prompt` de voz,
  `--tools ""`, `--no-session-persistence`, `MAX_THINKING_TOKENS=0`. A vez 0 aquece o cache e não é falada. No `fim`,
  pede um resumo de até 5 linhas: **o pedido entra na volta em curso** (medido em 2026-10-04 no UAT com o CLI 2.1.289)
  e o primeiro `result` depois dele fecha a entrada. O resumo vira mensagem do bot.
- **Interrupção:** suave (a próxima vez leva "a pessoa ouviu até …") ou dura (`control_request interrupt`, só se o
  `system/init` anunciar `interrupt_receipt_v1`).
- **`iniciar_tarefa`** enfileira um turno de conversa do bot ligado à ligação; quando termina, o orquestrador manda uma
  `nota` com vez própria e o bot avisa falando, numa brecha. **`desligar`** encerra depois da última frase; o que vier
  depois não é falado.
- O turno da ligação não aparece como trabalho na tela (frames ignorados, `vivosDaConversa` e `pendentesRenderizaveis`
  o excluem), o Parar não o derruba e ele nunca ganha aviso de interrupção nem card "Retomar".

## Por quê

A sessão do bot é longa, com kit pesado e prompt de texto; a ligação pede respostas em ~1–2 s. Um turno próprio, curto
e efêmero, deixa o trabalho pesado na sessão do bot sem travar a conversa.

## Alternativas rejeitadas

- **Mesma sessão do bot.** Prompt de texto, kit do terminal e thinking: lento, e a ligação travaria o trabalho.
- **Absorver a fala pela renovação.** A renovação é de 1 s; a fala vai pelo canal do cérebro, direto.
