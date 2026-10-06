# ADR-080 — Prompt de texto em `--system-prompt` com o marcador de cache

Status: aceito, medido no CLI 2.1.290 · Data: 2026-10-06 · NOD-183 · Estende a NOD-155 (o prompt em parte estável e
volátil, #163) e reaproveita o marcador do prompt de voz ([ADR-072](adr-072-o-laco-de-voz.md)).

## Contexto

A NOD-155 separou o prompt de sistema do turno de texto em duas partes: a estável (agente, modo, catálogo, colegas,
rotinas) e a volátil, no fim (quem pediu, profundidade, computador, terminal, memória, pendências, contexto). Mas o
driver do claude-cli continuou passando o prompt por `--append-system-prompt`, que o CLI acrescenta ao prompt padrão do
Claude Code. Medido abaixo: no 2º turno com outro remetente, só cerca de 1,4 mil tokens vinham do cache, ou seja, o
prefixo cacheável acabava antes da parte estável do nod.

A sonda `scripts/sonda-system-prompt-texto.ts` monta o prompt real de delegação (`partesDoPromptSistema`, 7 colegas, um
conector com 20 ferramentas, memória e contexto), troca só a forma de entregar o prompt e mede, em sessões novas, o
2º turno com a parte volátil diferente (Cecília → Chico). Rodada em 2026-10-06, CLI 2.1.290, modelo sonnet:

| Forma | Prompt padrão | cachePct 2º turno | Lido / escrito | Custo 2º turno |
|---|---|---|---|---|
| `--append-system-prompt` sem marcador (até aqui) | mantido | 16% | 1384 / 7532 | US$ 0,0305 |
| `--append-system-prompt` com marcador | mantido | 15% | 1384 / 7568 | US$ 0,0306 |
| append + `--exclude-dynamic-system-prompt-sections` (com ou sem marcador) | mantido | 16% | 1384 / ~7350 | US$ 0,0297 |
| `--system-prompt` (estável) + `--append-system-prompt` (volátil) | substituído | 13% | 883 / 5894 | US$ 0,0238 |
| **`--system-prompt` com estável, marcador e volátil** | substituído | **75%** | **5070 / 1692** | **US$ 0,0078** |

O append ignora o marcador `__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__`; só o `--system-prompt` o respeita, e só substituindo
o prompt padrão (cerca de 2,1 mil tokens). Nenhuma forma mantém o prompt padrão e cacheia.

Por isso a sonda mediu também o comportamento sem o prompt padrão, em quatro turnos, duas rodadas em cada forma:
ToolSearch achando e chamando uma ferramenta MCP, Read → Edit num arquivo de uma pasta de projeto autorizada, Bash
sob o hook do nod (o hook viu a chamada e o arquivo saiu certo) e resposta só em texto. As quatro passaram 2/2 nas
duas formas. Na revisão (Eng 2, 2026-10-06, mesmo CLI e modelo) a fase de comportamento foi repetida: as quatro de
novo OK nas duas formas; o turno só de texto leu 15% do cache no append (US$ 0,0311) e 80% no `--system-prompt`
(US$ 0,0071).

## Decisão

- **Contrato aditivo.** `PlanoTurno` ganha `promptSistemaPartes?: { estavel: string; volatil: string }`. O
  `promptSistema` continua igual: as duas partes juntadas com `"\n"`, sem marcador. Quem não conhece o campo (Codex,
  Raio-X, app antigo) segue lendo só o `promptSistema`. O plano da ligação não leva as partes (o prompt de voz tem o
  próprio marcador).
- **Driver do claude-cli.** Com as partes e a flag liberada, manda
  `--system-prompt "<estável>\n__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__\n<volátil>"` e não manda `--append-system-prompt`.
  Sem a flag, sem as partes ou com o marcador dentro de alguma parte (um texto colado numa memória partiria o prompt
  no lugar errado), volta ao `--append-system-prompt` de antes.
- **Gate da flag.** `--system-prompt` entra em `FLAG_FLOORS` com piso 2.1.290 (a versão sondada) e fica fora de
  `FLAGS_DO_TURNO`, como `--effort` e `--autocompact`. O driver só a usa quando o `--help` lido no turno a traz **e** a
  versão é ≥ 2.1.290. Hoje o `PISO_CLI` do Claude também é 2.1.290 (NOD-171), então na prática o gate é o help.
- **Aviso sem terminal.** Quando o plano pede o terminal e a máquina não tem o hook, o `AVISO_SEM_TERMINAL` vai no fim
  do `promptSistema` (como antes) e no fim da parte volátil, depois do marcador, para não quebrar o prefixo.
- O marcador saiu de `prompt-ligacao.ts` para `src/domain/marcador-prompt.ts`, que os dois prompts usam.

## Alternativas descartadas

- **Manter o append e só pôr o marcador.** Medido: 15%, o marcador é ignorado.
- **`--exclude-dynamic-system-prompt-sections`.** Só vale com o prompt padrão; medido: 16%.
- **`--system-prompt` com a estável e append com a volátil.** Medido: 13%; o texto do append não fica depois de um
  prefixo estável.
- **Copiar o prompt padrão do Claude Code para dentro do nosso.** Ele muda a cada versão do CLI e é dele; os quatro
  comportamentos que importam ao nod passaram sem ele.

## Consequências

- Turno de texto no claude-cli ≥ 2.1.290: o 2º turno com outro remetente lê ~75% do contexto do cache em vez de ~16%
  e custa cerca de 1/4 na medição. A medição é de sessões novas: por causa do snapshot (abaixo), o ganho vale no 1º
  turno de cada sessão e em cada sessão nova (delegações, rotinas, conversa nova), não em todo `--resume`.
- O bot deixa de receber o prompt padrão do Claude Code (orientações gerais de uso de ferramentas, de segurança no git
  como não forçar push nem commitar sem pedido, de estilo). O cwd e a data continuam chegando: o CLI 2.1.290 os manda
  como contexto do usuário, fora do prompt de sistema (conferido na revisão com `claude -p --system-prompt` numa pasta
  vazia: o modelo disse a pasta e a data certas). O nod já informa a pasta do bot e as ferramentas; os quatro
  comportamentos da sonda ficaram iguais. As regras de git do prompt padrão não foram medidas: ficam para o QA.
- O Codex não muda: segue lendo o `promptSistema` inteiro.
- Fora do escopo, registrado na NOD-183: o `--system-prompt-snapshot`, ligado por padrão, reenvia no `--resume` o
  prompt gravado no 1º turno; a parte volátil dos turnos seguintes da mesma sessão não chega ao modelo. Isso já
  acontecia com o append e vira uma issue à parte.

## Gatilho de revisão

- Um comportamento que dependia do prompt padrão quebrar num turno real (ferramenta nativa mal usada, Bash fora do
  hook, ToolSearch não usada, git destrutivo sem pedido): rodar a sonda de novo e, se confirmar, voltar ao append só para o caso afetado.
- Uma versão do CLI passar a respeitar o marcador no `--append-system-prompt`: voltar ao append com marcador e
  recuperar o prompt padrão.
- Mudança no formato do marcador ou na flag em versão nova do CLI: a sonda e o piso precisam ser refeitos.
