# ADR-044 — Acesso em um clique, também na rotina

Status: aceito · Data: 2026-09-24 · Emenda ADR-013, ADR-035 e ADR-043. EMENDA 16 inalterada.

## Contexto

A Nina tem uma rotina que lê o Gmail ("E-mails às 8h, 13h e 18h") e não tinha concessão. No modo
rotina `pedir_acesso` não estava no catálogo (`FERRAMENTAS_NOD_POR_MODO.rotina`) e o prompt mandava
"se faltar acesso… informe o bloqueio". Ela pedia por `pedir_a_pessoa` — um card de texto — a cada
disparo, três por dia.

Conceder era um fluxo de dois cliques em dois objetos: "Revisar acesso" (`POST propostas/:id/confirmar`)
criava a decisão 'acesso'; só "Permitir acesso" (`POST decisoes/:id/decidir`) concedia. A pessoa e o
agente entendiam que o primeiro clique já concedia: a ferramenta devolvia só `{proposta_id}` e a
mensagem de sistema dizia "Confirmado… A partir de agora vale". E um clique nas 28 ferramentas de
leitura do Gmail escreveria 28 mensagens de consentimento.

Buraco de segurança no mesmo caminho: `retomarComResposta` gravava a retomada com
`entradaConfianca: "confiavel"` fixo, e `modoDoTurno` mapeava origem 'retomada' para 'conversa'. Uma
rotina que leu e-mail (entrada `nao_confiavel`, ADR-026) e perguntou algo à pessoa voltava confiável,
com o catálogo da conversa (criar, pausar e excluir rotina, ferramentas de escrita) e sem o gate
`efeitoExternoSoPorAprovacao` (EMENDA 15).

## Decisão

**Acesso se pede por botão: proposta e decisão de mesmo id, um clique.** Com o app conectado,
`pedir_acesso` cria as duas juntas, como `propor()` do ADR-043. O card da conversa e "Sua vez" decidem
pelo mesmo `POST decisoes/:id/decidir`, que chama `decidir-acesso.ts`: fecha a decisão, marca a
proposta confirmada (o card sai da conversa), concede o lote e continua. App ainda não conectado
continua sendo só o card de conexão; depois de conectar, pedido de LEITURA vira no lugar o card de um
clique (`confirmar-proposta.ts`). `confirmar` fica para as propostas anteriores e, quando a decisão
de mesmo id já existe, só a devolve.

**A frase é do domínio** (`fraseDoPedidoDeAcesso`): nome do app, verbo pelo `readOnlyHint` do catálogo
(ler, alterar), a rotina que pediu e o que fica de fora — curado por app em `naoIncluiNaLeitura` (Gmail:
enviar, apagar, arquivar) ou, sem curadoria, a contagem das ações de escrita. Nenhum nome de
ferramenta na frase: a lista técnica vai para o `<details>` do card. O resultado da ferramenta é
`{proposta_id, estado: "aguardando_pessoa", instrucao: "o acesso ainda NÃO foi concedido: diga que pediu
e encerre o turno"}`.

**Também na rotina, só leitura.** `pedir_acesso` entra no modo rotina. O domínio recusa escrita
(`nao_permitido`, pelo nível e pela ferramenta) e resolve `capacidades: []` para as ferramentas de
leitura do app. O pedido carrega `rotinaId`: permitir reativa a rotina se estava pausada e a dispara
AGORA em modo rotina (janela no instante do clique em ms, `preservarAgenda`); recusar pausa a rotina.
O pedido pendente de uma rotina é chaveado por (agente, conector, rotina), sem olhar turno nem
capacidades, e `pedir_a_pessoa` por (agente, tipo, rotina): o disparo seguinte reaproveita o card em
vez de abrir outro. No prompt da rotina entram só os slugs dos apps; o catálogo de cada conexão
(~4-5 mil tokens) fica de fora, porque execuções com mais de 1 h entre si perdem o cache ephemeral_1h.

**Consentimento por lote.** `concederLote` escreve UMA mensagem imutável para N capacidades do mesmo
app; cada concessão aponta para ela (a unicidade do banco continua por capacidade). O painel do bot
agrupa por app e nível ("Gmail · só leitura · 28 ações") e revoga o grupo com um registro
(`revogarLote`). Só `decidir-acesso.ts` e a concessão manual da tela Conectores (rota de pessoa) chamam
`conceder`/`concederLote` — regra do eslint, provada em `tests/conformidade/conceder-so-pela-pessoa.test.ts`;
o nome `conceder-acessos-da-rotina.ts` fica reservado para a concessão junto do nascimento da rotina.

**Retomada ligada a uma rotina continua rotina.** `rotinaDoTurno` segue `retomaTurnoId` até 5 saltos.
`modoDoTurno` dá 'rotina' à retomada ligada, com o `exigeAprovacao` da rotina, sessão CLI nova e sem
gravar a sessão dela na conversa (como a rotina, ADR-035). O gate passa a vir da rotina ligada
(`rotina?.exigeAprovacao === true`), não de `origem === 'rotina'`. `retomarComResposta` mantém a
confiança do turno que parou e acrescenta a entrada original da rotina, que a sessão nova não teria.

**EMENDA 16 inalterada.** Pergunta ≠ permissão; `pedir_a_pessoa` continua na rotina para o que não é
acesso a app. O prompt só proíbe usá-lo para pedir acesso.

## Alternativas descartadas

- **A rotina concede a si mesma a leitura, sem botão.** Conceder é ato da pessoa (ADR-013); o botão
  de um clique já tira o atrito sem tirar o ato.
- **Manter os dois passos com cópia melhor.** O erro era estrutural — dois objetos, e o agente
  anunciava acesso no primeiro. Texto não impede o modelo de ler `{proposta_id}` como concessão.
- **Escrita na rotina por botão.** A rotina roda sem ninguém olhando; efeito externo segue item a item
  por `pedir_aprovacao` (EMENDA 15), e a concessão de escrita segue pela conversa.

## Validação

`tests/unit/domain/pedido-acesso.test.ts` (normalização, leitura, frase), `pedir-acesso-rotina`,
`pedir-acesso-sem-gemeas` (decisão de mesmo id; dedupe da rotina entre disparos),
`pedir-a-pessoa-rotina`, `retomar-apos-acesso` (sem passo de confirmar; permitir dispara turno origem
'rotina'; recusar pausa), `conceder` (lote → uma mensagem), `tests/unit/web/decisoes-chat` e
`navegacao-sem-rail`, `assentar-turno-sessao-rotina`. `tests/integration/acesso-rotina.test.ts` roda
o fluxo no Postgres e prova a correção de segurança: a retomada de uma rotina `nao_confiavel`
continua `nao_confiavel`, em modo rotina, com o gate e sessão nova, e a de rotina confiável tem a
ferramenta de escrita negada (`alcance_insuficiente`). Agente excluído e restaurado (geração nova,
ADR-034) com o pedido reaberto: a concessão fica, a rotina da geração antiga não é reativada nem
disparada — a mesma trava de `retomarAposAcesso`; conferido em 2026-09-24 que o teste falha sem ela.
Nenhuma migração.

Verde em 2026-09-24: lint, typecheck (4 projetos), fence:domain, 104 arquivos / 575 testes unit,
73 / 261 integration, 8 / 57 conformidade e 19 / 65 concurrency (1 pulado).

## Gatilho de reversão

- Se, em 30 dias de uso, mais da metade dos pedidos de acesso vindos de rotina forem recusados
  ("Pausar rotina") ou o grupo de leitura for revogado em até 24 h depois de permitido, "todas as
  ferramentas de leitura do app" está largo demais: a rotina volta a pedir capacidades exatas do
  catálogo, mantendo o botão único.
- Se aparecer mais de uma proposta de acesso pendente para o mesmo (agente, conector, rotina), a chave
  de dedupe está errada — medir por consulta em `propostas` com `payload->>'rotinaId'`.
- Se, em 3 UATs, a retomada de rotina em sessão nova refizer a execução inteira em vez de continuar,
  rever a sessão: retomar a sessão da PRÓPRIA rotina, nunca a da conversa.

## Não implementado

A concessão junto do nascimento da rotina (`concederAcessosDaRotina`). As retomadas de `retomarTurno`
(frase da pessoa) e de `assentarAprovacao` ainda gravam `confiavel`; o modo e o gate de rotina já valem
para elas por `modoDoTurno`, mas a confiança não. Escrita pedida por rotina.
