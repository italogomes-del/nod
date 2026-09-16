# Pendências de contrato — L7 ROTINAS, SALAS E BOT-A-BOT

Lane de ordem 4: não editei `src/contracts`, `src/domain`, `src/db` nem `src/repositories` (EMENDA 18).
Cada item abaixo diz o que faltou, onde contornei sem quebrar a fronteira, e o que a L9 (ou a lane dona)
precisa fazer. Nenhum item bloqueia o verde desta lane.

## 0. Arquivos extras da lane (fora da lista do plano, sem colisão com outra lane)

- `src/use-cases/apoio-l7.ts` — apoio comum aos treze casos (autoria, eventos, carimbo, rodada, `rotinaDoTurno`,
  `ehUuid`/`assertUuid`); `src/use-cases/servico-sala.ts` — adaptador ao contrato `Services.sala`;
  `tests/helpers/deps-l7.ts` — `Deps`/`Services`/`UseCasesNod` falsos para os testes da lane (nenhum
  arquivo da L3 em `tests/helpers` foi editado, EMENDA 7). A L9 pode realocar; os imports são relativos.

## 1. Ligação proposta ↔ decisão ↔ rotina (sem coluna no contrato)

- **O que falta:** `Decisao` não tem `propostaId`; `Rotina` não tem `propostaId`. A decisão tipo `'rotina'` que
  `criarRotina` cria em "Sua vez" precisava apontar para a proposta, e `ativarRotina` precisava ser idempotente.
- **Contorno (definido em 2026-09-16):** a decisão nasce com o **mesmo id** da proposta, e a rotina ativada
  nasce com o **mesmo id** também (`decisoes.criar({ id: proposta.id })`, `rotinas.criar({ id: proposta.id })`).
  `src/use-cases/criar-rotina.ts`, `src/use-cases/ativar-rotina.ts`.
- **Para a L9/L5:** `decidir` de uma decisão tipo `'rotina'` deve chamar `services.rotinas.ativar(trx, decisao.id)`
  (decisao.id === propostaId). Se preferirem coluna explícita, é edição de contrato + migração (L9).

## 2. `Services.rotinas.ativar(trx, propostaId)` e `Services.sala.*` recebem só `trx`

- **O que falta:** o contrato passa `trx`, mas o caso de uso precisa de `Deps` (repos escopados, escopo, relógio).
- **Contorno:** `servicoRotinas(depsSobre: (trx) => Deps, aoGravar?)` em `ativar-rotina.ts` e
  `servicoSala(depsSobre, aoGravar?)` em `src/use-cases/servico-sala.ts` (arquivo extra da lane). A L9 compõe:
  `rotinas: servicoRotinas((trx) => ({ ...deps, repos: criarRepos(trx, escopo) }), gravarEventos)`.
- **Atenção:** os eventos dos casos de uso só são gravados se `aoGravar` for passado — quem compõe decide
  (mesma tx).

## 3. Gate de rotina: quem cria a decisão `gate_rotina`

- **O que falta:** o plano diz "→ decisão 'gate_rotina' com prazo", mas `pedirAprovacao` é da L5 e cria tipo
  `'aprovacao'`.
- **Contorno (definido em 2026-09-16):** `TIPOS_GATE_ROTINA = {gate_rotina, aprovacao}` em
  `src/use-cases/disparar-rotina.ts`. Uma decisão pendente de qualquer um dos dois tipos **ligada ao turno da
  rotina** (`turno_id` = turno disparado ou sua retomada) é o gate: `registrarDesfechoRotina('executou')`
  devolve `aguardando_gate` enquanto ela está pendente, e o varredor, ao vencê-la, registra
  `passou_em_branco` (`ninguem_respondeu_o_gate`). Uma `aprovacao` de turno comum não toca rotina
  (`rotinaDoTurno` devolve null → `nao_e_rotina`). Provado em `tests/integration/rotina-gate.test.ts`.
- **Para a L5/L9:** basta `pedirAprovacao` gravar `turnoId` do turno (já é o ContextoFerramenta). Trocar o
  rótulo para `'gate_rotina'` quando `turno.origem === 'rotina'` continua desejável para a fila "Sua vez"
  distinguir, mas não é mais necessário para o desfecho.

## 4. Assentamento de turno de rotina e de turno peer (L6 chama a L7)

- **`registrarDesfechoRotina(deps, { turnoId, desfecho: 'executou' | 'falhou', motivo? })`**
  (`src/use-cases/disparar-rotina.ts`): a L6 deve chamá-la em `assentarTurno` para turnos origem `'rotina'` e
  para a retomada deles (`retomaTurnoId` é seguido um salto). Com gate pendente devolve `{ ignorado: 'aguardando_gate' }`.
- **`entregarRespostaPeer(deps, { tarefaId, texto })`** (`src/use-cases/entregar-resposta-peer.ts`): a L6 deve
  chamá-la em `assentarTurno` para todo turno origem `'peer'`; se o turno é a continuação (não uma tarefa),
  devolve `{ ignorado: 'nao_e_tarefa_peer' }`.
- **`postarNaSala(deps, { salaId, texto, autoria, turnoId, eRotina })`**: a fala de um bot numa sala (assentamento
  de turno origem `'sala'`) deve entrar por aqui, para os responders e o orçamento rodarem — não por
  `mensagens.criar` direto.

## 5. `rotinaJanelasRepo.buscarPorTurno(turnoId)` não existe

- **Contorno:** `rotinaDoTurno(repos, turnoId)` em `src/use-cases/apoio-l7.ts` varre `rotinas.listar()` ×
  `rotinaJanelas.listar(id)` — O(rotinas), aceitável com 50 por bot.
- **Para a L5 (emitir-plano):** EMENDA 15 exige `montarPlano({ rotina: { exigeAprovacao } })` para turno de
  rotina; usar `rotinaDoTurno`. Pedido à L3/L9: `rotinaJanelasRepo.buscarPorTurno` (índice em `turno_id`).

## 6. `PayloadMensagem` de `passe` não tem `causa`

- **O que falta:** `assentar()` do domínio reconhece o teto por `Fala.causa === 'teto_canal'`, mas o payload
  `{ kind: 'passe', motivo }` não a carrega.
- **Contorno:** `encaminhar` grava uma mensagem `negacao` `{ nome: 'encaminhar', motivo: 'teto_canal' }` do
  mesmo agente e turno imediatamente antes do passe; `rodadaDaSala` (apoio-l7) lê a causa dessa mensagem
  (dado tipado, não texto). Contrato sugerido: `{ kind: 'passe'; motivo: MotivoPasse; causa?: MotivoNegacao }`.

## 7. Executor na autoria de mensagens/eventos escritos pelo servidor

- **O que falta:** `ContextoFerramenta` (turnoId, agenteId, conversaId) não carrega o executor do plano; `Turno`
  não expõe `executor`.
- **Contorno (definido em 2026-09-16):** `autoriaPessoa`/`autoriaAgente` em apoio-l7 usam `executor: 'catcher'`
  (mesma convenção de `tests/helpers/fabricas.ts`). Sugestão: `ContextoFerramenta.executor` ou `Turno.executor`.

## 8. Prazo de decisão configurável (`NOD_PRAZO_DECISAO_MS`)

- `Deps` não carrega configuração; `PRAZO_DECISAO_MS = 24 h` é constante em apoio-l7 (definido, não medido).
  A L9 pode injetar por composição quando `Deps`/`Services` ganharem um lugar para isso.

## 9. Presença de máquina (passe `ausente_offline`)

- Não há repositório de máquinas/presença. `postarNaSala` aceita `estaOnline?: (agente) => boolean`
  (default online — nesta rodada todos os bots da sala rodam na máquina de quem a abriu). A L9 injeta quando
  houver presença por poll (ADR-021).

## 10. Procuração entre donos (bot-a-bot)

- `autorizarDelegacao` recebe `gastoHoje: 0` (sem contagem diária — não há rota nem contador nesta rodada).
- Uma procuração criada por Ana é **privada** (RLS): o remetente de Marlon não a vê e continua negado. Para
  valer entre donos ela precisa nascer `equipe` (ou a policy ganhar perna) — e a conversa própria do alvo
  precisa ser visível ao remetente. Provado em `tests/integration/bot-a-bot.test.ts`.

## 11. Outbox só para a pessoa da sessão

- Eventos de sala vão só ao `pessoaDestinoId = escopo.pessoaId` (dona da sala): o WITH CHECK do outbox exige
  `owner_id = pessoa`. O dono de um bot convidado (Ana) não recebe frames da sala de Marlon nesta rodada;
  lê pela API (grant). Cabe ao laço da própria pessoa (L8/L9) espelhar, se quiserem.

## 12. Quem posta na sala

- `postarNaSala` recusa (`nao_permitido`) quem não é a dona: os turnos são dela (máquina, cota, autoria) e a
  leitura de `sala_membros` sob a policy de outra pessoa mostra só o grant dela — o roteamento sairia errado
  em silêncio. Pessoa com grant lê; postar por ela é decisão de produto para depois (multi-máquina).

## 13. Anel do orçamento do canal (domínio da L2, congelado)

- **Spec E5.5:** "anel de 3 → resfriar + mensagem" no **quarto** post que fecha o anel.
- **Domínio (`src/domain/canal-orcamento.ts`, TAMANHO_ANEL = 3):** devolve `'recusar'` (não `'resfriar'`) e recusa
  o **terceiro** remetente distinto em sequência (A→B→C), avaliando os últimos 3 remetentes + o candidato.
- **Contorno:** `postarNaSala` segue o domínio — grava a negação que encerra a tentativa e não cria turno
  (`tests/integration/sala-orcamento.test.ts`). Não editei `src/domain`. A L9 decide se ajusta o domínio
  (`resfriar` + quarto post) ou a spec.

## 14. Id fora do formato uuid chega cru ao Postgres (transversal, roteador/erros.ts)

- **O que falta:** o roteador casa `[^/]+` e a tabela fixa de `erros.ts` não traduz `22P02` (sintaxe de uuid):
  qualquer rota que passe o id ao repositório devolve 500 falha_interna.
- **Contorno:** as rotas da L7 (`rotas/rotinas.ts`, `rotas/salas.ts`) passam todo id de path e de corpo por
  `assertUuid` (apoio-l7) → 400 entrada_invalida; `criarRotinaPelaPessoa` confere o `agenteId` DEPOIS do
  domínio (o e2e espera `fuso_invalido` antes de qualquer outro campo). Provado em
  `tests/integration/rotas-rotinas-salas.test.ts`.
- **Para a L9:** guardar o formato no roteador (grupo `(?<id>uuid)`) ou traduzir `22P02` → entrada_invalida em
  `erros.ts`, para as rotas das outras lanes.
