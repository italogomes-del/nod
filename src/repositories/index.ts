import type { Conn, Escopo } from "../shared/types.ts";
import { agentesRepo } from "./agentes.repo.ts";
import { catcherRepo } from "./catcher.repo.ts";
import { concessoesRepo } from "./concessoes.repo.ts";
import { conectoresRepo } from "./conectores.repo.ts";
import { conversasRepo } from "./conversas.repo.ts";
import { decisoesRepo } from "./decisoes.repo.ts";
import { eventsRepo } from "./events.repo.ts";
import { gastosRepo } from "./gastos.repo.ts";
import { inventarioRepo } from "./inventario.repo.ts";
import { itensAprovacaoRepo } from "./itens-aprovacao.repo.ts";
import { maquinaTokensRepo } from "./maquina-tokens.repo.ts";
import { memoriasRepo } from "./memorias.repo.ts";
import { mensagensRepo } from "./mensagens.repo.ts";
import { outboxRepo } from "./outbox.repo.ts";
import { paradasRepo } from "./paradas.repo.ts";
import { pessoasRepo } from "./pessoas.repo.ts";
import { procuracoesRepo } from "./procuracoes.repo.ts";
import { propostasRepo } from "./propostas.repo.ts";
import { rotinaExecucoesRepo } from "./rotina-execucoes.repo.ts";
import { rotinaJanelasRepo } from "./rotina-janelas.repo.ts";
import { rotinasRepo } from "./rotinas.repo.ts";
import { salasRepo } from "./salas.repo.ts";
import type { Repos } from "./tipos.ts";
import { trilhaRepo } from "./trilha.repo.ts";
import { turnosRepo } from "./turnos.repo.ts";

/** Os 24 repositórios sobre a MESMA conexão/transação e o MESMO escopo (Leapy §1). */
export function criarRepos(conn: Conn, escopo: Escopo): Repos {
  return {
    pessoas: pessoasRepo(conn, escopo),
    events: eventsRepo(conn, escopo),
    outbox: outboxRepo(conn, escopo),
    agentes: agentesRepo(conn, escopo),
    memorias: memoriasRepo(conn, escopo),
    conversas: conversasRepo(conn, escopo),
    mensagens: mensagensRepo(conn, escopo),
    propostas: propostasRepo(conn, escopo),
    turnos: turnosRepo(conn, escopo),
    decisoes: decisoesRepo(conn, escopo),
    itensAprovacao: itensAprovacaoRepo(conn, escopo),
    rotinas: rotinasRepo(conn, escopo),
    rotinaJanelas: rotinaJanelasRepo(conn, escopo),
    rotinaExecucoes: rotinaExecucoesRepo(conn, escopo),
    salas: salasRepo(conn, escopo),
    conectores: conectoresRepo(conn, escopo),
    concessoes: concessoesRepo(conn, escopo),
    procuracoes: procuracoesRepo(conn, escopo),
    inventario: inventarioRepo(conn, escopo),
    gastos: gastosRepo(conn, escopo),
    trilha: trilhaRepo(conn, escopo),
    paradas: paradasRepo(conn, escopo),
    catcher: catcherRepo(conn, escopo),
    maquinaTokens: maquinaTokensRepo(conn, escopo),
  };
}

export type { Repos } from "./tipos.ts";
