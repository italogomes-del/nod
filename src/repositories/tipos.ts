import type { composioRepo } from "./composio.repo.ts";
import type { computadoresRepo } from "./computadores.repo.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import type { agentesRepo } from "./agentes.repo.ts";
import type { anexosRepo } from "./anexos.repo.ts";
import type { catcherRepo } from "./catcher.repo.ts";
import type { concessoesRepo } from "./concessoes.repo.ts";
import type { permissoesPermanentesRepo } from "./permissoes-permanentes.repo.ts";
import type { conectoresRepo } from "./conectores.repo.ts";
import type { conversasRepo } from "./conversas.repo.ts";
import type { decisoesRepo } from "./decisoes.repo.ts";
import type { eventsRepo } from "./events.repo.ts";
import type { gastosRepo } from "./gastos.repo.ts";
import type { githubAppRepo } from "./github-app.repo.ts";
import type { incidentesRepo } from "./incidentes.repo.ts";
import type { inventarioRepo } from "./inventario.repo.ts";
import type { itensAprovacaoRepo } from "./itens-aprovacao.repo.ts";
import type { maquinaTokensRepo } from "./maquina-tokens.repo.ts";
import type { memoriasRepo } from "./memorias.repo.ts";
import type { mensagensRepo } from "./mensagens.repo.ts";
import type { outboxRepo } from "./outbox.repo.ts";
import type { paradasRepo } from "./paradas.repo.ts";
import type { pessoasRepo } from "./pessoas.repo.ts";
import type { procuracoesRepo } from "./procuracoes.repo.ts";
import type { propostasRepo } from "./propostas.repo.ts";
import type { relatosRepo } from "./relatos.repo.ts";
import type { rotinaExecucoesRepo } from "./rotina-execucoes.repo.ts";
import type { rotinaJanelasRepo } from "./rotina-janelas.repo.ts";
import type { rotinasRepo } from "./rotinas.repo.ts";
import type { salasRepo } from "./salas.repo.ts";
import type { trilhaRepo } from "./trilha.repo.ts";
import type { turnosRepo } from "./turnos.repo.ts";

/**
 * Regras de repositório (Leapy §1, ADR-018 refinado): factory `xRepo(conn: Conn, escopo: Escopo)`
 * aceita Db | Tx na primeira linha; WHERE tenant_id explícito mesmo sob RLS (segunda camada);
 * devolve T | null ou T[] — sem `throw NotFound`. Erros do banco (CHECK, UNIQUE, trigger, policy)
 * sobem como estão: quem os traduz é a borda. Única exceção deliberada: paradasRepo.ativa devolve
 * null em falha de consulta (EMENDA 10; o fail-closed mora no caso de uso).
 * `criarRepos` (index.ts) monta os 24 de uma vez; tests/helpers/repos-memoria.ts implementa o mesmo `Repos`.
 */
export type Fabrica<R> = (conn: Conn, escopo: Escopo) => R;

export interface Repos {
  computadores: ReturnType<typeof computadoresRepo>;
  composio: ReturnType<typeof composioRepo>;
  githubApp: ReturnType<typeof githubAppRepo>;
  pessoas: ReturnType<typeof pessoasRepo>;
  events: ReturnType<typeof eventsRepo>;
  outbox: ReturnType<typeof outboxRepo>;
  agentes: ReturnType<typeof agentesRepo>;
  memorias: ReturnType<typeof memoriasRepo>;
  conversas: ReturnType<typeof conversasRepo>;
  mensagens: ReturnType<typeof mensagensRepo>;
  anexos: ReturnType<typeof anexosRepo>;
  propostas: ReturnType<typeof propostasRepo>;
  relatos: ReturnType<typeof relatosRepo>;
  turnos: ReturnType<typeof turnosRepo>;
  decisoes: ReturnType<typeof decisoesRepo>;
  itensAprovacao: ReturnType<typeof itensAprovacaoRepo>;
  rotinas: ReturnType<typeof rotinasRepo>;
  rotinaJanelas: ReturnType<typeof rotinaJanelasRepo>;
  rotinaExecucoes: ReturnType<typeof rotinaExecucoesRepo>;
  salas: ReturnType<typeof salasRepo>;
  conectores: ReturnType<typeof conectoresRepo>;
  concessoes: ReturnType<typeof concessoesRepo>;
  permissoesPermanentes: ReturnType<typeof permissoesPermanentesRepo>;
  procuracoes: ReturnType<typeof procuracoesRepo>;
  inventario: ReturnType<typeof inventarioRepo>;
  gastos: ReturnType<typeof gastosRepo>;
  incidentes: ReturnType<typeof incidentesRepo>;
  trilha: ReturnType<typeof trilhaRepo>;
  paradas: ReturnType<typeof paradasRepo>;
  catcher: ReturnType<typeof catcherRepo>;
  maquinaTokens: ReturnType<typeof maquinaTokensRepo>;
}
