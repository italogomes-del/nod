# Pendências de contrato — L6 BOTS, CONVERSA, FILA DE TURNOS E PARAR

Tudo abaixo foi contornado localmente sem tocar `src/contracts`, `src/domain`, `src/db`, `src/repositories`
nem os arquivos das outras lanes. A L9 resolve na composição (`compor.ts`/`boot.ts`).

## Para a L9 (composição)

1. **`iniciarLaco` da L4 é injetado, não importado.** `src/adapters/fundo/orquestrador-turnos.ts` declara
   `IniciarLaco = ({ponte, registry, pessoaId, machineId, relogio}) => {parar()}` (a assinatura do plano da L4) e
   recebe a função por parâmetro. `boot.ts` passa `iniciarLaco` de `src/adapters/executor/laco.ts`.
2. **Rotas recebem `abrirTx: (escopo) => Transacao`** (`src/adapters/http/rotas/executar-caso.ts`, `DepsRotas`), não o
   pool: em produção `abrirTx: (e) => abrirTxEscopada(db, e)`; no teste é um SAVEPOINT dentro do withRollback. Também
   levam `modeloPadrao` (NOD_MODELO), `prazoDecisaoMs` (NOD_PRAZO_DECISAO_MS) e `executor` ('local' | 'catcher') lidos
   pela borda — o caso de uso não lê `process.env`.
3. **Persistência do inventário por pessoa.** `despacharTurno` usa o inventário ANUNCIADO pela máquina (`conectar`)
   só como gate pré-spawn e NÃO grava em `inventario_motores` (um upsert por puxar travou com o advisory lock da
   reivindicação em dois puxares paralelos da mesma pessoa; ver comentário datado). `emitirPlanoTurno` (L5) lê o
   inventário do repositório: a L9 precisa ligar a persistência da sonda com cache da L4 (`services/inventario.ts`,
   callback injetado) por pessoa — motor `'claude-cli'` para o driver claude-cli e `'catcher'` para o catcher
   (`motorDe(executor)` em `src/use-cases/autoria-evento.ts`). Sem isso, `montarPlano` recusa (`executor_indisponivel`)
   e o turno é interrompido com negação renderizada — fail-closed, nunca silêncio.
4. **`PonteInterna.puxar(pessoaId)` não recebe tenant**: a ponte resolve `tenantId` por `listarTodas(db)` (tabela
   `pessoas`, sem RLS) com cache em memória; `renovar`/`entregar` usam o escopo guardado no `puxar` (turno de antes
   de um reinício → `{ativo:false}` / entrega descartada com log; o varredor de lease encerra o órfão).
   `criarPonteInterna(db, {services, useCases, executor, esquecerTurno})` — ligar `esquecerTurno: interruptor.esquecer`.
5. **`POST decisoes/:id/retomar` (L9)** compõe `retomarTurno(deps, {decisaoId, texto})` de
   `src/use-cases/retomar-turno.ts` (também aceita `{turnoId, texto}`). Rotas de apoio fora da tabela ROTAS, registradas
   como acréscimo: `GET turnos/:id` e `POST turnos/:id/retomar` em `rotas/turnos.ts`.
6. **README (EMENDA 17)**: registrar a resolução "POST agentes {dono, nome?}: nome ausente → 'Novo agente'; o modelo
   propõe pelo atualizar_perfil" — README não é desta lane.
7. **Negações de permissão do CLI** (`ResultadoTurno.negacoesPermissao`) viram, em `assentarTurno`, mensagem kind
   `negacao` + evento `negacao` (classe `ferramenta_negada`, motivo `fora_do_catalogo`, não terminal). A linha de
   TRILHA correspondente é do `registrar-negacao` da L5; se a L9 quiser trilha também para essas, chama o caso de uso
   da L5 no mesmo ponto (a assinatura não está em `Services`).

## Para a L2/L3 (contratos e repositórios), se quiserem fechar de vez

8. `FaixaParada.jaEntregues` nasce `[]`: nesta rodada o único efeito externo é item aprovado (L5), síncrono ao decidir —
   não há emissão "a caminho" para listar. Quando houver, a fonte é a trilha/`itens_aprovacao` (desfecho `executado` com
   instante), não `events_outbox`.
9. `listarFrota` conta execuções por `turnosRepo.listarDaConversa(conversaId, 1000)` filtrando `concluido`: falta um
   `contarConcluidosDoAgente(agenteId)` no repositório (L3) para não ler linhas.
10. `Deps.services.rotinas.ativar(trx, propostaId)` (L7) é chamado por `confirmarProposta` via `deps.tx((trx) => …)`
    na MESMA tx; o retorno `Rotina` vai no evento `rotina_criada` e na resposta. A mensagem
    `redigir('rotina-proxima-execucao')` fica por conta do `ativarRotina` da L7 (o plano a atribui a ela).
11. `Turno` (contrato) não expõe `executor`: `assentarTurno` aceita `Entrega & {executor?}` (default 'catcher') e a ponte
    passa o seu. Se a L2 expuser `executor` em `Turno`, o campo extra some.
