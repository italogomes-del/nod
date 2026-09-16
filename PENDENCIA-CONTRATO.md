# Pendências de contrato — L5 PROXY MCP, PLANO, CONECTORES E APROVAÇÃO

Cada item diz o que falta, onde e por quê; a L5 contornou localmente sem tocar em `src/contracts`, `src/domain`, `src/db`, `src/repositories` nem nos arquivos de outras lanes. A L9 resolve.

## 1. `cliente-nod.ts` da L4 não existia neste worktree (EMENDA 6)

- **Onde:** `src/adapters/mcp-proxy/cliente-nod-stub.ts` (stub da L5) ← importado por `src/adapters/mcp-proxy/proxy.ts`.
- **O que a L9 faz:** trocar o import em `proxy.ts` para `src/adapters/executor/cliente-nod.ts` (L4) mantendo a interface `ClienteNod` do stub: `plano()`, `ferramenta(nome, argumentos)`, `aguardar(decisaoId, fatiaMs)`, `negacao(n)` e os tipos de fio `RespostaPlano | RespostaFerramenta | RespostaAguardar | FalhaTransporte`. `RespostaFerramenta` é estruturalmente igual a `ResultadoChamada` de `src/use-cases/chamar-ferramenta.ts` (corpo do `POST /api/interno/ferramentas/:nome`). Timeout do cliente: 5 s (`TIMEOUT_CLIENTE_NOD_MS`, definido em 2026-09-16), com Bearer do token de turno e nada de `remetente` no corpo.

## 2. `ServicesNod.tokenTurno.cunhar(turnoId)` não leva identidade nem plano

- **Onde:** `src/contracts/servicos.ts` (L2) × `src/services/token-turno.ts` (L5).
- **Motivo:** `autorizar(token)` devolve `IdentidadeDeTurno` (tenant, pessoa, agente), logo `cunhar` precisa RECEBER a identidade; e `GET /api/interno/plano` precisa achar o plano pelo turno do token.
- **Contorno:** o serviço concreto `TokenTurno` tem `cunhar(turnoId, identidade?)`, `guardarPlano(plano)`, `planoDe(turnoId)`, `ativos()`. `emitir-plano-turno.ts` chama `cunhar(turnoId, identidade)` (uma função com menos parâmetros é atribuível à de mais, então o contrato genérico compila) e chama `guardarPlano` só se existir (`Partial<Pick<TokenTurno,'guardarPlano'>>`). Sem `identidade` e sem `identidadeDe` na composição, `cunhar` lança `estado_invalido` (fail-closed).
- **Sugestão:** `tokenTurno.cunhar(identidade: IdentidadeDeTurno): string` e `planos.buscar(turnoId): PlanoTurno | null` no contrato; ou a L9 compõe `services.tokenTurno = criarTokenTurno(...)` e `services.planos.emitir = (trx, turnoId, machineId) => emitirPlanoTurno(deps(trx), {turnoId, machineId})`.

## 3. Rota interna `POST /api/interno/negacoes` não está em `ROTAS` (api.ts)

- **Onde:** `src/contracts/api.ts` (L2) lista só `GET interno/plano`, `POST interno/ferramentas/:nome`, `GET interno/decisoes/:id/aguardar`.
- **Motivo:** nome fora do PLANO é decidido LOCALMENTE pelo proxy (ADR-013: autoridade local); o servidor precisa saber para gravar a trilha (E8.4) e pedir a interrupção (E5.1). A rota existe em `src/adapters/http/rotas/interno.ts` (`interno: true`) e é exercitada em `tests/integration/rotas-conectores-decisoes.test.ts` e `proxy-com-plano.test.ts`.
- **O que a L9 faz:** acrescentar `{ metodo: "POST", caminho: "/api/interno/negacoes", lane: "L5" }` à tabela.

## 4. `decidir` cobre só `aprovacao` e `retomar_turno`

- **Onde:** `src/use-cases/decidir.ts`.
- **Motivo:** `perfil`/`rotina`/`gate_rotina` dependem de casos da L6/L7 (confirmar-proposta, disparar-rotina) e `acesso` de uma Proposta (o contrato de `pedir_acesso` devolve `proposta_id`, não decisão); `pergunta`/`falta_de_dado`/`permissao` são respondidas por `POST decisoes/:id/responder` (L9), que cria o turno de retomada com o texto da pessoa.
- **Exposto para a composição:** `marcarEDecidir` (fase 1, na tx), `executarItens` (fora da tx, sem banco), `assentarAprovacao` (fase 2, tx nova) e `retomarPorDecisao`. `decidir` encadeia os três sobre os MESMOS deps (uma tx) — a rota `decisoes/:id/decidir` (L9) pode separar em duas transações para a chamada ao conector não segurar a tx. Tipo não coberto → `ErroDeDominio('estado_invalido')`.
- **Decisora ≠ dona:** `assentarAprovacao` grava `registrarDesfecho`/mensagem/turno como DONA (RLS): quando a decisora for outra pessoa (EMENDA 1), a L9 roda a fase 2 pelo laço da dona (`paraCadaPessoa`).

## 5. Como as rotas da L5 chegam aos casos de uso (`DentroDeTx`)

- **Onde:** `src/adapters/http/rotas/dentro-de-tx.ts` (arquivo extra da L5, não listado no plano).
- **Contrato para `compor.ts` (L9):** `dentro: <T>(escopo, fn: (deps: Deps) => Promise<T>) => Promise<T>` abre `abrirTxEscopada(db, escopo)`, monta `Deps` (criarRepos(trx, escopo), services, useCases, tx, escopo, agora) e roda `fn`. `executar(deps, caso, input)` grava `saida.events` via `repos.events.gravarComOutbox` na mesma tx. Fábricas: `rotasConectores({dentro, cifrar})`, `rotasConcessoes({dentro})`, `rotasTrilha({dentro})`, `rotasInternas({dentro, tokens, agora})`. `cifrar` = `(t) => cifrar(t, chaveDe(NOD_CREDENTIAL_KEY))` de `src/db/cifra.ts`.
- **conectores-vivos:** `criarConectoresVivos({ carregar, agora })` recebe por callback quem carrega o conector e DECIFRA o env (repos + cifra) — o modelo está em `tests/integration/conectores.test.ts` (`conectoresSobre`).

## 6. Turno de rotina não aponta para a rotina (EMENDA 15)

- **Onde:** `src/use-cases/emitir-plano-turno.ts` × `Turno` (contrato) / `rotina_janelas.turno_id`.
- **Contorno:** para `origem = 'rotina'` a rotina é casada por `(agenteId, conversaId)` em `rotinas.listarDoAgente`; nenhuma casada ou qualquer uma com `exige_aprovacao` → `efeitoExternoSoPorAprovacao = true` (fail-closed). Sugestão: `rotinaJanelasRepo.buscarPorTurno(turnoId)` ou `Turno.rotinaId`.

## 7. Evento de decisão dirigida a outra pessoa

- **Onde:** `src/use-cases/pedir-a-pessoa.ts`.
- **Motivo:** `events_outbox` exige `owner_id = pessoa da sessão` (WITH CHECK), então o evento `decisao_criada` vai para a DONA com `dados.decisor_id`; a decisora vê pela fila "Sua vez" (RLS, perna extra). Se a L8/L9 quiser o frame também para a decisora, é gravação pelo laço dela.

## 8. Sem rota de atualização do env do conector

- `ROTAS` não tem `PATCH conectores/:id`; `conectoresRepo.atualizarEnv` (mesclar placeholders `true`) fica sem caso de uso nesta rodada. `registrar-conector` recusa `true` em qualquer chave (todas são novas no registro).

## 9. Chamada ao conector dentro da transação da rota interna

- `POST /api/interno/ferramentas/:nome` roda `chamarFerramenta` dentro de `dentro(...)`: a chamada a `services.conectores.chamar` (teto `CHAMADA_CONECTOR_MS = 15 s`) acontece com a tx aberta. Registrado como desvio; se a L9 preferir, o gate (parada/catálogo/concessão) pode ser separado da chamada como em `decidir`.
