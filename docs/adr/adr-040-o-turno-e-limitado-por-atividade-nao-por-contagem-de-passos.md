# ADR-040 — O turno é limitado por atividade, não por contagem de passos

Definido em 2026-09-18, a partir de um teste real. Pedindo para seguir uma implementação, o agente
leu o servidor, entendeu como a pasta da conversa funciona, ia examinar um helper — e o turno morreu:

> Turno interrompido: erro_max_turns. O que já saiu fica marcado como parcial; nada foi reenviado.

`MAX_TURNOS_CLI = 12` nasceu em 2026-09-16 (commit `633485e`), com o comentário *"cabe lembrar →
pedir_aprovacao → resposta, com folga"* — quando o Nod só tinha as nove ferramentas de conversa,
antes de computadores, pastas e programação. Uma tarefa de código gasta isso só para entender o
repositório: Glob, quatro Reads, Edit, Read de conferência. **A premissa mudou; a constante não.**

## Decisão

1. **Sem teto de passos.** `--max-turns` sai do turno. Não condicionar a haver projeto autorizado:
   conversa também chama conectores e `computador_*`, e o teto condicional seria a mesma armadilha
   com outro número, dependendo de um estado que a pessoa não vê.
2. **O que limita é atividade.** O watchdog em `laco.ts` observa os eventos do agente — o mesmo
   ponto nos dois drivers — e encerra o turno que fica 5 minutos mudo, pelo caminho que
   `{ativo:false}` já usava (`adapterAtual.interromper()`).
3. **Ferramenta em andamento é silêncio legítimo.** `tool_use` sem `tool_result` isenta o turno:
   `computador_*` leva até 240s e o proxy serializa as chamadas. A isenção tem teto
   (`ISENCAO_FERRAMENTA_MS`, 480s) para um `tool_result` perdido não isentar para sempre.
4. **`--autocompact 200000`** para a tarefa longa compactar o contexto em vez de estourá-lo.
5. **Dois motivos novos**, porque `sem_progresso` mentia: `turno_travado` (ficou mudo) e
   `trabalho_incompleto` (produziu e não concluiu — o caso do incidente).

## As duas referências, lidas nos clones em 2026-09-18

**OpenMausBot** (`~/code/OpenMausBot`) — **nunca passa `--max-turns`**; verificado por grep no repo
inteiro, zero ocorrências. O comentário de `server/turn-watchdog.ts:8-11` é a declaração de
princípio que esta ADR adota:

> *"This watchdog watches ACTIVITY, not duration: a turn may legitimately run for an hour while
> events keep flowing, but a turn whose thread has emitted nothing at all for `stallMs` is wedged."*

Mais `--autocompact 200000` (`server/drivers/claude.ts:295`), sessão CLI viva por thread retomável
por `--resume`, deadline absoluto só em sala, e o Stop humano como controle primário.

**OpenBot** (`~/code/OpenBot`) — tem `TOOL_STEPS = 8` (`server/src/copilot.ts:379`) com justificativa
quase idêntica à nossa, e **não trata o estouro**: a constante aparece duas vezes no repositório
inteiro, sem erro, sem retomada, sem teste. O run termina com `RUN_FINISHED` normal e a pessoa vê
uma resposta incompleta que parece deliberada. **Não é modelo a copiar** — o nosso `erro_max_turns`
pelo menos falhava alto.

## Por que o lease não servia como watchdog

O lease de 90s é renovado por **timer fixo** (`laco.ts`, `setInterval`). Ele prova que o **processo**
vive, não que o **agente** progride: um CLI travado renovaria para sempre. São dois relógios com
sentidos diferentes, e foram mantidos separados de propósito.

Alternativa rejeitada: parar de renovar o lease quando não há atividade, deixando o varredor matar o
turno. O motivo sairia como `maquina_sem_contato`, que é mentira — a máquina está viva.

## Por que a isenção aqui é mais simples que no openmausbot

Lá o `setWaitingOnHuman` existe porque o turno **fica parado** no card de permissão. No Nod, não: o
long-poll dura uma fatia de 20s (`LONGPOLL_APROVACAO_MS`) e responde ao modelo *"encerre o turno; a
decisão retoma depois"* (`proxy.ts`). O turno acaba e a retomada é um turno novo. A janela de
silêncio a proteger é outra — a chamada de ferramenta — e ela é observável sem inventar estado.

## Fail-closed

`--autocompact` é flag **condicional**: fica fora de `FLAGS_DO_TURNO` (exigi-la ali derrubaria todo
turno num CLI mais antigo, inclusive quem não precisa dela) e o gate é o `--help` lido no turno.
Sem a flag, o turno roda sem ela. `--max-turns` continua em `FLAG_FLOORS` porque `sonda.ts` ainda a
usa com valor 1, onde o teto é exatamente o desejado.

## O risco que esta decisão aceita

**Nenhuma camada pega um agente que erra em círculo emitindo eventos.** Para o watchdog, ele está
trabalhando. Restam o `prazoMs` de 24h e o Stop humano — que a pessoa pode não estar acordada para
apertar.

É uma troca deliberada: o contador cortava trabalho legítimo com muito mais frequência do que pegava
um agente perdido. O openmausbot aceita a mesma lacuna, e a resposta deles é um detector de
repetição que **só observa e conta** (`repeat-detector.ts:1-6`: *"This only OBSERVES — it counts and
says so; the human has Stop"*), deixando a interrupção para a pessoa. Se o laço produtivo vier a
incomodar na prática, é esse o caminho seguinte — não voltar o contador.

## Gatilho de reversão

Se um laço produtivo caro acontecer de fato em produção (não em hipótese), a resposta é o detector
de repetição acima, não restaurar `--max-turns`: o contador já demonstrou cortar trabalho legítimo.

## Emenda de 2026-09-28 — a aprovação continua no mesmo turno

**Contexto.** "O turno acaba e a retomada é um turno novo" valia para toda aprovação que não fosse decidida dentro de uma fatia de 20 s. Numa tarefa no computador do bot, a Ada fez 10 turnos em 3 minutos, e cada retomada reescreveu o resumo. Pior: a aprovação dada dentro da fatia continuava o turno **e** criava uma retomada, em cascata.

**Decisão.**
- **O proxy espera a decisão no próprio turno**, com a ferramenta aberta, em fatias de `LONGPOLL_APROVACAO_MS` até `ESPERA_APROVACAO_NO_TURNO_MS` (420 s). Isso fica abaixo da isenção de ferramenta aberta do vigia (480 s). Aprovada nesse tempo, o mesmo turno segue com o resultado; passado o prazo, ou com o servidor fora, volta o "pendente" e o turno encerra.
- **Uma decisão, uma continuação** (0032, `decisoes.continuada_em` e `continuada_por`):
  - quem entrega a decisão ao turno que espera a reivindica como `turno`;
  - a fase 2 só cria retomada se o turno já não está rodando, sob a trava da linha do turno;
  - o assentamento do turno cria a retomada da aprovação decidida que ele não chegou a receber.
- **Retomadas se juntam:** toda retomada nasce por `enfileirarRetomada`. Se já há uma retomada do mesmo turno na fila, a entrada nova se junta a ela. Vale para acesso, perfil, pasta, resposta a pedido e "Retomar".
- **Limitação conhecida:** a queda da máquina (`interromperPorMaquina`) não passa pela rede de segurança. Ela já abre o card "Retomar" para a pessoa.
