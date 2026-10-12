import { composioRepo } from "./composio.repo.ts";
import { computadoresRepo } from "./computadores.repo.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { agentesRepo } from "./agentes.repo.ts";
import { anexosRepo } from "./anexos.repo.ts";
import { artefatosRepo } from "./artefatos.repo.ts";
import { catcherRepo } from "./catcher.repo.ts";
import { concessoesRepo } from "./concessoes.repo.ts";
import { permissoesPermanentesRepo } from "./permissoes-permanentes.repo.ts";
import { conectoresRepo } from "./conectores.repo.ts";
import { conversasRepo } from "./conversas.repo.ts";
import { decisoesRepo } from "./decisoes.repo.ts";
import { eventsRepo } from "./events.repo.ts";
import { gastosRepo } from "./gastos.repo.ts";
import { githubAppRepo } from "./github-app.repo.ts";
import { incidentesRepo } from "./incidentes.repo.ts";
import { inventarioRepo } from "./inventario.repo.ts";
import { itensAprovacaoRepo } from "./itens-aprovacao.repo.ts";
import { maquinaTokensRepo } from "./maquina-tokens.repo.ts";
import { memoriasRepo } from "./memorias.repo.ts";
import { mensagensRepo } from "./mensagens.repo.ts";
import { outboxRepo } from "./outbox.repo.ts";
import { paradasRepo } from "./paradas.repo.ts";
import { pendenciasRepo } from "./pendencias.repo.ts";
import { pessoasRepo } from "./pessoas.repo.ts";
import { procuracoesRepo } from "./procuracoes.repo.ts";
import { propostasRepo } from "./propostas.repo.ts";
import { relatosRepo } from "./relatos.repo.ts";
import { rotinaExecucoesRepo } from "./rotina-execucoes.repo.ts";
import { rotinaJanelasRepo } from "./rotina-janelas.repo.ts";
import { rotinasRepo } from "./rotinas.repo.ts";
import { salasRepo } from "./salas.repo.ts";
import type { Repos } from "./tipos.ts";
import { trilhaRepo } from "./trilha.repo.ts";
import { turnosRepo } from "./turnos.repo.ts";
import { trabalhosRepo } from "./trabalhos.repo.ts";
import { frentesRepo } from "./frentes.repo.ts";
import { esperasRepo } from "./esperas.repo.ts";
import { preferenciasRepo, raioXRepo } from "./raio-x.repo.ts";
import { onboardingRepo } from "./onboarding.repo.ts";
import { comandosRepo } from "./comandos.repo.ts";
import { usoDoPlanoRepo } from "./uso-do-plano.repo.ts";
import { leiturasRepo } from "./leituras.repo.ts";
import { ligacoesRepo } from "./ligacoes.repo.ts";
import { liberacoesDispensadasRepo } from "./liberacoes-dispensadas.repo.ts";

/** Os 24 repositórios sobre a MESMA conexão/transação e o MESMO escopo (Práticas §1). */
export function criarRepos(conn: Conn, escopo: Escopo): Repos {
  return {
    computadores: computadoresRepo(conn, escopo),
    pessoas: pessoasRepo(conn, escopo),
    events: eventsRepo(conn, escopo),
    outbox: outboxRepo(conn, escopo),
    agentes: agentesRepo(conn, escopo),
    memorias: memoriasRepo(conn, escopo),
    pendencias: pendenciasRepo(conn, escopo),
    conversas: conversasRepo(conn, escopo),
    mensagens: mensagensRepo(conn, escopo),
    anexos: anexosRepo(conn, escopo),
    artefatos: artefatosRepo(conn, escopo),
    propostas: propostasRepo(conn, escopo),
    relatos: relatosRepo(conn, escopo),
    turnos: turnosRepo(conn, escopo),
    trabalhos: trabalhosRepo(conn, escopo),
    frentes: frentesRepo(conn, escopo),
    esperas: esperasRepo(conn, escopo),
    decisoes: decisoesRepo(conn, escopo),
    itensAprovacao: itensAprovacaoRepo(conn, escopo),
    rotinas: rotinasRepo(conn, escopo),
    rotinaJanelas: rotinaJanelasRepo(conn, escopo),
    rotinaExecucoes: rotinaExecucoesRepo(conn, escopo),
    salas: salasRepo(conn, escopo),
    composio: composioRepo(conn, escopo),
    githubApp: githubAppRepo(conn, escopo),
    conectores: conectoresRepo(conn, escopo),
    concessoes: concessoesRepo(conn, escopo),
    permissoesPermanentes: permissoesPermanentesRepo(conn, escopo),
    procuracoes: procuracoesRepo(conn, escopo),
    inventario: inventarioRepo(conn, escopo),
    gastos: gastosRepo(conn, escopo),
    incidentes: incidentesRepo(conn, escopo),
    trilha: trilhaRepo(conn, escopo),
    paradas: paradasRepo(conn, escopo),
    catcher: catcherRepo(conn, escopo),
    maquinaTokens: maquinaTokensRepo(conn, escopo),
    raioX: raioXRepo(conn, escopo),
    preferencias: preferenciasRepo(conn, escopo),
    comandos: comandosRepo(conn, escopo),
    usoDoPlano: usoDoPlanoRepo(conn, escopo),
    leituras: leiturasRepo(conn, escopo),
    ligacoes: ligacoesRepo(conn, escopo),
    liberacoesDispensadas: liberacoesDispensadasRepo(conn, escopo),
    onboarding: onboardingRepo(conn, escopo),
  };
}

export type { Repos } from "./tipos.ts";
