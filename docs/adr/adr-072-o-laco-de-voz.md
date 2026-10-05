# ADR-072 — O laço de voz: turno `ligacao` próprio, fora da serialização

**Status** novo · decidido em 2026-10-04 (plano em docs/plano-modo-ligacao.md) · emendada em 2026-10-05 (NOD-164: o
modelo da ligação)

## Decisão

- Ligar cria, na mesma tx, a linha em `ligacoes`, a mensagem "Chat de voz" e um turno `origem='ligacao'` (0047/0048,
  `turnos.ligacao_id`). O turno **não serializa** com o trabalho do bot nos dois sentidos (os dois `NOT EXISTS` de
  `reivindicar` ignoram `ligacao`), passa na frente da fila e só vai para máquina que anunciou `ligacao` no `conectar`.
- O plano tem modo `ligacao`: catálogo da conversa sem `pedir_a_pessoa` nem artefatos, mais `iniciar_tarefa` e
  `desligar`; sem terminal; sem a sessão da conversa; prompt de voz (`montarPromptLigacao`) e `ligacaoVoz` com o modelo
  rápido (resolvido no servidor; ver a emenda de 2026-10-05: hoje `claude-sonnet-4-6` sem thinking; Codex: `gpt-6-luna`).
- **Claude Code:** `claude -p` com stream-json e stdin aberto a ligação inteira, `--system-prompt` de voz,
  `--tools ""`, `--no-session-persistence`, `MAX_THINKING_TOKENS=0`. A vez 0 aquece o cache e não é falada. No `fim`,
  pede um resumo de até 5 linhas. Mensagem escrita com uma volta em curso **abre outra volta** (dois `result`); o laço
  pula o `result` da volta que já corria e fecha a entrada no seguinte (45 s de teto). O resumo vira mensagem do bot.
- **Interrupção:** suave (a próxima vez leva "a pessoa ouviu até …") ou dura (`control_request interrupt`, só se o
  `system/init` anunciar `interrupt_receipt_v1`).
- **`iniciar_tarefa`** enfileira um turno de conversa do bot ligado à ligação; quando termina, o orquestrador manda uma
  `nota` com vez própria e o bot avisa falando, numa brecha. **`desligar`** encerra depois da última frase; o que vier
  depois não é falado.
- O turno da ligação não aparece como trabalho na tela (frames ignorados, `vivosDaConversa` e `pendentesRenderizaveis`
  o excluem), o Parar não o derruba e ele nunca ganha aviso de interrupção nem card "Retomar".

## Medido em 2026-10-04 (`scripts/sonda-ligacao-claude.ts`, CLI 2.1.289, Haiku 4.5, US$ 0,0035)

- `system/init` anuncia `interrupt_receipt_v1`, `interrupt_cancel_queued_v1` e `interrupt_send_now_v1`.
- Primeiro texto com o `--system-prompt` de voz: 1.628 ms a frio, 632 ms quente (`ttft_ms` 631).
- `control_request interrupt` no meio de uma resposta: `control_response` em 5 ms, `result` (`error_during_execution`)
  em 10 ms, e o processo segue vivo — a mensagem seguinte responde em 1.180 ms.
- Mensagem escrita com a volta em curso: dois `result` (volta própria).

## Por quê

A sessão do bot é longa, com kit pesado e prompt de texto; a ligação pede respostas em ~1–2 s. Um turno próprio, curto
e efêmero, deixa o trabalho pesado na sessão do bot sem travar a conversa.

## Alternativas rejeitadas

- **Mesma sessão do bot.** Prompt de texto, kit do terminal e thinking: lento, e a ligação travaria o trabalho.
- **Absorver a fala pela renovação.** A renovação é de 1 s; a fala vai pelo canal do cérebro, direto.

## Emenda 2026-10-04 — de qual vez é cada pedaço de texto: o eco do CLI

Medido em 2026-10-04 (`scripts/sonda-voltas-ligacao.ts`, CLI 2.1.289, Haiku 4.5, US$ 0,02), com
`--replay-user-messages`:

- Mensagem escrita com o **texto saindo**: é lida depois do `result` e abre outra volta (dois `result`), como a
  primeira sonda já tinha medido.
- Mensagem escrita com uma **ferramenta rodando**: é lida na **mesma** volta, logo depois do resultado da ferramenta,
  e o modelo passa a responder a ela. Um `result` só.
- O CLI ecoa cada mensagem (`type:"user"`, `isReplay:true`) no instante em que a lê, com o `uuid` que mandamos.
- `interrupt` com `cancel_queued` e uma mensagem na fila: a mensagem é cancelada (`cancelled` na resposta) e nunca é
  lida; a escrita logo depois do `interrupt` é respondida normalmente.
- Resposta que termina numa ferramenta, sem texto depois: o CLI injeta "[Your previous response had no visible
  output…]" e o modelo repete a fala e a ferramenta (três vezes na sonda). Quem fala antes de uma ferramenta tem de
  escrever algo depois dela.

O driver marcava o texto com a última vez **escrita**. Com uma vez nova escrita durante a volta anterior, o `result`
da volta antiga saía como `fala-fim` da vez nova: o servidor dava a vez por respondida e descartava a resposta de
verdade — a ligação ficava muda. Agora cada mensagem leva um `uuid` e o driver só troca de vez quando o eco dela
chega. Sem a flag (CLI antigo) ou até o primeiro eco aparecer, vale a regra antiga. O `fim` usa o mesmo eco para saber
qual `result` é o do resumo.

## Emenda 2026-10-05 — o modelo da ligação é do servidor (NOD-164)

O Haiku 4.5 sai do ar, não antes de 2026-10-15, e o plano B desta ADR (trocar por `NOD_MODELO_LIGACAO_*` no app) nunca
funcionou: a denylist `NOD_` de `montarAmbiente("local")` apaga essas variáveis antes de os drivers lerem. O teste do
Codex que deveria provar a troca passava com ou sem o override, porque montava o `cfg` à mão.

- **Onde se escolhe:** no servidor. `NOD_MODELO_LIGACAO_CLAUDE="<modelo> [esforco=<nível>] [pensamento=adaptativo|desligado]"`
  e `NOD_MODELO_LIGACAO_CODEX="<modelo>"`, lidas por `lerModelosLigacao` (`src/domain/modelo-ligacao.ts`). Vazio vale o
  padrão (`MODELOS_LIGACAO_PADRAO`); valor fora do formato impede o boot, com erro em pt-BR citando a variável. Só o
  formato é validado: um id inexistente passa pelo boot e falha na primeira ligação.
- **O plano leva tudo:** `ligacaoVoz.modelo`, mais `esforco` e `pensamentoAdaptativo` (só Claude, opcionais; app antigo
  ignora). Os drivers não escolhem modelo: o override por env saiu do Claude e do Codex.
- **Padrão:** `claude-sonnet-4-6` com `pensamentoAdaptativo:false`, sem esforço. Na família 4.6 o thinking adaptativo
  ignora `MAX_THINKING_TOKENS=0`; com `false`, o driver injeta `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=1` no filho.
  `esforco` vira `--effort` só se o `--help` do CLI listar a flag (mesmo gate do chat); sem ela, a ligação segue e sai
  o log `ligacao_sem_effort`. Codex: `gpt-6-luna`, só o modelo.
- **A guia no "auto"** continua no `fable` (ADR-077), com o `pensamentoAdaptativo` da config e sem o `esforco` dela.
- **Trocar ou reverter** é uma linha no `infra/gcp/config.env` e o deploy (`deploy.sh` leva as duas ao `nod.env`). Enquanto
  o Haiku 4.5 estiver no ar (pelo menos até 2026-10-15), vale voltar para `claude-haiku-4-5-20251001`; depois, para o 4.6. O Sonnet 5.5 low só entra pela config,
  se a sonda medir dentro do corte: TTFT quente ≤ 1,0 s, 1ª fala ≤ 2,5 s e custo ≤ 3x o do Haiku.
- **Sondas:** `MODELO_SONDA_PADRAO` também passa ao Sonnet 4.6. `scripts/sonda-ligacao-claude.ts` usa o
  `montarArgsLigacao` e o `ambienteDaLigacao` reais e aceita `--modelo`, `--esforco` e `--pensamento`.

**Riscos aceitos.** App desktop antigo não injeta a variável do thinking: no 4.6 a ligação fica mais lenta, não
quebra (soltar a candidata do desktop antes do deploy, ou segurar o Haiku na config até lá). O 4.6 custa perto de 3x
o Haiku pela tabela. `turno_despachado.dados.modelo` não registra o modelo de voz; a comparação em produção usa a
janela do deploy (`primeiro_delta_ms`/`primeiro_tocado_ms` do log `ligacao_vez`).
