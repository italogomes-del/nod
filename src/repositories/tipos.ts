import type { composioRepo } from "./composio.repo.ts";
import type { computadoresRepo } from "./computadores.repo.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import type { agentesRepo } from "./agentes.repo.ts";
import type { anexosRepo } from "./anexos.repo.ts";
import type { artefatosRepo } from "./artefatos.repo.ts";
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
import type { pendenciasRepo } from "./pendencias.repo.ts";
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
import type { trabalhosRepo } from "./trabalhos.repo.ts";
import type { frentesRepo } from "./frentes.repo.ts";
import type { pedidosDeColegaRepo } from "./pedidos-de-colega.repo.ts";
import type { donosRepo } from "./donos.repo.ts";
import type { esperasRepo } from "./esperas.repo.ts";
import type { contasIaRepo } from "./contas-ia.repo.ts";
import type { turnoCredenciaisRepo } from "./turno-credenciais.repo.ts";
import type { preferenciasRepo, raioXRepo } from "./raio-x.repo.ts";
import type { onboardingRepo } from "./onboarding.repo.ts";
import type { comandosRepo } from "./comandos.repo.ts";
import type { usoDoPlanoRepo } from "./uso-do-plano.repo.ts";
import type { leiturasRepo } from "./leituras.repo.ts";
import type { ligacoesRepo } from "./ligacoes.repo.ts";
import type { liberacoesDispensadasRepo } from "./liberacoes-dispensadas.repo.ts";

/**
 * Regras de repositório (Práticas §1, ADR-018 refinado): factory `xRepo(conn: Conn, escopo: Escopo)`
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
  pendencias: ReturnType<typeof pendenciasRepo>;
  conversas: ReturnType<typeof conversasRepo>;
  mensagens: ReturnType<typeof mensagensRepo>;
  anexos: ReturnType<typeof anexosRepo>;
  artefatos: ReturnType<typeof artefatosRepo>;
  propostas: ReturnType<typeof propostasRepo>;
  relatos: ReturnType<typeof relatosRepo>;
  turnos: ReturnType<typeof turnosRepo>;
  trabalhos: ReturnType<typeof trabalhosRepo>;
  /** 0071 (ADR-099, partes 3/4): os lotes de frentes e o resumo da frente. */
  frentes: ReturnType<typeof frentesRepo>;
  /** ADR-099 (I7 revista): os pedidos entre bots vistos pela triagem do dono — espera circular, livres, quedas. */
  pedidosDeColega: ReturnType<typeof pedidosDeColegaRepo>;
  /** ADR-099 (I10): o que o estado do dono lê de cada bot (a linha acima do campo e a linha do bot em Trabalhos). */
  donos: ReturnType<typeof donosRepo>;
  /** 0070 (ADR-099, parte 2): as esperas de comando. */
  esperas: ReturnType<typeof esperasRepo>;
  /** 0074 (ADR-102): as contas de IA da pessoa em todas as máquinas. */
  contasIa: ReturnType<typeof contasIaRepo>;
  /** 0073 (NOD-214): a credencial do turno despachado (hash do token), para atravessar o reinício do servidor. */
  turnoCredenciais: ReturnType<typeof turnoCredenciaisRepo>;
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
  raioX: ReturnType<typeof raioXRepo>;
  preferencias: ReturnType<typeof preferenciasRepo>;
  onboarding: ReturnType<typeof onboardingRepo>;
  comandos: ReturnType<typeof comandosRepo>;
  usoDoPlano: ReturnType<typeof usoDoPlanoRepo>;
  leituras: ReturnType<typeof leiturasRepo>;
  ligacoes: ReturnType<typeof ligacoesRepo>;
  liberacoesDispensadas: ReturnType<typeof liberacoesDispensadasRepo>;
}
