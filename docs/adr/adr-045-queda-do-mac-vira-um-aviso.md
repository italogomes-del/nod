# ADR-045 — A queda do Mac vira um aviso, não um card por turno

Status: aceito · Data: 2026-09-24 · Emenda ADR-007, ADR-010, ADR-011 e ADR-017. EMENDA 16 inalterada.

## Contexto

Medido no banco diário em 24/09: 43 decisões `retomar_turno` em 7 dias, 100% de turnos de ROTINA
interrompidos por `maquina_sem_contato`, quase todas de madrugada. É o "dark wake": o Mac acorda por
instantes, o agendador (no mesmo processo) dispara, o Mac volta a dormir no meio do turno. Ao acordar,
o varredor de lease criava um card "Retomar" **e** uma mensagem por turno; 24 h depois o varredor de
expiração escrevia outra. Retomar uma rotina não faz sentido — a próxima janela já roda sozinha — e
a frase "o computador parou de responder" era lida como o computador DO BOT (ADR-037).

A mesma queda chegava por três caminhos, com três desfechos diferentes: o varredor (card + mensagem),
a entrega que chega com o lease vencido antes do varredor (mensagem de "trabalho incompleto" e, na
rotina, execução `falhou`) e a entrega tardia depois do varredor (a fala cortada entrava no chat).
Responder a um pedido de rotina gravava uma SEGUNDA linha de execução para a mesma janela.

## Decisão

**Incidente não é decisão.** A falta de infraestrutura vira UM aviso com começo e fim (tabela
`incidentes`, 0021), nunca um card por turno. Quedas a menos de 3 h uma da outra mesclam no mesmo
aviso (a medição de 24/09); fechado, ele fica 12 h em "Sua vez" ou até "Entendi". Aviso fechado E
dispensado não recebe queda nova — a próxima abre outro. No modo compartilhado o servidor nota a queda
com o Mac ainda fora: o aviso fica EM CURSO (`voltou_em` nulo, um por pessoa pelo índice
`incidente_em_curso`) até o varredor ver a máquina puxando de novo (contato mais novo que
`OFFLINE_MS`); a web relê "Sua vez" a cada tick enquanto houver aviso em curso, sem evento novo. No
modo local o varredor roda no próprio Mac, então notar já é ter voltado.

**Uma regra só** (`src/use-cases/interromper-por-maquina.ts`): rotina → execução `interrompida`
(desfecho novo, silencioso como `sem_novidade`), sem decisão e sem mensagem; conversa → a retomada
anterior da MESMA conversa fecha por `regra:retomada_substituida` (inclusive reaberta — `fecharPorRegra`
passa a aceitar `reaberta`) e nasce uma, com a frase; sempre → o aviso e a métrica `pos_restart`
(contada na borda). As três portas terminam igual: o varredor; a entrega NÃO-sucesso com o lease
vencido e sem Parar (`desfechoDaEntrega` → `maquina_sem_contato`; sucesso é trabalho terminado); e a
entrega tardia, cuja fala cortada de rotina não entra no chat (o sucesso tardio entra: o entregável da
rotina é a fala). A ordem das travas é a mesma nas portas: linhas de turno → trava por pessoa dos
incidentes → decisões (conversas) → janelas (rotinas) → o incidente. O varredor interrompe TODOS os
órfãos antes de qualquer consequência, então nunca segura a trava por pessoa esperando uma linha de
turno; decisões antes de janelas é a ordem do varredor de expiração (`vencerPendentes` → janela do
gate), que acorda junto depois de uma noite de sono.

**Uma linha por janela.** `registrarDesfechoRotina` trava a janela (`rotinaJanelas.travar`, FOR UPDATE)
e atualiza a execução dela se já existe (`daJanela` + `atualizarDesfecho`): o desfecho mais recente
substitui o anterior.

**Uma execução aberta por rotina, no agendador.** Com o turno da janela anterior pendente ou rodando,
o disparo agendado só reagenda (log `rotina_janela_pulada`). "Executar agora" e "Permitir e rodar
agora" (ADR-044) são atos da pessoa e nunca são pulados.

**O agendador espera 3 min ao acordar.** Relógio que salta mais de 3 intervalos entre dois ticks é o
processo que ficou suspenso; a espera corta o "dark wake" na origem. Definido, NÃO medido: o log
`processo_acordou {parado_ms}` existe para medir.

**Servidor reiniciado não é o Mac.** No modo compartilhado, turno cujo último sinal (lease − LEASE_MS)
é de antes de o processo subir cai como `reinicio_servidor`, sem aviso do Mac (`pos_restart` com
origem `restart_servidor`). No modo local reiniciar o servidor É fechar o nod no Mac.

**Nomes.** `maquina_sem_contato` → "seu Mac parou de responder (repouso, sem rede ou nod fechado)";
o botão do cabeçalho vira "Computador do bot"; o glossário define os dois e o "aviso".

**Limpeza (0021).** As `retomar_turno` abertas de turnos de rotina (e das retomadas deles, até 5
saltos) fecham por `regra:rotina_nao_retoma`, com o desfecho de ADR-042, entre NO FORCE/FORCE em
`decisoes` e `turnos` (regra da 0005).

## Alternativas descartadas

- **Manter o card de rotina e vencer mais cedo.** Continua um card por turno, só some antes; o
  problema é existir.
- **Registrar a queda de rotina como `falhou`.** Mistura erro da rotina com o Mac dormindo e dispara o
  texto "falhou por erro técnico" no chat — o flood que esta decisão acaba.
- **Impedir o Mac de dormir (power assertion).** Troca bateria por rotina; é decisão da pessoa, não do
  produto, e não resolve rede caída nem nod fechado.

## Validação

`tests/integration/varredor-lease.test.ts` (conversa: um Retomar e um aviso; duas quedas → um
Retomar, a anterior reaberta fechada por regra; rotina: 0 decisões, 0 mensagens, 1 `interrompida`,
idempotente; compartilhado: `reinicio_servidor` sem aviso, aviso em curso fechado na volta),
`incidentes` (mescla em 3 h, fechado+dispensado abre outro, índice único, RLS, "Sua vez", 404, limpeza
da 0021 executada do próprio arquivo), `rotina-scheduler` (21 janelas → 20; janela pulada),
`rotina-gate` (responder → uma linha), `turnos-fila` (lease vencido no `desfechoDaEntrega`); unit
`incidente`, `presenca`, `redacao`, `assentar-turno-queda`, `disparar-rotina`, web `incidentes`;
concorrência `varredor-lease-entrega` (as duas ordens de trava e cinco rodadas simultâneas: exatamente
uma `interrompida`, sem impasse); conformidade `motivos-enum` e `rls` pegam o enum e a tabela novos;
`rotas-http` ("Entendi" em aviso desconhecido ou id fora do formato → 404, nunca 500).

Verde em 2026-09-24, sobre a `main` com #44–#47: lint, typecheck (4 projetos), fence:domain; unit
108 arquivos/603 testes, integration 74/272, conformidade 8/58, concurrency 20/68 (1 pulado).

## Gatilho de reversão

- Se, em 14 dias de log, mais de 10% das rotinas disparadas nos 10 min depois de um `processo_acordou`
  terminarem `interrompida` por `maquina_sem_contato`, 3 min é pouco: subir a espera. Se nenhuma
  terminar assim e houver `processo_acordou` com `parado_ms` < 10 min em horário de uso, a espera só
  atrasa: baixar.
- Se uma rotina acumular `rotina_janela_pulada` por mais de 24 h seguidas, a guarda está escondendo
  um turno pendente preso: dar prazo ao turno de rotina pendente em vez de pular para sempre.
- Se aparecer mais de um aviso em curso por pessoa (o índice recusa: erro 23505 em log), a trava por
  pessoa foi contornada — rever quem chama `incidentes.abrir`.

## Não implementado

O aviso do computador do bot (PR3). A volta da máquina no modo compartilhado é notada pelo varredor
de lease (até 15 s depois do contato), não por evento. Sucesso tardio de rotina já derrubada entra no
chat, mas a execução continua `interrompida`. As retomadas de `retomarTurno` e `assentarAprovacao`
continuam gravando `confiavel` (ADR-044, "Não implementado").
