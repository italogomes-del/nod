import { contasIaMemoria, estadoContasIaMemoria, type EstadoContasIaMemoria } from "./contas-ia-memoria.ts";
import type { ConfigGithubApp } from "../../src/repositories/github-app.repo.ts";
import type { MimeAnexo } from "../../src/contracts/anexo.ts";
import type { LinhaOnboarding } from "../../src/repositories/onboarding.repo.ts";
import type { ComposicaoRaioX, ExecucaoRaioX, Preferencias } from "../../src/contracts/raio-x.ts";
import type { CatalogoDeComandos } from "../../src/contracts/comandos.ts";
import type { UsoDoPlano } from "../../src/contracts/uso-do-plano.ts";
import { ESTADO_MAX_BYTES_ARTEFATO, type Artefato, type EstadoArtefato, type VersaoArtefato } from "../../src/contracts/artefato.ts";
import { randomUUID } from "node:crypto";
import type { Agente } from "../../src/contracts/agente.ts";
import type { PermissaoPermanente } from "../../src/contracts/permissao-permanente.ts";
import type { Concessao, Procuracao } from "../../src/contracts/concessao.ts";
import type { Conversa, Proposta } from "../../src/contracts/conversa.ts";
import { TIPOS_DISPENSAVEIS_ABERTOS, type Decisao } from "../../src/contracts/decisao.ts";
import type { Incidente } from "../../src/contracts/incidente.ts";
import type { Inventario } from "../../src/contracts/inventario.ts";
import type { ItemAprovacao } from "../../src/contracts/item-aprovacao.ts";
import type { Memoria } from "../../src/contracts/memoria.ts";
import type { Mensagem } from "../../src/contracts/mensagem.ts";
import type { Pendencia } from "../../src/contracts/pendencia.ts";
import type { ExecucaoRotina, Rotina } from "../../src/contracts/rotina.ts";
import type { MembroSala, Sala } from "../../src/contracts/sala.ts";
import type { Relato } from "../../src/contracts/relato.ts";
import type { EmojiDeReacao, ReacaoNaFala } from "../../src/contracts/reacao.ts";
import type { Turno } from "../../src/contracts/turno.ts";
import type { CredencialTurno } from "../../src/repositories/turno-credenciais.repo.ts";
import type { Trabalho } from "../../src/contracts/trabalho.ts";
import type { NovoLote } from "../../src/repositories/frentes.repo.ts";
import type { LoteDeFrentes, ResumoFrente } from "../../src/contracts/frente.ts";
import type { LinhaTrilha } from "../../src/db/schema/trilha.ts";
import { ORCAMENTO_INICIAL } from "../../src/domain/canal-orcamento.ts";
import { seguravelPeloMac } from "../../src/domain/memoria-mac.ts";
import { ateOPrimeiroAnexo, porChegada } from "../../src/domain/ordem-das-falas.ts";
import type { PedidoAberto } from "../../src/domain/triagem.ts";
import { cotaSegura, ENTRADA_DA_VOLTA_DA_COTA, tipoParaCota, type PortaoDaCota } from "../../src/domain/cota-da-ia.ts";
import { harnessFixado } from "../../src/domain/harness.ts";
import { iaDoModelo } from "../../src/domain/ia-do-modelo.ts";
import { HARNESS_LEGADO } from "../../src/contracts/harness.ts";
import { derivadosDa, INTELIGENCIA_PADRAO, inteligenciaDoLegado } from "../../src/domain/inteligencia.ts";
import type { ConectorGuardado } from "../../src/repositories/conectores.repo.ts";
import type { EventoGravavel } from "../../src/repositories/events.repo.ts";
import type { Gasto } from "../../src/repositories/gastos.repo.ts";
import type { ItemOutbox } from "../../src/repositories/outbox.repo.ts";
import type { ExtrasTrabalho } from "../../src/repositories/trabalhos.repo.ts";
import type { Espera } from "../../src/contracts/espera.ts";
import type { TrocaDeIa } from "../../src/contracts/troca-de-ia.ts";
import type { Parada } from "../../src/repositories/paradas.repo.ts";
import type { Pessoa } from "../../src/repositories/pessoas.repo.ts";
import type { JanelaReivindicada } from "../../src/repositories/rotina-janelas.repo.ts";
import type { Repos } from "../../src/repositories/tipos.ts";
import { EXECUCOES_GUARDADAS, LEASE_MS } from "../../src/shared/constantes.ts";
import type { Escopo } from "../../src/shared/types.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "./ids.ts";

/**
 * `Repos` em memória para tests/unit/use-cases (Práticas §1: a fábrica de tx vira `(fn) => fn({} as never)`
 * e os repos são estes). Mesmas assinaturas de src/repositories/*.repo.ts (o compilador cobra:
 * `satisfies Repos`), mesma semântica de retorno (null/[]), SEM RLS: o isolamento por pessoa se prova
 * em tests/integration, não aqui. Escopo por tenant é respeitado onde o SQL filtra por tenant/owner.
 * Constraints que importam ao caso de uso (UNIQUE de janela, CHECK do item sensível, dono imutável,
 * NOT EXISTS da reivindicação) são reproduzidas para o teste unitário ver o mesmo comportamento.
 */
export type BancoMemoria = {
  pessoas: Pessoa[];
  agentes: Agente[];
  /** agentes.geracao_execucao (ADR-034): ausente = 0. */
  geracoes: Map<string, number>;
  memorias: Memoria[];
  /** 0044 (ADR-064): as pendências do bot, com a dona e o turno que resolveu. */
  pendencias: (Pendencia & { ownerId: string; resolvidaNoTurnoId: string | null })[];
  conversas: Conversa[];
  mensagens: Mensagem[];
  /** NOD-156: `tenant:conversa:idEnvio` → id da mensagem (a coluna id_envio não sai em Mensagem). */
  idsDeEnvio: Map<string, string>;
  anexos: { tenantId: string; ownerId: string; id: string; conversaId: string; mensagemId: string | null; nome: string; mime: MimeAnexo; bytes: Buffer; criadoEm: number }[];
  /** ADR-051 (0031): artefato, versões e o estado por pessoa (UNIQUE tenant+artefato+owner reproduzido). */
  artefatos: (Artefato & { tenantId: string; ownerId: string })[];
  artefatoVersoes: (VersaoArtefato & { tenantId: string; ownerId: string })[];
  artefatoEstados: (EstadoArtefato & { tenantId: string; ownerId: string; json: string })[];
  propostas: Proposta[];
  turnos: Turno[];
  /** 0063 (ADR-083): os trabalhos, com a dona. */
  trabalhos: (Trabalho & { ownerId: string })[];
  /** 0070 (ADR-099, parte 2): as esperas de comando, com a dona (o comportamento completo se prova no Postgres). */
  esperas: (Espera & { tenantId: string; ownerId: string })[];
  /** 0074 (ADR-102): as contas de IA da pessoa e os vínculos com as máquinas. */
  contasIa: EstadoContasIaMemoria;
  /** 0080 (ADR-108): os avisos de troca de IA (o comportamento completo se prova no Postgres). */
  trocasDeIa: (TrocaDeIa & { tenantId: string; ownerId: string })[];
  /** ADR-102: turnos.conta_id e conversas/trabalhos.sessao_conta_id ("conversa:<id>" / "trabalho:<id>"). */
  contaDoTurno: Map<string, string | null>;
  /** NOD-280: a máquina "desta vez" de cada turno (o fake não a aplica no reivindicar; os testes a leem daqui). */
  maquinaDestaVez: Map<string, string>;
  contaDaSessao: Map<string, string | null>;
  /** ADR-107 (0079): conversas/trabalhos.sessao_maquina_id (mesmas chaves) e turnos.harness_efetivo. */
  maquinaDaSessao: Map<string, string | null>;
  harnessEfetivo: Map<string, string | null>;
  /** 0073 (NOD-214): as credenciais dos turnos despachados (o comportamento completo se prova no Postgres). */
  credenciais: (CredencialTurno & { tenantId: string; ownerId: string })[];
  entregas: Set<string>;
  decisoes: (Decisao & { decididaEm: number | null })[];
  varridos: Set<string>;
  itens: ItemAprovacao[];
  rotinas: Rotina[];
  janelas: JanelaReivindicada[];
  execucoes: ExecucaoRotina[];
  salas: Sala[];
  membros: (MembroSala & { criadoEm: number })[];
  conectores: ConectorGuardado[];
  composioChaves: Map<string, string>;
  /** 0032: quem continuou cada decisão e as raízes com o computador liberado para a tarefa. */
  continuacoes: Map<string, "turno" | "retomada">;
  computadorLiberado: Set<string>;
  /** 0034 (ADR-055): raízes com o terminal liberado para a tarefa. */
  terminalLiberado: Set<string>;
  /** 0035: a sessão do CLI e o total informado, por turno. */
  custoSessao: Map<string, { sessaoCli: string; total: number }>;
  /** NOD-291: turno → a sessão-mãe da cópia (`turnos.sessao_origem_cli`). */
  sessaoOrigem: Map<string, string>;
  /** 0036: o Raio-X de cada turno e as preferências de cada pessoa (chave tenant:pessoa). */
  raioX: Map<string, { composicao: ComposicaoRaioX | null; execucao: ExecucaoRaioX | null }>;
  preferencias: Map<string, Preferencias>;
  /** 0049 (ADR-077): o onboarding de cada pessoa (chave tenant:pessoa). */
  onboarding: Map<string, LinhaOnboarding>;
  /** 0038: o catálogo do "/" de cada pessoa (chave tenant:pessoa). */
  comandos: Map<string, { catalogo: CatalogoDeComandos; em: number }>;
  usoDoPlano: Map<string, UsoDoPlano>;
  /** 0039: o "lido até" de cada pessoa em cada conversa (chave tenant:pessoa:conversa). */
  leituras: Map<string, number>;
  /** 0054: o "Agora não" do cartão de liberar apps (chave tenant:pessoa:agente:conector → instante). */
  liberacoesDispensadas: Map<string, number>;
  /** 0033: turnos que trouxeram conteúdo da web pelas nativas. */
  contaminados: Set<string>;
  githubApp: Map<string, ConfigGithubApp>;
  composioSessoes: Map<string, import("../../src/repositories/composio.repo.ts").SessaoComposio>;
  concessoes: Concessao[];
  permissoes: PermissaoPermanente[];
  procuracoes: Procuracao[];
  inventario: { tenantId: string; pessoaId: string; motor: string; inventario: Inventario }[];
  gastos: (Gasto & { tenantId: string; ownerId: string })[];
  incidentes: (Incidente & { ownerId: string })[];
  relatos: (Relato & { ownerId: string })[];
  /** 0090 (ADR-113): uma por pessoa, fala e emoji (a regra completa, com a RLS, se prova no Postgres). */
  reacoes: { tenantId: string; ownerId: string; conversaId: string; mensagemId: string; emoji: EmojiDeReacao; criadoEm: number }[];
  trilha: LinhaTrilha[];
  paradas: (Parada & { tenantId: string })[];
  catcher: { tenantId: string; id: string; turnoId: string; tipo: string; dados: Record<string, unknown>; em: number }[];
  events: (EventoGravavel & { tenantId: string; id: string; createdAt: number })[];
  outbox: (ItemOutbox & { tenantId: string; ownerId: string; entregueEm: number | null; abandonadoEm: number | null; canceladoEm: number | null })[];
  maquinaTokens: { tenantId: string; ownerId: string; id: string; nome: string; prefixo: string; hash: Buffer; criadaEm: number; ultimoUsoEm: number | null; expiraEm: number | null; revogadaEm: number | null; plataforma?: "darwin" | "linux" | null }[];
  /** 0071 (ADR-099, partes 3/4): os lotes de frentes, com a dona (o comportamento completo se prova no Postgres). */
  lotes: (LoteDeFrentes & { tenantId: string; ownerId: string })[];
};

export function criarBancoMemoria(): { banco: BancoMemoria; repos(escopo?: Escopo): Repos } {
  const banco: BancoMemoria = {
    pessoas: [],
    agentes: [],
    geracoes: new Map(),
    memorias: [],
    pendencias: [],
    conversas: [],
    mensagens: [],
    idsDeEnvio: new Map(),
    anexos: [],
    artefatos: [],
    artefatoVersoes: [],
    artefatoEstados: [],
    propostas: [],
    turnos: [],
    trabalhos: [],
    esperas: [],
    contasIa: estadoContasIaMemoria(),
    trocasDeIa: [],
    contaDoTurno: new Map(),
    maquinaDestaVez: new Map(),
    contaDaSessao: new Map(),
    maquinaDaSessao: new Map(),
    harnessEfetivo: new Map(),
    credenciais: [],
    entregas: new Set(),
    decisoes: [],
    varridos: new Set(),
    itens: [],
    rotinas: [],
    janelas: [],
    execucoes: [],
    salas: [],
    membros: [],
    conectores: [],
    composioChaves: new Map(),
    continuacoes: new Map(),
    computadorLiberado: new Set(),
    terminalLiberado: new Set(),
    custoSessao: new Map(),
    sessaoOrigem: new Map(),
    raioX: new Map(),
    preferencias: new Map(),
    onboarding: new Map(),
    comandos: new Map(),
    usoDoPlano: new Map(),
    leituras: new Map(),
    liberacoesDispensadas: new Map(),
    contaminados: new Set(),
    githubApp: new Map(),
    composioSessoes: new Map(),
    concessoes: [],
    permissoes: [],
    procuracoes: [],
    inventario: [],
    gastos: [],
    incidentes: [],
    relatos: [],
    reacoes: [],
    trilha: [],
    paradas: [],
    catcher: [],
    events: [],
    outbox: [],
    maquinaTokens: [],
    lotes: [],
  };
  return { banco, repos: (escopo = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON }) => reposSobre(banco, escopo) };
}

/** Atalho: um banco novo e a visão da pessoa dada (default Marlon no tenant padrão). */
export function reposMemoria(escopo?: Escopo): Repos {
  return criarBancoMemoria().repos(escopo);
}

const agora = () => Date.now();
/** O que só existe no Postgres (consulta de faixa e de índice): o fake falha alto em vez de inventar resposta. */
const soNoPostgres = async (): Promise<never> => {
  throw new Error("só no Postgres: use tests/integration");
};
/** ADR-086: o pedido de volta anotado em cada turno (no Postgres, turnos.despertar_em/despertar_motivo). */
const despertares = new Map<string, { em: number; motivo: string }>();
const iso = (n: number) => new Date(n).toISOString();
const semDono = (l: Artefato & { tenantId: string; ownerId: string }): Artefato => ({ id: l.id, agenteId: l.agenteId, conversaId: l.conversaId, titulo: l.titulo, versaoAtual: l.versaoAtual, criadoEm: l.criadoEm, atualizadoEm: l.atualizadoEm });
const semDonoEspera = ({ tenantId: _tenant, ownerId: _dona, ...e }: Espera & { tenantId: string; ownerId: string }): Espera => ({ ...e });
const semDonoTrabalho = ({ ownerId: _dona, ...t }: Trabalho & { ownerId: string }): Trabalho => ({ ...t });
const semDonoPendencia = ({ ownerId: _dona, resolvidaNoTurnoId: _turno, ...p }: Pendencia & { ownerId: string; resolvidaNoTurnoId: string | null }): Pendencia => ({ ...p });

function reposSobre(b: BancoMemoria, escopo: Escopo): Repos {
  const doTenant = <T extends { tenantId: string }>(lista: T[]) => lista.filter((x) => x.tenantId === escopo.tenantId);
  /** A regra de seguradoPelaCotaSql (turnos.repo.ts): a IA fixada (ou a do modelo), o tipo do turno e o portão da cota. */
  const seguradoPelaCota = (t: Turno, cota: PortaoDaCota): boolean => {
    if (t.origem === "ligacao") return false;
    const ia = harnessFixado(t.harness, t.modelo) ?? (t.modelo !== "auto" ? iaDoModelo(t.modelo) : null);
    const trabalho = t.trabalhoId ? (doTenant(b.trabalhos).find((x) => x.id === t.trabalhoId) ?? null) : null;
    const auto = t.harness === "auto" && t.modelo === "auto";
    const naReserva = auto ? cota.autoReserva : cota.reserva.includes(ia ?? "");
    const noLimite = auto ? cota.autoLimite : cota.limite.includes(ia ?? "");
    return cotaSegura(tipoParaCota(t, trabalho), noLimite ? "limite" : naReserva ? "reserva" : "livre");
  };
  /** A linha do índice único propostas_acesso_de_rotina_aberta (0026): pedido de rotina pendente por (dona, agente, app). */
  const acessoDeRotinaAberto = (agenteId: string, conector: string): Proposta | null =>
    doTenant(b.propostas).find((p) => p.agenteId === agenteId && p.estado === "pendente" && p.payload.kind === "acesso" && p.payload.conector === conector && p.payload.rotinaId !== undefined) ?? null;

  /** O que listarComTurno do repo real devolve: origem e trabalho do turno, e a última fala de um turno encerrado. */
  const comTurno = (lista: Mensagem[]): Mensagem[] => lista.map((m) => {
    const t = m.turnoId ? doTenant(b.turnos).find((x) => x.id === m.turnoId) : undefined;
    const aberto = !m.turnoId ? doTenant(b.turnos).filter((x) => x.mensagemOrigemId === m.id).sort((x, y) => x.criadoEm - y.criadoEm)[0] : undefined;
    const falaDoBot = (x: Mensagem) => x.kind === "texto" && x.autoria.autor_tipo === "agente";
    const ultima = t ? lista.filter((x) => x.turnoId === t.id && falaDoBot(x)).at(-1) : undefined;
    return { ...m, origemTurno: t?.origem ?? null, trabalhoId: t?.trabalhoId ?? aberto?.trabalhoId ?? null, fimDoTurno: Boolean(t && (t.estado === "concluido" || t.estado === "interrompido") && falaDoBot(m) && ultima?.id === m.id) };
  });
  const minhasCredenciais = () => b.credenciais.filter((x) => x.tenantId === escopo.tenantId && x.ownerId === escopo.pessoaId);
  const minhasEsperas = () => b.esperas.filter((x) => x.tenantId === escopo.tenantId && x.ownerId === escopo.pessoaId);
  /** ADR-108 (turnos.repo daIa): as tasks pendentes do bot na IA — fixadas nela, ou no Automático com a sessão nela. */
  const tasksNaIa = (agenteId: string, ia: string | null) => doTenant(b.turnos).filter((t) => t.ownerId === escopo.pessoaId && t.agenteId === agenteId && t.estado === "pendente" && t.trabalhoId
    && (ia === null || t.harness === ia || (t.harness === "auto" && b.trabalhos.some((w) => w.tenantId === escopo.tenantId && w.id === t.trabalhoId && w.sessaoHarness === ia))));
  const repos = {
    computadores: {
      buscarVinculo: async () => null, buscarDoAgente: async () => undefined,
      obter: async () => null, travar: async () => null, configurar: async () => undefined,
      ocupar: async () => undefined, liberar: async () => undefined, atividade: async () => [], ociosos: async () => [], emUsoPor: async () => null,
      buscarAcao: async () => null, concluir: async () => undefined,
      gravarResultado: async () => undefined, tirarResultado: async () => null,
      registrar: async () => { throw new Error("use o banco para testar computadores"); },
      registrarFalha: async () => null, registrarSucesso: async () => false,
      // Sem computador em memória, nenhum está fora do ar (a frota em memória segue igual).
      foraDoAr: async () => new Map(),
    },
    pessoas: {
      async buscar(id: string) {
        return doTenant(b.pessoas).find((p) => p.id === id) ?? null;
      },
      async listarDoTenant() {
        return doTenant(b.pessoas).sort((x, y) => x.nome.localeCompare(y.nome));
      },
    },

    events: {
      async gravarComOutbox(eventos: EventoGravavel[]) {
        const ids: string[] = [];
        for (const ev of eventos) {
          const id = ev.id ?? randomUUID();
          const createdAt = ev.createdAt ?? agora();
          b.events.push({ ...ev, tenantId: escopo.tenantId, id, createdAt });
          b.outbox.push({
            tenantId: escopo.tenantId,
            ownerId: ev.pessoaDestinoId,
            id: randomUUID(),
            eventoId: id,
            tipo: ev.kind,
            dados: ev.dados ?? {},
            tentativas: 0,
            criadoEm: iso(createdAt),
            conversaId: ev.conversaId ?? null,
            turnoId: ev.turnoId ?? null,
            entregueEm: null,
            abandonadoEm: null,
            canceladoEm: null,
          });
          ids.push(id);
        }
        return { ids };
      },
      async gravarSemOutbox(eventos: EventoGravavel[]) {
        for (const ev of eventos) b.events.push({ ...ev, tenantId: escopo.tenantId, id: ev.id ?? randomUUID(), createdAt: ev.createdAt ?? agora() });
        return eventos.length;
      },
      async contarLinhas(desde: number) {
        const linhas = doTenant(b.events).filter((e) => (e.kind === "linha_mostrada" || e.kind === "linha_aberta") && e.pessoaDestinoId === escopo.pessoaId && e.createdAt >= desde);
        const tipos = [...new Set(linhas.map((e) => String(e.dados?.tipo)))];
        const distintas = (tipo: string, kind: string) => new Set(linhas.filter((e) => e.kind === kind && String(e.dados?.tipo) === tipo).map((e) => String(e.dados?.chave_linha))).size;
        return tipos.map((tipo) => ({ tipo, mostradas: distintas(tipo, "linha_mostrada"), abertas: distintas(tipo, "linha_aberta") }));
      },
      async listarRecentes(limite = 50) {
        return doTenant(b.events)
          .sort((x, y) => y.createdAt - x.createdAt)
          .slice(0, limite)
          .map((e) => ({ id: e.id, kind: e.kind, createdAt: iso(e.createdAt) }));
      },
    },

    outbox: {
      async pendentes(limite = 100) {
        return doTenant(b.outbox)
          .filter((o) => o.ownerId === escopo.pessoaId && o.entregueEm === null && o.abandonadoEm === null && o.canceladoEm === null)
          .sort((x, y) => Date.parse(x.criadoEm) - Date.parse(y.criadoEm))
          .slice(0, limite)
          .map(({ id, eventoId, tipo, dados, tentativas, criadoEm }) => {
            const ev = b.events.find((e) => e.id === eventoId);
            return { id, eventoId, tipo, dados, tentativas, criadoEm, conversaId: ev?.conversaId ?? null, turnoId: ev?.turnoId ?? null };
          });
      },
      async marcarEntregue(id: string) {
        const o = doTenant(b.outbox).find((x) => x.id === id && x.entregueEm === null);
        if (!o) return false;
        o.entregueEm = agora();
        return true;
      },
      async incrementarTentativa(id: string) {
        const o = doTenant(b.outbox).find((x) => x.id === id);
        if (!o) return null;
        o.tentativas += 1;
        return o.tentativas;
      },
      async abandonar(p: { teto: number; idadeMinMs: number; agora: number }) {
        let n = 0;
        for (const o of doTenant(b.outbox)) {
          if (o.ownerId !== escopo.pessoaId || o.entregueEm !== null || o.abandonadoEm !== null || o.canceladoEm !== null) continue;
          if (o.tentativas >= p.teto && Date.parse(o.criadoEm) < p.agora - p.idadeMinMs) {
            o.abandonadoEm = p.agora;
            n += 1;
          }
        }
        return n;
      },
      async contarAbandonados() {
        return doTenant(b.outbox).filter((o) => o.ownerId === escopo.pessoaId && o.abandonadoEm !== null).length;
      },
      async cancelarPendentesDaPessoa(em: number, conversaId: string | null = null) {
        let n = 0;
        for (const o of doTenant(b.outbox)) {
          if (conversaId !== null && b.events.find((e) => e.id === o.eventoId)?.conversaId !== conversaId) continue;
          if (o.ownerId === escopo.pessoaId && o.entregueEm === null && o.abandonadoEm === null && o.canceladoEm === null) {
            o.canceladoEm = em;
            n += 1;
          }
        }
        return n;
      },
    },

    agentes: {
      async execucaoBloqueada(turnoId) {
        const t = doTenant(b.turnos).find((t) => t.id === turnoId);
        return !!doTenant(b.agentes).find((a) => a.id === t?.agenteId)?.excluidoEm;
      },
      // A geração sobe a cada exclusão (agentes.geracao_execucao, 0012); em memória, um contador por agente.
      async geracaoExecucao(id) {
        return doTenant(b.agentes).some((a) => a.id === id) ? (b.geracoes.get(id) ?? 0) : null;
      },
      async organizar(id, campos) {
        const a = doTenant(b.agentes).find((a) => a.id === id && a.ownerId === escopo.pessoaId && !a.excluidoEm);
        if (!a) return null;
        Object.assign(a, campos);
        return a;
      },
      async ordenar(ids) {
        let n = 0;
        ids.forEach((id, i) => {
          const a = doTenant(b.agentes).find((a) => a.id === id && a.ownerId === escopo.pessoaId && !a.excluidoEm);
          if (a) { a.posicao = i; n += 1; }
        });
        return n;
      },
      async excluir(id, em) {
        const a = doTenant(b.agentes).find((a) => a.id === id && a.ownerId === escopo.pessoaId && !a.excluidoEm);
        if (!a) return null;
        a.excluidoEm = em;
        a.fixado = false;
        a.modoAprovacao = "manual";
        b.geracoes.set(id, (b.geracoes.get(id) ?? 0) + 1);
        for (const r of doTenant(b.rotinas).filter((r) => r.agenteId === id)) r.estado = "pausada";
        b.concessoes = b.concessoes.filter((c) => c.agenteId !== id);
        for (const t of doTenant(b.trabalhos).filter((t) => t.agenteId === id && ["na_fila", "rodando", "precisa_de_voce", "fechado_ocioso"].includes(t.estado))) {
          t.estado = "parado";
          t.terminadoEm = em;
        }
        return a;
      },
      async restaurar(id) {
        const a = doTenant(b.agentes).find((a) => a.id === id && a.ownerId === escopo.pessoaId && a.excluidoEm);
        if (!a) return null;
        a.excluidoEm = null;
        a.oculto = false;
        return a;
      },
      async criar(a) {
        // 0068: como o SQL — a inteligência inteira e os derivados gravados juntos.
        const inteligencia = a.inteligencia ?? inteligenciaDoLegado(INTELIGENCIA_PADRAO, { harness: a.harness ?? "auto", modelo: a.modelo });
        const d = derivadosDa(inteligencia);
        const agente: Agente = {
          tenantId: escopo.tenantId,
          id: a.id ?? randomUUID(),
          ownerId: escopo.pessoaId,
          visibility: a.visibility ?? (a.dono === "empresa" ? "equipe" : "privado"),
          nome: a.nome,
          titulo: a.titulo ?? "",
          descricao: a.descricao ?? "",
          dono: a.dono,
          forma: a.forma,
          cor: a.cor,
          fixado: false,
          oculto: false,
          confirmado: a.confirmado ?? false,
          modelo: d.modelo,
          harness: d.harness,
          esforco: d.esforco,
          inteligencia,
          duplicadoDe: a.duplicadoDe ?? null,
          criadoEm: agora(),
        };
        b.agentes.push(agente);
        return agente;
      },
      async buscar(id, incluirExcluidos = false) {
        return doTenant(b.agentes).find((a) => a.id === id && (incluirExcluidos || !a.excluidoEm)) ?? null;
      },
      async buscarPorNome(nome) {
        return doTenant(b.agentes).find((a) => a.nome.toLowerCase() === nome.toLowerCase()) ?? null;
      },
      async listar(opcoes = {}) {
        return doTenant(b.agentes)
          .filter((a) => (opcoes.incluirExcluidos || !a.excluidoEm) && (opcoes.incluirOcultos || !a.oculto))
          .sort((x, y) => Number(y.fixado) - Number(x.fixado) || (x.posicao ?? Infinity) - (y.posicao ?? Infinity) || x.criadoEm - y.criadoEm);
      },
      async buscarParaAtualizar(id) {
        // Espelha o SQL: só a dona e não excluído. Sem concorrência na memória, sem lock.
        return doTenant(b.agentes).find((a) => a.id === id && a.ownerId === escopo.pessoaId && !a.excluidoEm) ?? null;
      },
      async atualizarPerfil(id, perfil) {
        const a = doTenant(b.agentes).find((x) => x.id === id);
        if (!a) return null;
        Object.assign(a, {
          nome: perfil.nome ?? a.nome,
          titulo: perfil.titulo ?? a.titulo,
          descricao: perfil.descricao ?? a.descricao,
          confirmado: perfil.confirmado ?? a.confirmado,
          forma: perfil.forma ?? a.forma,
          cor: perfil.cor ?? a.cor,
          // 0068: a inteligência grava os derivados junto (harness, modelo e o esforço do Claude).
          ...(perfil.inteligencia ? { inteligencia: perfil.inteligencia, ...derivadosDa(perfil.inteligencia) } : {}),
        });
        return a;
      },
      async definirMaquina(ids, maquinaId) {
        const as = doTenant(b.agentes).filter((x) => ids.includes(x.id) && x.ownerId === escopo.pessoaId && !x.excluidoEm);
        for (const a of as) a.maquinaId = maquinaId;
        return as;
      },
      async definirModoAprovacao(id, modo) {
        const a = doTenant(b.agentes).find((x) => x.id === id && x.ownerId === escopo.pessoaId && !x.excluidoEm);
        if (!a) return null;
        a.modoAprovacao = modo;
        return a;
      },
      async fixar(id, fixado) {
        const a = doTenant(b.agentes).find((x) => x.id === id);
        if (!a) return null;
        a.fixado = fixado;
        return a;
      },
      async ocultar(id, oculto) {
        const a = doTenant(b.agentes).find((x) => x.id === id);
        if (!a) return null;
        a.oculto = oculto;
        return a;
      },
      // ADR-104: sem concorrência na memória, a trava dos nomes não faz nada.
      async travarNomesDeBots() {},
      // ADR-081: sem concorrência na memória, travar é só buscar.
      async travarNod() {
        return doTenant(b.agentes).find((a) => a.ownerId === escopo.pessoaId && a.papel === "nod") ?? null;
      },
      async buscarNod() {
        return doTenant(b.agentes).find((a) => a.ownerId === escopo.pessoaId && a.papel === "nod") ?? null;
      },
      async marcarComoNod(id, perfil) {
        const a = doTenant(b.agentes).find((x) => x.id === id && x.ownerId === escopo.pessoaId && x.dono === "pessoa" && !x.excluidoEm && !x.papel);
        if (!a || doTenant(b.agentes).some((x) => x.ownerId === escopo.pessoaId && x.papel === "nod")) return null;
        Object.assign(a, { ...perfil, papel: "nod", cor: "c-black", fixado: true, oculto: false, confirmado: true });
        return a;
      },
      async definirVoz(id, p) {
        const a = doTenant(b.agentes).find((x) => x.id === id);
        if (!a) return null;
        if (p.voz !== undefined) a.voz = p.voz;
        if (p.velocidade !== undefined) a.vozVelocidade = p.velocidade;
        return a;
      },
    },

    memorias: {
      async criar(m) {
        const memoria: Memoria = { tenantId: escopo.tenantId, id: m.id ?? randomUUID(), agenteId: m.agenteId, tipo: m.tipo, texto: m.texto, origem: m.origem, criadoEm: agora() };
        b.memorias.push(memoria);
        return memoria;
      },
      async buscar(id) {
        return doTenant(b.memorias).find((m) => m.id === id) ?? null;
      },
      async listarDoAgente(agenteId) {
        return doTenant(b.memorias).filter((m) => m.agenteId === agenteId).sort((x, y) => x.criadoEm - y.criadoEm || x.id.localeCompare(y.id));
      },
      async atualizar(id, campos) {
        const m = doTenant(b.memorias).find((x) => x.id === id);
        if (!m) return null;
        if (campos.texto !== undefined) m.texto = campos.texto;
        if (campos.tipo !== undefined) m.tipo = campos.tipo;
        return m;
      },
      async apagar(id) {
        const i = b.memorias.findIndex((m) => m.tenantId === escopo.tenantId && m.id === id);
        if (i === -1) return false;
        b.memorias.splice(i, 1);
        return true;
      },
    },

    pendencias: {
      async criar(n) {
        const linha = {
          tenantId: escopo.tenantId,
          ownerId: escopo.pessoaId,
          id: randomUUID(),
          agenteId: n.agenteId,
          conversaId: n.conversaId,
          turnoId: n.turnoId,
          texto: n.texto,
          aPartirDe: n.aPartirDe,
          cuidado: n.cuidado,
          profundidade: n.profundidade as Pendencia["profundidade"],
          estado: "aberta" as const,
          resolvidaEm: null,
          resolvidaPor: null,
          motivo: null,
          pedidaEm: null,
          criadoEm: agora(),
          resolvidaNoTurnoId: null,
        };
        b.pendencias.push(linha);
        return semDonoPendencia(linha);
      },
      async buscar(id) {
        const p = doTenant(b.pendencias).find((x) => x.id === id);
        return p ? semDonoPendencia(p) : null;
      },
      async abertasDoAgente(agenteId) {
        return doTenant(b.pendencias)
          .filter((p) => p.agenteId === agenteId && p.estado === "aberta")
          .sort((x, y) => y.criadoEm - x.criadoEm || y.id.localeCompare(x.id))
          .map(semDonoPendencia);
      },
      async resolver(id, r) {
        const p = doTenant(b.pendencias).find((x) => x.id === id && x.ownerId === escopo.pessoaId && x.estado === "aberta");
        if (!p) return null;
        Object.assign(p, { estado: r.estado, resolvidaEm: r.agora, resolvidaPor: r.por, resolvidaNoTurnoId: r.turnoId, motivo: r.motivo });
        return semDonoPendencia(p);
      },
      async marcarPedida(id, quando, repedirAposMs) {
        const p = doTenant(b.pendencias).find((x) => x.id === id && x.ownerId === escopo.pessoaId && x.estado === "aberta");
        if (!p || (p.pedidaEm !== null && p.pedidaEm > quando - repedirAposMs)) return null;
        p.pedidaEm = quando;
        return semDonoPendencia(p);
      },
      async resolvidasNoTurno(turnoId) {
        return doTenant(b.pendencias).filter((p) => p.resolvidaNoTurnoId === turnoId).length;
      },
    },

    conversas: {
      async criar(c) {
        const conversa: Conversa = {
          tenantId: escopo.tenantId,
          id: c.id ?? randomUUID(),
          ownerId: escopo.pessoaId,
          visibility: c.visibility ?? "privado",
          tipo: c.tipo,
          agenteId: c.tipo === "propria" ? c.agenteId : null,
          salaId: c.tipo === "sala" ? c.salaId : null,
          sessaoCli: null,
          criadoEm: agora(),
        };
        b.conversas.push(conversa);
        return conversa;
      },
      async buscar(id) {
        return doTenant(b.conversas).find((c) => c.id === id) ?? null;
      },
      async buscarPropriaDoAgente(agenteId) {
        return doTenant(b.conversas).find((c) => c.tipo === "propria" && c.agenteId === agenteId) ?? null;
      },
      async propriasDosAgentes(agenteIds) {
        const saida = new Map<string, Conversa>();
        for (const id of agenteIds) {
          const c = doTenant(b.conversas).find((x) => x.tipo === "propria" && x.agenteId === id);
          if (c) saida.set(id, c);
        }
        return saida;
      },
      async buscarDaSala(salaId) {
        return doTenant(b.conversas).find((c) => c.tipo === "sala" && c.salaId === salaId) ?? null;
      },
      async listar() {
        return doTenant(b.conversas).sort((x, y) => x.criadoEm - y.criadoEm);
      },
      async recomecar(id) {
        const c = doTenant(b.conversas).find((x) => x.id === id);
        if (!c) return false;
        Object.assign(c, { sessaoCli: null, sessaoExecutor: null, sessaoHarness: null, sessaoEm: null, recomecoEm: agora() });
        b.maquinaDaSessao.delete(`conversa:${id}`);
        return true;
      },
      async atualizarSessaoCli(id, sessaoCli, sessaoExecutor = null, sessaoHarness = null, maquinaId = null) {
        const c = doTenant(b.conversas).find((x) => x.id === id);
        if (!c) return false;
        c.sessaoCli = sessaoCli;
        c.sessaoExecutor = sessaoCli ? sessaoExecutor : null;
        c.sessaoHarness = sessaoCli ? sessaoHarness : null;
        c.sessaoEm = sessaoCli ? agora() : null;
        b.contaDaSessao.delete(`conversa:${id}`);
        b.maquinaDaSessao.set(`conversa:${id}`, sessaoCli ? maquinaId : null);
        return true;
      },
      async definirContaDaSessao(id, contaId) { b.contaDaSessao.set(`conversa:${id}`, contaId); },
      async contaDaSessao(id) { return b.contaDaSessao.get(`conversa:${id}`) ?? null;
      },
      async maquinaDaSessao(id) { return b.maquinaDaSessao.get(`conversa:${id}`) ?? null; },
    },

    anexos: {
      async criar(a) {
        const l = { tenantId: escopo.tenantId, ownerId: escopo.pessoaId, id: randomUUID(), conversaId: a.conversaId, mensagemId: null, nome: a.nome, mime: a.mime, bytes: Buffer.from(a.conteudo), criadoEm: Date.now() };
        b.anexos.push(l);
        return { id: l.id, nome: l.nome, mime: l.mime, tamanho: l.bytes.byteLength, conversaId: l.conversaId, mensagemId: null };
      },
      async buscar(id) {
        const l = doTenant(b.anexos).find((x) => x.id === id);
        return l ? { id: l.id, nome: l.nome, mime: l.mime, tamanho: l.bytes.byteLength, conversaId: l.conversaId, mensagemId: l.mensagemId } : null;
      },
      async conteudo(id) {
        const l = doTenant(b.anexos).find((x) => x.id === id);
        return l ? { meta: { id: l.id, nome: l.nome, mime: l.mime, tamanho: l.bytes.byteLength, conversaId: l.conversaId, mensagemId: l.mensagemId }, bytes: l.bytes } : null;
      },
      async prender(ids, p) {
        return ids.flatMap((id) => {
          const l = doTenant(b.anexos).find((x) => x.id === id && x.ownerId === escopo.pessoaId && x.conversaId === p.conversaId && x.mensagemId === null);
          if (!l) return [];
          l.mensagemId = p.mensagemId;
          return [{ id: l.id, nome: l.nome, mime: l.mime, tamanho: l.bytes.byteLength }];
        });
      },
      async daMensagens(ids) {
        const saida = new Map<string, { id: string; nome: string; mime: MimeAnexo; tamanho: number }[]>();
        for (const l of doTenant(b.anexos)) {
          if (!l.mensagemId || !ids.includes(l.mensagemId)) continue;
          saida.set(l.mensagemId, [...(saida.get(l.mensagemId) ?? []), { id: l.id, nome: l.nome, mime: l.mime, tamanho: l.bytes.byteLength }]);
        }
        return saida;
      },
      async metas(ids) {
        return ids.flatMap((id) => {
          const l = doTenant(b.anexos).find((x) => x.id === id);
          return l ? [{ id: l.id, nome: l.nome, mime: l.mime, tamanho: l.bytes.byteLength }] : [];
        });
      },
    },

    artefatos: {
      async criar(a) {
        const t = agora();
        const l = { tenantId: escopo.tenantId, ownerId: escopo.pessoaId, id: randomUUID(), agenteId: a.agenteId, conversaId: a.conversaId, titulo: a.titulo, versaoAtual: 1, criadoEm: t, atualizadoEm: t };
        b.artefatos.push(l);
        return semDono(l);
      },
      async buscar(id) {
        // Sem RLS aqui (o isolamento por pessoa se prova na integração), mas o artefato é privado da dona.
        const l = doTenant(b.artefatos).find((x) => x.id === id && x.ownerId === escopo.pessoaId);
        return l ? semDono(l) : null;
      },
      async proximaVersao(id, titulo) {
        const l = doTenant(b.artefatos).find((x) => x.id === id && x.ownerId === escopo.pessoaId);
        if (!l) return null;
        l.versaoAtual += 1;
        l.titulo = titulo;
        l.atualizadoEm = agora();
        return semDono(l);
      },
      async gravarVersao(v) {
        if (doTenant(b.artefatoVersoes).some((x) => x.artefatoId === v.artefatoId && x.versao === v.versao)) throw new Error("artefato_versoes_unica");
        const l = { tenantId: escopo.tenantId, ownerId: escopo.pessoaId, artefatoId: v.artefatoId, versao: v.versao, html: v.html, mensagemId: v.mensagemId, criadoEm: agora() };
        b.artefatoVersoes.push(l);
        return { artefatoId: l.artefatoId, versao: l.versao, html: l.html, mensagemId: l.mensagemId, criadoEm: l.criadoEm };
      },
      async versao(artefatoId, versao) {
        const l = doTenant(b.artefatoVersoes).find((x) => x.artefatoId === artefatoId && x.versao === versao && x.ownerId === escopo.pessoaId);
        return l ? { artefatoId: l.artefatoId, versao: l.versao, html: l.html, mensagemId: l.mensagemId, criadoEm: l.criadoEm } : null;
      },
      async estado(artefatoId) {
        const l = doTenant(b.artefatoEstados).find((x) => x.artefatoId === artefatoId && x.ownerId === escopo.pessoaId);
        return l ? { artefatoId: l.artefatoId, dados: l.dados, atualizadoEm: l.atualizadoEm } : null;
      },
      async salvarEstado(artefatoId, json) {
        // O banco mede o texto normalizado do jsonb; aqui, o texto recebido (a validação veio antes).
        if (Buffer.byteLength(json, "utf8") > ESTADO_MAX_BYTES_ARTEFATO) return null;
        const dados: unknown = JSON.parse(json);
        const existente = doTenant(b.artefatoEstados).find((x) => x.artefatoId === artefatoId && x.ownerId === escopo.pessoaId);
        if (existente) {
          existente.dados = dados;
          existente.json = json;
          existente.atualizadoEm = agora();
          return { artefatoId, dados, atualizadoEm: existente.atualizadoEm };
        }
        const l = { tenantId: escopo.tenantId, ownerId: escopo.pessoaId, artefatoId, dados, json, atualizadoEm: agora() };
        b.artefatoEstados.push(l);
        return { artefatoId, dados, atualizadoEm: l.atualizadoEm };
      },
    },

    mensagens: {
      async criar(m) {
        const chave = m.idEnvio ? `${escopo.tenantId}:${m.conversaId}:${m.idEnvio}` : null;
        if (chave && b.idsDeEnvio.has(chave)) return null;
        const mensagem: Mensagem = {
          tenantId: escopo.tenantId,
          id: m.id ?? randomUUID(),
          conversaId: m.conversaId,
          turnoId: m.turnoId ?? null,
          autoria: m.autoria,
          kind: m.kind,
          texto: m.texto,
          payload: m.payload ?? null,
          confianca: m.confianca,
          parcial: m.parcial ?? false,
          criadoEm: agora() + b.mensagens.length / 1000,
        };
        b.mensagens.push(mensagem);
        if (chave) b.idsDeEnvio.set(chave, mensagem.id);
        return mensagem;
      },
      async buscarPorIdEnvio(conversaId, idEnvio) {
        const id = b.idsDeEnvio.get(`${escopo.tenantId}:${conversaId}:${idEnvio}`);
        return id ? (doTenant(b.mensagens).find((m) => m.id === id) ?? null) : null;
      },
      async buscar(id) {
        return doTenant(b.mensagens).find((m) => m.id === id) ?? null;
      },
      async listarDaConversa(conversaId, limite = 200) {
        const todas = doTenant(b.mensagens).filter((m) => m.conversaId === conversaId).sort((x, y) => x.criadoEm - y.criadoEm);
        return todas.slice(Math.max(0, todas.length - limite));
      },
      async listarComTurno(conversaId, limite = 200) {
        const todas = doTenant(b.mensagens).filter((m) => m.conversaId === conversaId).sort((x, y) => x.criadoEm - y.criadoEm);
        return comTurno(todas.slice(Math.max(0, todas.length - limite)));
      },
      async doTrabalho(trabalhoId, limite = 300) {
        const turnos = doTenant(b.turnos).filter((t) => t.trabalhoId === trabalhoId);
        const ids = new Set(turnos.map((t) => t.id));
        const origens = new Set(turnos.flatMap((t) => (t.mensagemOrigemId ? [t.mensagemOrigemId] : [])));
        const todas = doTenant(b.mensagens).filter((m) => (m.turnoId !== null && ids.has(m.turnoId)) || origens.has(m.id)).sort((x, y) => x.criadoEm - y.criadoEm);
        return comTurno(todas.slice(Math.max(0, todas.length - limite)));
      },
      async janelaAte(conversaId, ancoraId, desde, limite = 100) {
        const ancora = doTenant(b.mensagens).find((m) => m.id === ancoraId);
        const todas = doTenant(b.mensagens)
          .filter((m) => m.conversaId === conversaId && m.criadoEm >= desde && (m.id === ancoraId || (ancora ? m.criadoEm <= ancora.criadoEm : true)))
          .sort((x, y) => x.criadoEm - y.criadoEm);
        return todas.slice(Math.max(0, todas.length - limite));
      },
      async ultimaDaConversa(conversaId) {
        const todas = doTenant(b.mensagens).filter((m) => m.conversaId === conversaId).sort((x, y) => x.criadoEm - y.criadoEm);
        return todas[todas.length - 1] ?? null;
      },
      async ultimasDasConversas(conversaIds) {
        const saida = new Map<string, Mensagem>();
        for (const id of conversaIds) {
          const todas = doTenant(b.mensagens).filter((m) => m.conversaId === id).sort((x, y) => x.criadoEm - y.criadoEm);
          const ultima = todas[todas.length - 1];
          if (ultima) saida.set(id, ultima);
        }
        return saida;
      },
      async pedidoAPessoaDaDecisao(turnoId, decisaoId) {
        return doTenant(b.mensagens).filter((m) => m.turnoId === turnoId && m.payload?.kind === "pedido_a_pessoa" && m.payload.decisaoId === decisaoId).sort((x, y) => x.criadoEm - y.criadoEm)[0] ?? null;
      },
      async pedidosAPessoaDasDecisoes(turnoIds) {
        const ids = new Set(turnoIds);
        return comTurno(doTenant(b.mensagens).filter((m) => m.turnoId !== null && ids.has(m.turnoId) && m.payload?.kind === "pedido_a_pessoa").sort((x, y) => x.criadoEm - y.criadoEm));
      },
      async pedidoDaTarefa(turnoId) {
        return doTenant(b.mensagens).filter((m) => m.turnoId === turnoId && m.payload?.kind === "peer_pedido").sort((x, y) => x.criadoEm - y.criadoEm)[0] ?? null;
      },
      async marcarParcial(id, parcial) {
        const m = doTenant(b.mensagens).find((x) => x.id === id);
        if (!m) return false;
        m.parcial = parcial;
        return true;
      },
      async atualizarSistema(id, m) {
        const x = doTenant(b.mensagens).find((y) => y.id === id && y.kind === "sistema");
        if (!x) return false;
        Object.assign(x, { texto: m.texto, payload: m.payload, turnoId: x.turnoId ?? m.turnoId ?? null });
        return true;
      },
      async marcarParciaisDoTurno(turnoId) {
        let n = 0;
        for (const m of doTenant(b.mensagens)) {
          if (m.turnoId === turnoId && m.autoria.autor_tipo === "agente") {
            m.parcial = true;
            n += 1;
          }
        }
        return n;
      },
    },

    propostas: {
      async criar(p) {
        // O índice único propostas_acesso_de_rotina_aberta (0026) vale aqui também: quem insere pedido de
        // rotina por `criar` em vez de `criarAcessoDeRotina` recebe o mesmo 23505 que o Postgres daria.
        if (p.payload.kind === "acesso" && p.payload.rotinaId && acessoDeRotinaAberto(p.agenteId, p.payload.conector)) {
          throw Object.assign(new Error("duplicate key value violates unique constraint \"propostas_acesso_de_rotina_aberta\""), { code: "23505" });
        }
        const proposta: Proposta = { tenantId: escopo.tenantId, id: p.id ?? randomUUID(), conversaId: p.conversaId, agenteId: p.agenteId, kind: p.payload.kind, estado: "pendente", payload: p.payload, criadoEm: agora() };
        b.propostas.push(proposta);
        return proposta;
      },
      async conexoesPendentes(conector) {
        return doTenant(b.propostas).filter((p) => p.estado === "pendente" && p.payload.kind === "acesso" && p.payload.conector === conector && p.payload.conectar === true).sort((x, y) => x.criadoEm - y.criadoEm);
      },
      async criarAcessoDeRotina(p) {
        const existente = acessoDeRotinaAberto(p.agenteId, p.payload.conector);
        if (existente) return { proposta: existente, criada: false };
        const proposta: Proposta = { tenantId: escopo.tenantId, id: p.id ?? randomUUID(), conversaId: p.conversaId, agenteId: p.agenteId, kind: "acesso", estado: "pendente", payload: p.payload, criadoEm: agora() };
        b.propostas.push(proposta);
        return { proposta, criada: true };
      },
      async acessoDeRotinaAberto(agenteId, conector) {
        return acessoDeRotinaAberto(agenteId, conector);
      },
      async pendentesDeAcessoDaRotina(rotinaId) {
        return doTenant(b.propostas).filter((p) => p.payload.kind === "acesso" && p.estado === "pendente" && p.payload.rotinaId === rotinaId);
      },
      async buscar(id) {
        return doTenant(b.propostas).find((p) => p.id === id) ?? null;
      },
      async buscarParaAtualizar(id) {
        // Espelha `buscar`; sem concorrência na memória, sem lock.
        return doTenant(b.propostas).find((p) => p.id === id) ?? null;
      },
      async pendentesDaConversa(conversaId) {
        return doTenant(b.propostas).filter((p) => p.conversaId === conversaId && p.estado === "pendente");
      },
      async acessosPendentesCriadosEntre(desde, ate) {
        return doTenant(b.propostas).filter((p) => p.estado === "pendente" && p.kind === "acesso" && p.criadoEm >= desde && p.criadoEm < ate);
      },
      async decidir(id, estado) {
        const p = doTenant(b.propostas).find((x) => x.id === id && x.estado === "pendente");
        if (!p) return null;
        p.estado = estado;
        return p;
      },
      async atualizarPayload(id, payload) {
        const p = doTenant(b.propostas).find((x) => x.id === id && x.kind === payload.kind);
        if (!p) return null;
        p.payload = payload;
        return p;
      },
    },

    contasIa: contasIaMemoria(b.contasIa, escopo),
    trocasDeIa: (() => {
      const minhas = () => b.trocasDeIa.filter((x) => x.tenantId === escopo.tenantId && x.ownerId === escopo.pessoaId);
      const sem = ({ tenantId: _t, ownerId: _o, ...t }: TrocaDeIa & { tenantId: string; ownerId: string }): TrocaDeIa => ({ ...t });
      return {
        async abrir(n) {
          // Revisão do PR 2 (I2): um aberto por bot E IA que parou.
          const aberta = minhas().find((x) => x.agenteId === n.agenteId && x.iaDe === n.iaDe && x.decididoEm === null);
          if (aberta) {
            Object.assign(aberta, { iaPara: n.iaPara, recomendacao: n.recomendacao, voltaEm: n.voltaEm, fixo: n.fixo, machineId: n.machineId, contaDe: n.contaDe ?? aberta.contaDe, aplicarEm: n.recomendacao === "levar" ? aberta.aplicarEm ?? n.aplicarEm : null });
            return { troca: sem(aberta), nova: false };
          }
          const t = { tenantId: escopo.tenantId, ownerId: escopo.pessoaId, id: randomUUID(), agenteId: n.agenteId, conversaId: n.conversaId, iaDe: n.iaDe, iaPara: n.iaPara, recomendacao: n.recomendacao, voltaEm: n.voltaEm, criadaEm: n.agora, aplicarEm: n.aplicarEm, decididoEm: null, decisao: null, mensagemId: null, fixo: n.fixo, voltaAoFixo: null, restauradoEm: null, machineId: n.machineId, contaDe: n.contaDe ?? null, voltouEm: null };
          b.trocasDeIa.push(t);
          return { troca: sem(t), nova: true };
        },
        async definirMensagem(id, mensagemId) { const t = minhas().find((x) => x.id === id); if (t) t.mensagemId = mensagemId; },
        async buscar(id) { const t = minhas().find((x) => x.id === id); return t ? sem(t) : null; },
        async abertaDoAgente(agenteId, iaDe) {
          const t = minhas().filter((x) => x.agenteId === agenteId && x.decididoEm === null && (!iaDe || x.iaDe === iaDe)).sort((x, y) => x.criadaEm - y.criadaEm)[0];
          return t ? sem(t) : null;
        },
        async abertasDoAgente(agenteId) { return minhas().filter((x) => x.agenteId === agenteId && x.decididoEm === null).sort((x, y) => x.criadaEm - y.criadaEm).map(sem); },
        async esperaDecidida(agenteId, iaDe) {
          const t = minhas().filter((x) => x.agenteId === agenteId && x.iaDe === iaDe && x.decisao === "esperar" && x.voltouEm === null).sort((x, y) => (y.decididoEm ?? 0) - (x.decididoEm ?? 0))[0];
          return t ? sem(t) : null;
        },
        async fechadaRecente(agenteId, iaDe, desde) {
          const t = minhas().filter((x) => x.agenteId === agenteId && x.iaDe === iaDe && x.decididoEm !== null && x.decididoEm >= desde && x.mensagemId !== null).sort((x, y) => (y.decididoEm ?? 0) - (x.decididoEm ?? 0))[0];
          return t ? sem(t) : null;
        },
        async marcarVoltou(id, em) {
          const t = minhas().find((x) => x.id === id && (x.decisao === "esperar" || x.decisao === "conta") && x.voltouEm === null);
          if (!t) return false;
          t.voltouEm = em;
          return true;
        },
        async fechar(id, decisao, em, voltaAoFixo) {
          const t = minhas().find((x) => x.id === id && x.decididoEm === null);
          if (!t) return null;
          Object.assign(t, { decididoEm: em, decisao, voltaAoFixo: voltaAoFixo ?? null });
          return sem(t);
        },
        async marcarRestaurada(id, em) {
          const t = minhas().find((x) => x.id === id && x.voltaAoFixo !== null && x.restauradoEm === null);
          if (!t) return false;
          t.restauradoEm = em;
          return true;
        },
        async paraVarrer() { return minhas().filter((x) => x.decididoEm === null || (x.voltaAoFixo !== null && x.restauradoEm === null) || ((x.decisao === "esperar" || x.decisao === "conta") && x.voltouEm === null)).sort((x, y) => x.criadaEm - y.criadaEm).map(sem); },
      };
    })(),

    // definido em 2026-10-15 (NOD-277): a espera da cota é leitura SQL (esperas-da-cota.repo.ts); em memória, nenhuma.
    esperasDaCota: {
      async doTrabalhos() {
        return new Map();
      },
      async livres() {
        return [];
      },
    },

    esperas: {
      async criar(e) {
        if (b.esperas.some((x) => x.tenantId === escopo.tenantId && x.turnoId === e.turnoId)) return null;
        const linha = { ...e, tenantId: escopo.tenantId, ownerId: escopo.pessoaId, id: randomUUID(), estado: "rodando" as const, codigoSaida: null, saida: null, motivoFim: null, quedas: 0, iniciadaEm: null, vistoEm: null, acordouEm: null, criadoEm: agora(), terminadoEm: null };
        b.esperas.push(linha);
        return semDonoEspera(linha);
      },
      async buscar(id) { const e = minhasEsperas().find((x) => x.id === id); return e ? semDonoEspera(e) : null; },
      async buscarTravado(id) { const e = minhasEsperas().find((x) => x.id === id); return e ? semDonoEspera(e) : null; },
      async doTurnoTravada(turnoId) { const e = minhasEsperas().find((x) => x.turnoId === turnoId); return e ? semDonoEspera(e) : null; },
      async paraAMaquina(maquinaId, quando) {
        return minhasEsperas().filter((x) => x.maquinaId === maquinaId && x.estado === "rodando").map((x) => { x.vistoEm = quando; return { id: x.id, comando: x.comando, pasta: x.pasta, iniciada: x.iniciadaEm !== null }; });
      },
      async marcarIniciada(id, quando) { const e = minhasEsperas().find((x) => x.id === id && x.estado === "rodando"); if (!e) return false; e.iniciadaEm ??= quando; e.vistoEm = quando; return true; },
      async gravarQuedas(id, quedas, quando) { const e = minhasEsperas().find((x) => x.id === id && x.estado === "rodando"); if (!e) return false; e.quedas = quedas; e.vistoEm = quando; return true; },
      async finalizar(id, f) {
        const e = minhasEsperas().find((x) => x.id === id && x.estado === "rodando");
        if (!e) return null;
        Object.assign(e, { estado: f.estado, codigoSaida: f.codigo ?? null, saida: f.saida ?? null, motivoFim: f.motivoFim ?? null, terminadoEm: f.agora });
        return semDonoEspera(e);
      },
      async marcarAcordou(id, quando) { const e = minhasEsperas().find((x) => x.id === id && x.acordouEm === null); if (!e) return false; e.acordouEm = quando; return true; },
      async cancelarRodando(alvo, motivoFim, quando) {
        const alvos = minhasEsperas().filter((x) => x.estado === "rodando" && ("conversaId" in alvo ? x.conversaId === alvo.conversaId : "trabalhoId" in alvo ? x.trabalhoId === alvo.trabalhoId : true));
        for (const e of alvos) Object.assign(e, { estado: "cancelada", motivoFim, terminadoEm: quando });
        return alvos.map((e) => ({ id: e.id, turnoId: e.turnoId }));
      },
      // O varredor das esperas sem notícia se prova no Postgres (tests/integration/esperar-comando.test.ts).
      async semNoticia() { return []; },
    },
    turnoCredenciais: {
      async gravar(c) {
        const i = b.credenciais.findIndex((x) => x.tenantId === escopo.tenantId && x.turnoId === c.turnoId);
        if (i >= 0 && b.credenciais[i]!.epoch > c.epoch) return;
        if (i >= 0) b.credenciais.splice(i, 1);
        b.credenciais.push({ ...c, falasSeq: 0, tenantId: escopo.tenantId, ownerId: escopo.pessoaId });
      },
      async buscar(turnoId) { return minhasCredenciais().find((x) => x.turnoId === turnoId) ?? null; },
      async buscarPorHash(hash) { return minhasCredenciais().find((x) => x.tokenHash.equals(hash)) ?? null; },
      async registrarFalas(turnoId, seq) { const c = minhasCredenciais().find((x) => x.turnoId === turnoId); if (c) c.falasSeq = Math.max(c.falasSeq, seq); },
      async apagar(turnoId) { b.credenciais = b.credenciais.filter((x) => !(x.tenantId === escopo.tenantId && x.ownerId === escopo.pessoaId && x.turnoId === turnoId)); },
      async quaisSobrevivem(ids) { return new Set(minhasCredenciais().filter((x) => ids.includes(x.turnoId) && x.sobreviveReinicio).map((x) => x.turnoId)); },
    },
    trabalhos: {
      async criar(n) {
        const linha: Trabalho & { ownerId: string } = {
          tenantId: escopo.tenantId,
          ownerId: escopo.pessoaId,
          id: n.id ?? randomUUID(),
          agenteId: n.agenteId,
          conversaId: n.conversaId,
          titulo: n.titulo,
          origem: n.origem,
          pedidoPorAgenteId: n.pedidoPorAgenteId ?? null,
          rotinaId: n.rotinaId ?? null,
          trabalhoMaeId: n.trabalhoMaeId ?? null,
          depoisDeTrabalhoId: n.depoisDeTrabalhoId ?? null,
          estado: n.estado ?? "na_fila",
          sessaoCli: n.sessaoCli ?? null,
          sessaoHarness: n.sessaoHarness ?? null,
          sessaoExecutor: n.sessaoCli ? (n.sessaoExecutor ?? null) : null,
          pasta: n.pasta ?? null,
          memoriaMb: null,
          custoUsd: null,
          pessoaEsperando: n.pessoaEsperando === true,
          forma: n.forma ?? "task",
          loteId: n.loteId ?? null,
          resumo: null,
          criadoEm: agora() + b.trabalhos.length / 1000,
          iniciadoEm: n.iniciadoEm ?? null,
          terminadoEm: null,
        };
        b.trabalhos.push(linha);
        return semDonoTrabalho(linha);
      },
      async buscar(id) {
        const t = doTenant(b.trabalhos).find((x) => x.id === id);
        return t ? semDonoTrabalho(t) : null;
      },
      async buscarTravado(id) {
        const t = doTenant(b.trabalhos).find((x) => x.id === id);
        return t ? semDonoTrabalho(t) : null;
      },
      async listar(p) {
        return doTenant(b.trabalhos)
          .filter((t) => (!p.agenteId || t.agenteId === p.agenteId) && (t.terminadoEm === null || t.terminadoEm >= p.terminadosDesde))
          .sort((x, y) => Number(x.terminadoEm !== null) - Number(y.terminadoEm !== null) || y.criadoEm - x.criadoEm)
          .map(semDonoTrabalho);
      },
      async abertosDoAgente(agenteId) {
        return doTenant(b.trabalhos).filter((t) => t.agenteId === agenteId && ["na_fila", "rodando", "precisa_de_voce", "fechado_ocioso"].includes(t.estado)).sort((x, y) => x.criadoEm - y.criadoEm).map(semDonoTrabalho);
      },
      async filhaAbertaDaRotina(rotinaId, colegaAntesDe = null) {
        // NOD-274 (C9): a frente 'rodando' sem turno vivo cujo único fato aberto é o colega pedido antes do prazo não segura.
        const soColegaAntigo = (w: Trabalho): boolean => {
          if (colegaAntesDe === null || w.estado !== "rodando") return false;
          const dele = doTenant(b.turnos).filter((t) => t.trabalhoId === w.id);
          const ids = new Set(dele.map((t) => t.id));
          if (dele.some((t) => t.estado === "pendente" || t.estado === "despachando")) return false;
          if (b.esperas.some((e) => e.tenantId === escopo.tenantId && e.trabalhoId === w.id && e.estado === "rodando")) return false;
          if (doTenant(b.decisoes).some((d) => d.turnoId !== null && ids.has(d.turnoId) && (d.estado === "pendente" || d.estado === "reaberta"))) return false;
          return doTenant(b.mensagens).some((h) => h.kind === "handoff" && h.turnoId !== null && ids.has(h.turnoId) && h.payload?.kind === "handoff" && Boolean(h.payload.tarefaId)
            && h.criadoEm < colegaAntesDe
            && !doTenant(b.mensagens).some((r) => r.conversaId === h.conversaId && r.payload?.kind === "peer_ask" && h.payload?.kind === "handoff" && r.payload.tarefaId === h.payload.tarefaId)
            && !doTenant(b.trabalhos).some((c) => h.payload?.kind === "handoff" && c.id === h.payload.trabalhoId && ["terminado", "parado", "falhou"].includes(c.estado)));
        };
        const t = doTenant(b.trabalhos).find((x) => x.rotinaId === rotinaId && (x.trabalhoMaeId !== null || x.forma === "frente") && ["na_fila", "rodando", "precisa_de_voce", "fechado_ocioso"].includes(x.estado) && !soColegaAntigo(x));
        return t ? semDonoTrabalho(t) : null;
      },
      async atividade(id) {
        const meus = doTenant(b.turnos).filter((t) => t.trabalhoId === id);
        const vivos = meus.filter((t) => t.estado === "pendente" || t.estado === "despachando").length;
        return { vivos, ultimaEm: meus.length ? Math.max(...meus.map((t) => t.criadoEm)) : null };
      },
      async filhos(maeId) {
        return doTenant(b.trabalhos).filter((t) => t.trabalhoMaeId === maeId).map(semDonoTrabalho);
      },
      async mudarEstado(id, estado, em, opcoes = {}) {
        const t = doTenant(b.trabalhos).find((x) => x.id === id && x.ownerId === escopo.pessoaId);
        if (!t) return null;
        const finais = ["terminado", "parado", "falhou"];
        if (finais.includes(t.estado) && !finais.includes(estado) && opcoes.reabrir !== true) return null;
        t.estado = estado;
        if (estado === "rodando" || estado === "precisa_de_voce") t.iniciadoEm ??= em;
        t.terminadoEm = estado === "terminado" || estado === "parado" || estado === "falhou" ? em : null;
        return semDonoTrabalho(t);
      },
      async atualizarSessao(id, sessaoCli, harness, executor = null, maquinaId = null) {
        const t = doTenant(b.trabalhos).find((x) => x.id === id && x.ownerId === escopo.pessoaId);
        if (!t) return false;
        t.sessaoCli = sessaoCli;
        t.sessaoHarness = harness;
        t.sessaoExecutor = executor;
        b.contaDaSessao.delete(`trabalho:${id}`);
        b.maquinaDaSessao.set(`trabalho:${id}`, maquinaId);
        return true;
      },
      async definirContaDaSessao(id, contaId) { b.contaDaSessao.set(`trabalho:${id}`, contaId); },
      async contaDaSessao(id) { return b.contaDaSessao.get(`trabalho:${id}`) ?? null;
      },
      async marcarCustoParcial(id) {
        const t = doTenant(b.trabalhos).find((x) => x.id === id && x.ownerId === escopo.pessoaId);
        if (t) t.custoParcial = true;
      },
      async maquinaDaSessao(id) { return b.maquinaDaSessao.get(`trabalho:${id}`) ?? null; },
      async largarSessao(id) {
        const t = doTenant(b.trabalhos).find((x) => x.id === id && x.ownerId === escopo.pessoaId);
        if (!t) return false;
        Object.assign(t, { sessaoCli: null, sessaoHarness: null, sessaoExecutor: null });
        b.contaDaSessao.delete(`trabalho:${id}`);
        b.maquinaDaSessao.delete(`trabalho:${id}`);
        return true;
      },
      async somarCusto(id, custoUsd) {
        const t = doTenant(b.trabalhos).find((x) => x.id === id && x.ownerId === escopo.pessoaId);
        if (!t) return false;
        t.custoUsd = (t.custoUsd ?? 0) + custoUsd;
        return true;
      },
      async atualizarMemoria(porTurno) {
        let n = 0;
        for (const p of porTurno) {
          const turno = doTenant(b.turnos).find((x) => x.id === p.turnoId);
          const t = turno?.trabalhoId ? doTenant(b.trabalhos).find((x) => x.id === turno.trabalhoId && x.ownerId === escopo.pessoaId) : undefined;
          const mb = Math.max(0, Math.round(p.mb));
          if (!t || t.memoriaMb === mb) continue;
          t.memoriaMb = mb;
          n += 1;
        }
        return n;
      },
      async travarEsperas() {
        // Em memória tudo roda em série: não há o que travar.
      },
      async marcarDepoisDe(id, depoisDeId) {
        const t = doTenant(b.trabalhos).find((x) => x.id === id && x.ownerId === escopo.pessoaId);
        if (!t) return null;
        t.depoisDeTrabalhoId = depoisDeId;
        return semDonoTrabalho(t);
      },
      async redeComSessao(conversaId, sessaoCli) {
        const t = doTenant(b.trabalhos).filter((x) => x.conversaId === conversaId && x.origem === "rede" && x.sessaoCli === sessaoCli).sort((x, y) => y.criadoEm - x.criadoEm)[0];
        return t ? semDonoTrabalho(t) : null;
      },
      async fatos(id) {
        const dele = doTenant(b.turnos).filter((t) => t.trabalhoId === id);
        const ids = new Set(dele.map((t) => t.id));
        const terminais = dele.filter((t) => (t.estado === "concluido" || t.estado === "interrompido") && t.motivoInterrupcao !== "absorvido").sort((x, y) => y.criadoEm - x.criadoEm);
        const ultimo = terminais[0];
        const depoisDe = doTenant(b.trabalhos).find((w) => w.id === id)?.depoisDeTrabalhoId ?? null;
        const dep = depoisDe ? doTenant(b.trabalhos).find((w) => w.id === depoisDe) : undefined;
        return {
          parando: dele.filter((t) => t.estado === "despachando" && t.pararSolicitadoEm !== null).length,
          despachando: dele.filter((t) => t.estado === "despachando" && t.pararSolicitadoEm === null).length,
          pendentes: dele.filter((t) => t.estado === "pendente" && (t.acordarEm ?? 0) <= agora()).length,
          aguardandoDespertar: dele.some((t) => t.estado === "pendente" && (t.acordarEm ?? 0) > agora()),
          aguardandoComando: b.esperas.some((e) => e.tenantId === escopo.tenantId && e.trabalhoId === id && e.estado === "rodando"),
          esperandoOutro: dep !== undefined && !["terminado", "parado", "falhou"].includes(dep.estado),
          decisaoPendente: doTenant(b.decisoes).some((d) => d.turnoId !== null && ids.has(d.turnoId) && (d.estado === "pendente" || d.estado === "reaberta") && (d.tipo !== "retomar_turno" || d.turnoId === ultimo?.id)),
          ...((() => {
            const pergunta = doTenant(b.decisoes).filter((d) => d.turnoId !== null && ids.has(d.turnoId) && d.tipo !== "retomar_turno").sort((x, y) => Date.parse(y.criadoEm) - Date.parse(x.criadoEm))[0];
            return pergunta && pergunta.estado === "vencida" && pergunta.turnoId === ultimo?.id ? { perguntaVencida: true } : {};
          })()),
          aguardandoColega: doTenant(b.mensagens).some((h) => h.kind === "handoff" && h.turnoId !== null && ids.has(h.turnoId) && h.payload?.kind === "handoff" && Boolean(h.payload.tarefaId)
            && !doTenant(b.mensagens).some((r) => r.conversaId === h.conversaId && r.payload?.kind === "peer_ask" && h.payload?.kind === "handoff" && r.payload.tarefaId === h.payload.tarefaId)
            && !doTenant(b.trabalhos).some((c) => h.payload?.kind === "handoff" && c.id === h.payload.trabalhoId && ["terminado", "parado", "falhou"].includes(c.estado))),
          ultimo:ultimo ? { estado: ultimo.estado, motivo: ultimo.motivoInterrupcao } : null,
        };
      },
      async extras(ids) {
        const saida = new Map<string, ExtrasTrabalho>();
        for (const id of ids) {
          const t = doTenant(b.trabalhos).find((x) => x.id === id);
          if (!t) continue;
          const turnos = doTenant(b.turnos).filter((x) => x.trabalhoId === id);
          const doTurno = new Set(turnos.map((x) => x.id));
          const falas = doTenant(b.mensagens).filter((m) => m.turnoId !== null && doTurno.has(m.turnoId) && m.kind === "texto" && m.autoria.autor_tipo === "agente");
          saida.set(id, {
            pedidoPorNome: doTenant(b.agentes).find((a) => a.id === t.pedidoPorAgenteId)?.nome ?? null,
            rotinaNome: doTenant(b.rotinas).find((r) => r.id === t.rotinaId)?.instrucao ?? null,
            ultimaFala: falas.at(-1)?.texto ?? null,
            turnoVivoId: turnos.find((x) => x.estado === "despachando")?.id ?? null,
            turnosAbertos: turnos.filter((x) => x.estado === "pendente" || x.estado === "despachando").map((x) => x.id),
            deFora: t.origem === "colega" || turnos.some((x) => b.contaminados.has(x.id) || x.entradaConfianca !== "confiavel"),
            // O tempo e o colega esperado se provam no Postgres (tests/integration/repos/trabalhos.test.ts).
            esperandoColega: null,
            trabalhouMs: 0,
            acordaEm: turnos.filter((x) => x.estado === "pendente" && x.acordarEm).map((x) => x.acordarEm!).sort((a, z) => a - z)[0] ?? null,
            // As esperas de comando (ADR-099) se provam no Postgres (tests/integration/esperar-comando.test.ts).
            esperandoComando: null,
            // O alvo pela chave viva (desta vez → bot → padrão) se prova no Postgres; aqui, só a máquina do bot.
            maquinaVivaId: turnos.find((x) => x.estado === "despachando")?.machineId ?? null,
            maquinaAlvoId: doTenant(b.agentes).find((a) => a.id === t.agenteId)?.maquinaId ?? null,
            pendente: (() => {
              const p = turnos.filter((x) => x.estado === "pendente").sort((a, z) => a.criadoEm - z.criadoEm)[0];
              return p ? { harness: p.harness ?? "auto", modelo: p.modelo } : null;
            })(),
          });
        }
        return saida;
      },
      // Os pedidos parados se provam no Postgres (tests/integration/pedidos-parados.test.ts); a memória não os vê.
      async pedidosAColegaParados() {
        return [];
      },
      // A limpeza (ADR-088) se prova no Postgres (tests/integration/limpeza-das-tasks.test.ts); a memória não a vê.
      async candidatosALimpeza() {
        return [];
      },
    },

    turnos: {
      // NOD-219: os órfãos se provam no Postgres (tests/integration/turnos-orfaos.test.ts) — a geração do agente vive na
      // tabela e no trigger da 0012, que a memória não tem.
      async orfaosCandidatos() {
        return [];
      },
      async encerrarOrfao() {
        return null;
      },
      async buscarPorMensagemOrigem(mensagemId: string) {
        return doTenant(b.turnos).filter((t) => t.mensagemOrigemId === mensagemId).sort((x, y) => x.criadoEm - y.criadoEm)[0] ?? null;
      },
      async buscarTravado(id: string) {
        return doTenant(b.turnos).find((t) => t.id === id) ?? null;
      },
      async travarRetomadas() {
        // Em memória tudo roda em série: não há o que travar.
      },
      async reescreverFundoDoBot(agenteId: string, para: { harness: NonNullable<Turno["harness"]>; modelo: string }) {
        const todos = doTenant(b.turnos);
        const raizDeFundo = (t: Turno): boolean => {
          let atual: Turno | undefined = t;
          for (let saltos = 0; atual && atual.origem === "retomada" && saltos < 50; saltos++) atual = todos.find((x) => x.id === atual?.retomaTurnoId);
          return atual !== undefined && atual !== t && ["rotina", "delegacao", "peer"].includes(atual.origem);
        };
        const alvo = todos.filter((t) => t.ownerId === escopo.pessoaId && t.agenteId === agenteId && t.estado === "pendente" && t.origem !== "ligacao"
          && (t.trabalhoId ?? null) === null && (["rotina", "delegacao", "peer"].includes(t.origem) || (t.origem === "retomada" && raizDeFundo(t))));
        for (const t of alvo) {
          t.harness = para.harness;
          t.modelo = para.modelo;
          b.contaDoTurno.delete(t.id);
          if (t.entradaTexto.startsWith(ENTRADA_DA_VOLTA_DA_COTA)) t.acordarEm = null;
        }
        return alvo.length;
      },
      async anteciparEsperasDaCota(ia: string | null, opcoes: { turnoId?: string; agenteId?: string } = {}) {
        const iaDe = (t: Turno): string | null => (t.harness ?? "auto") !== "auto" ? t.harness! : t.modelo === "auto" ? null : (iaDoModelo(t.modelo) ?? HARNESS_LEGADO);
        const alvo = doTenant(b.turnos).filter((t) => t.ownerId === escopo.pessoaId && t.estado === "pendente" && (t.acordarEm ?? null) !== null && t.entradaTexto.startsWith(ENTRADA_DA_VOLTA_DA_COTA)
          && (opcoes.turnoId === undefined || t.id === opcoes.turnoId) && (opcoes.agenteId === undefined || t.agenteId === opcoes.agenteId)
          && (ia === null || iaDe(t) === ia));
        for (const t of alvo) t.acordarEm = null;
        return alvo.map((t) => t.id);
      },
      async voltaDaCotaNaFila(trabalhoId: string) {
        return doTenant(b.turnos).filter((t) => t.ownerId === escopo.pessoaId && t.trabalhoId === trabalhoId && t.origem === "retomada" && t.estado === "pendente" && (t.acordarEm ?? null) !== null && t.entradaTexto.startsWith(ENTRADA_DA_VOLTA_DA_COTA))
          .sort((x, y) => x.criadoEm - y.criadoEm)[0] ?? null;
      },
      async retomadaNaFila(retomaTurnoId: string) {
        return doTenant(b.turnos).filter((t) => t.ownerId === escopo.pessoaId && t.retomaTurnoId === retomaTurnoId && t.origem === "retomada" && t.estado === "pendente" && (t.acordarEm ?? 0) <= agora()).sort((x, y) => y.criadoEm - x.criadoEm)[0] ?? null;
      },
      async marcarDespertar(id: string, em: number, motivo: string) {
        const t = doTenant(b.turnos).find((x) => x.id === id && x.ownerId === escopo.pessoaId && x.estado === "despachando" && x.pararSolicitadoEm === null);
        if (!t) return false;
        despertares.set(id, { em, motivo });
        return true;
      },
      async despertarDoTurno(id: string) {
        return despertares.get(id) ?? null;
      },
      async voltasMarcadas(retomaTurnoId: string) {
        return doTenant(b.turnos).filter((t) => t.retomaTurnoId === retomaTurnoId && t.acordarEm != null && !t.entradaTexto.startsWith(ENTRADA_DA_VOLTA_DA_COTA)).length;
      },
      async ultimasVoltas(retomaTurnoId: string, limite: number) {
        return doTenant(b.turnos)
          .filter((t) => t.retomaTurnoId === retomaTurnoId && t.acordarEm != null)
          .sort((x, y) => y.criadoEm - x.criadoEm)
          .slice(0, limite)
          .map((t) => ({
            estado: t.estado,
            marcouVolta: despertares.has(t.id) || b.esperas.some((e) => e.tenantId === escopo.tenantId && e.turnoId === t.id),
            perguntou: doTenant(b.decisoes).some((d) => d.turnoId === t.id),
            pediuAColega: doTenant(b.mensagens).some((m) => m.turnoId === t.id && m.kind === "handoff"),
            porCota: t.entradaTexto.startsWith(ENTRADA_DA_VOLTA_DA_COTA),
          }));
      },
      async contarTasksNaIa(agenteId, iaDe) {
        return new Set(tasksNaIa(agenteId, iaDe).map((t) => t.trabalhoId)).size;
      },
      async levarTasksDoBot(p) {
        const ids: string[] = [];
        for (const t of tasksNaIa(p.agenteId, p.iaDe)) {
          const daCota = t.entradaTexto.startsWith(ENTRADA_DA_VOLTA_DA_COTA);
          Object.assign(t, { harness: p.harness, modelo: p.modelo, ...(daCota ? { acordarEm: null, entradaTexto: p.entradaDaVolta } : {}) });
          ids.push(t.id);
        }
        return ids;
      },
      async trazerTasksDeVolta(p) {
        const ids: string[] = [];
        for (const t of doTenant(b.turnos).filter((x) => x.ownerId === escopo.pessoaId && x.agenteId === p.agenteId && x.estado === "pendente" && x.trabalhoId && x.harness === p.de)) {
          Object.assign(t, { harness: p.harness, modelo: p.modelo });
          ids.push(t.id);
        }
        return ids;
      },
      async acordarEsperasDaCota(agenteId, iaDe) {
        const alvo = tasksNaIa(agenteId, iaDe).filter((t) => t.acordarEm !== null && t.entradaTexto.startsWith(ENTRADA_DA_VOLTA_DA_COTA));
        for (const t of alvo) t.acordarEm = null;
        return alvo.length;
      },
      async juntarEntrada(id: string, texto: string, anexos: readonly string[] = []) {
        const t = doTenant(b.turnos).find((x) => x.id === id && x.ownerId === escopo.pessoaId && x.estado === "pendente");
        if (!t) return null;
        t.entradaTexto = `${t.entradaTexto}\n\n${texto}`;
        t.entradaAnexos = [...new Set([...t.entradaAnexos, ...anexos])];
        return t;
      },
      async raizDaCadeia(id: string) {
        let atual = doTenant(b.turnos).find((t) => t.id === id) ?? null;
        for (let saltos = 0; atual?.retomaTurnoId && saltos < 50; saltos++) atual = doTenant(b.turnos).find((t) => t.id === atual?.retomaTurnoId) ?? atual;
        return atual;
      },
      async liberarComputador(raizId: string) {
        if (!doTenant(b.turnos).some((t) => t.id === raizId && t.ownerId === escopo.pessoaId)) return false;
        b.computadorLiberado.add(raizId);
        return true;
      },
      async computadorLiberado(raizId: string) {
        return b.computadorLiberado.has(raizId);
      },
      async liberarTerminal(raizId: string) {
        if (!doTenant(b.turnos).some((t) => t.id === raizId && t.ownerId === escopo.pessoaId)) return false;
        b.terminalLiberado.add(raizId);
        return true;
      },
      async terminalLiberado(raizId: string) {
        return b.terminalLiberado.has(raizId);
      },
      async contaminar(id: string) {
        if (!doTenant(b.turnos).some((t) => t.id === id && t.ownerId === escopo.pessoaId)) return false;
        b.contaminados.add(id);
        return true;
      },
      async contaminado(id: string) {
        return b.contaminados.has(id);
      },
      // ADR-066: os repositórios em memória não guardam sessão do CLI — a retomada de rotina/delegação começa nova.
      async sessaoDoTurno() {
        return null;
      },
      async largarSessao() {
        return false;
      },
      async registrarExecutor(id, executor) {
        const t = doTenant(b.turnos).find((x) => x.id === id);
        if (t) t.executor = executor;
      },
      async registrarConta(id, contaId) { b.contaDoTurno.set(id, contaId); },
      async contaDoTurno(id) { return b.contaDoTurno.get(id) ?? null; },
      async registrarIa(id, harness, contaId) { b.harnessEfetivo.set(id, harness); b.contaDoTurno.set(id, contaId); },
      async enfileirar(t) {
        const turno: Turno = {
          tenantId: escopo.tenantId,
          id: t.id ?? randomUUID(),
          conversaId: t.conversaId,
          agenteId: t.agenteId,
          ownerId: escopo.pessoaId,
          origem: t.origem,
          estado: t.interrompidoCom ? "interrompido" : "pendente",
          sinais: { attempted: false, rejected: false, promptSubmitted: false, producedOutput: false },
          machineId: null,
          leaseAte: null,
          prazoEm: t.prazoEm,
          motivoInterrupcao: t.interrompidoCom ?? null,
          motivoFalha: null,
          semNovidadeMotivo: null,
          retomaTurnoId: t.retomaTurnoId ?? null,
          profundidade: t.profundidade,
          reenvios: t.reenvios ?? 0,
          pararSolicitadoEm: null,
          entradaTexto: t.entradaTexto,
          entradaAnexos: [...(t.entradaAnexos ?? [])],
          entradaConfianca: t.entradaConfianca,
          custoUsd: null,
          modelo: t.modelo,
          harness: t.harness ?? "auto",
          executor: t.executor,
          criadoEm: agora() + b.turnos.length / 1000,
          mensagemOrigemId: t.mensagemOrigemId ?? null,
          absorvidoPor: null,
          sobProcuracaoDe: t.sobProcuracaoDe ?? null,
          // Auditoria A3 (2026-10-15): o turno-cérebro guarda a ligação, como a coluna `ligacao_id` do repo real.
          ligacaoId: t.ligacaoId ?? null,
          // A retomada herda o trabalho do turno que continua, como o INSERT do repo real.
          trabalhoId: t.trabalhoId !== undefined ? t.trabalhoId : t.retomaTurnoId ? (doTenant(b.turnos).find((r) => r.id === t.retomaTurnoId)?.trabalhoId ?? null) : null,
          acordarEm: t.acordarEm ?? null,
          pessoaEsperando: t.pessoaEsperando === true,
        };
        b.turnos.push(turno);
        if (t.maquinaDestaVez) b.maquinaDestaVez.set(turno.id, t.maquinaDestaVez);
        // NOD-287: a marca da web do turno de origem nasce junto, como o INSERT do repo real.
        if (t.contaminadoDe && b.contaminados.has(t.contaminadoDe)) b.contaminados.add(turno.id);
        return turno;
      },
      async buscar(id) {
        return doTenant(b.turnos).find((t) => t.id === id) ?? null;
      },
      async reivindicar(p) {
        const cota = p.cota;
        const fimDaFila = (t: Turno) => ["rotina", "delegacao", "peer"].includes(t.origem) || ["rotina", "colega"].includes(doTenant(b.trabalhos).find((x) => x.id === t.trabalhoId)?.origem ?? "");
        const vivos = doTenant(b.turnos);
        const candidatos = vivos
          .filter((t) => t.ownerId === escopo.pessoaId && t.estado === "pendente" && (t.acordarEm ?? 0) <= p.agora)
          // ADR-083: a faixa é o trabalho ou, sem ele, a conversa; o trabalho espera o de que depende.
          .filter((t) => {
            // ADR-099 §7 / NOD-253: o portão da cota (seguradoPelaCotaSql).
            if (cota && seguradoPelaCota(t, cota)) return false;
            if (!t.trabalhoId) return !vivos.some((d) => d.estado === "despachando" && !d.trabalhoId && d.conversaId === t.conversaId && d.origem !== "ligacao");
            if (vivos.some((d) => d.estado === "despachando" && d.trabalhoId === t.trabalhoId)) return false;
            const dono = doTenant(b.trabalhos).find((x) => x.id === t.trabalhoId);
            const dep = dono?.depoisDeTrabalhoId ? doTenant(b.trabalhos).find((x) => x.id === dono.depoisDeTrabalhoId) : null;
            if (dep && !["terminado", "parado", "falhou"].includes(dep.estado)) return false;
            // ADR-085: a mesma regra do SQL (seguravelPeloMac; o espaço segura também o que passou da espera máxima).
            if (dono && p.espacarFundo === true && seguravelPeloMac({ ...dono, criadoEm: p.agora }, p.agora)) return false;
            // #219: disco crítico — nenhum trabalho novo, nem a volta marcada (que só ele segura, revisão do #224);
            // memória crítica — o segundo plano novo sem prazo.
            if (p.segurarNovo === true && (t.acordarEm || (dono && dono.iniciadoEm === null))) return false;
            return !(dono && p.segurarFundo === true && seguravelPeloMac(p.fundoSemPrazo === true ? { ...dono, criadoEm: p.agora } : dono, p.agora));
          })
          .sort((x, y) => Number(fimDaFila(x)) - Number(fimDaFila(y)) || x.criadoEm - y.criadoEm);
        const t = candidatos[0];
        if (!t) return null;
        t.estado = "despachando";
        t.despachadoEm = p.agora; // NOD-276 (J3)
        t.machineId = p.machineId;
        t.leaseAte = p.agora + LEASE_MS;
        t.sinais = { ...t.sinais, attempted: true };
        return t;
      },
      // NOD-302: a regra de seguradoPelaCotaSql (o fake não aplica a máquina-alvo, como no reivindicar).
      async seguradosPelaCota(p) {
        return doTenant(b.turnos)
          .filter((t) => t.ownerId === escopo.pessoaId && t.estado === "pendente" && (t.acordarEm ?? 0) <= p.agora && t.origem !== "ligacao")
          .filter((t) => seguradoPelaCota(t, p.cota))
          .sort((x, y) => x.criadoEm - y.criadoEm)
          .slice(0, p.limite ?? 200);
      },
      async pedidosNaFila(p = {}) {
        return doTenant(b.turnos)
          .filter((t) => t.ownerId === escopo.pessoaId && t.estado === "pendente" && !t.trabalhoId && (t.origem === "delegacao" || t.origem === "peer") && (!p.agenteId || t.agenteId === p.agenteId))
          .sort((x, y) => x.criadoEm - y.criadoEm)
          .slice(0, p.limite ?? 100);
      },
      async renovarLease(id, machineId, sinais, em, o = {}) {
        const t = doTenant(b.turnos).find((x) => x.id === id && x.machineId === machineId);
        if (!t) return { ativo: false, motivo: "lease_vencido" as const };
        // NOD-214: como o repo real — lease vencido só passa na adoção dentro da carência (a sessão do turno não é modelada aqui).
        if (!((t.leaseAte ?? 0) > em || (o.aceitaVencido === true && t.estado === "despachando"))) return { ativo: false, motivo: "lease_vencido" as const };
        t.sinais = {
          attempted: t.sinais.attempted || !!sinais.attempted,
          rejected: t.sinais.rejected || !!sinais.rejected,
          promptSubmitted: t.sinais.promptSubmitted || !!sinais.promptSubmitted,
          producedOutput: t.sinais.producedOutput || !!sinais.producedOutput,
        };
        const ativo = t.estado === "despachando" && t.pararSolicitadoEm === null;
        if (ativo) t.leaseAte = em + LEASE_MS;
        return ativo ? { ativo } : { ativo, motivo: "parado" as const };
      },
      async marcarSinal(id, sinal) {
        const t = doTenant(b.turnos).find((x) => x.id === id);
        if (!t) return false;
        t.sinais = { ...t.sinais, [sinal]: true };
        return true;
      },
      async marcarSemNovidade(id, motivo) {
        const t = doTenant(b.turnos).find((x) => x.id === id);
        if (!t) return false;
        // coalesce: a primeira chamada prevalece, como o UPDATE do repo real.
        t.semNovidadeMotivo = t.semNovidadeMotivo ?? motivo;
        return true;
      },
      async assentar(id, a) {
        const t = doTenant(b.turnos).find((x) => x.id === id && (x.estado === "pendente" || x.estado === "despachando"));
        if (!t) return null;
        t.estado = a.estado;
        t.motivoInterrupcao = a.estado === "interrompido" ? (a.motivoInterrupcao ?? "sem_progresso") : null;
        t.motivoFalha = a.motivoFalha ?? null;
        t.sinais = {
          attempted: t.sinais.attempted || !!a.sinais?.attempted,
          rejected: t.sinais.rejected || !!a.sinais?.rejected,
          promptSubmitted: t.sinais.promptSubmitted || !!a.sinais?.promptSubmitted,
          producedOutput: t.sinais.producedOutput || !!a.sinais?.producedOutput,
        };
        if (a.custoUsd !== undefined && a.custoUsd !== null) t.custoUsd = a.custoUsd;
        if (a.sessaoCli && a.custoSessaoUsd !== undefined && a.custoSessaoUsd !== null) b.custoSessao.set(id, { sessaoCli: a.sessaoCli, total: a.custoSessaoUsd });
        t.leaseAte = null;
        return t;
      },
      async totalAnteriorDaSessao(sessaoCli, turnoId) {
        const totais = [...b.custoSessao].filter(([id, c]) => id !== turnoId && c.sessaoCli === sessaoCli && doTenant(b.turnos).some((t) => t.id === id)).map(([, c]) => c.total);
        if (totais.length > 0) return Math.max(...totais);
        // NOD-291: a cópia da sessão desconta o total da mãe até o instante em que saiu dela.
        const origem = b.sessaoOrigem.get(turnoId);
        const filho = doTenant(b.turnos).find((t) => t.id === turnoId);
        if (!origem || origem === sessaoCli || !filho) return null;
        const daMae = [...b.custoSessao]
          .filter(([id, c]) => id !== turnoId && c.sessaoCli === origem && doTenant(b.turnos).some((t) => t.id === id && t.criadoEm < filho.criadoEm))
          .map(([, c]) => c.total);
        return daMae.length === 0 ? null : Math.max(...daMae);
      },
      async registrarSessaoOrigem(id, sessaoCli) {
        if (doTenant(b.turnos).some((t) => t.id === id)) b.sessaoOrigem.set(id, sessaoCli);
      },
      async concluirTardia(id, a) {
        const t = doTenant(b.turnos).find((x) => x.id === id && x.estado === "interrompido" && (x.motivoInterrupcao === "maquina_sem_contato" || x.motivoInterrupcao === "reinicio_servidor"));
        if (!t || doTenant(b.turnos).some((r) => r.retomaTurnoId === id)) return null;
        t.estado = "concluido";
        t.motivoInterrupcao = null;
        t.motivoFalha = null;
        t.sinais = {
          attempted: t.sinais.attempted || !!a.sinais?.attempted,
          rejected: t.sinais.rejected || !!a.sinais?.rejected,
          promptSubmitted: t.sinais.promptSubmitted || !!a.sinais?.promptSubmitted,
          producedOutput: t.sinais.producedOutput || !!a.sinais?.producedOutput,
        };
        if (a.custoUsd !== undefined && a.custoUsd !== null) t.custoUsd = a.custoUsd;
        t.leaseAte = null;
        return t;
      },
      async temRetomada(retomaTurnoId) {
        return doTenant(b.turnos).some((r) => r.retomaTurnoId === retomaTurnoId);
      },
      async interromper(id, motivo, o = {}) {
        const t = doTenant(b.turnos).find((x) => x.id === id && (x.estado === "pendente" || x.estado === "despachando"));
        if (!t) return null;
        // NOD-241: a guarda do varredor, como o UPDATE do repo real (o lease renovado no meio não é interrompido).
        if (o.leaseVencidoEm !== undefined && t.leaseAte !== null && t.leaseAte >= o.leaseVencidoEm) return null;
        t.estado = "interrompido";
        t.motivoInterrupcao = motivo;
        t.leaseAte = null;
        return t;
      },
      async delegacoesPendentesDoAgente(agenteId, limite = 20) {
        return doTenant(b.turnos).filter((t) => t.agenteId === agenteId && t.origem === "delegacao" && t.estado === "pendente").sort((x, y) => x.criadoEm - y.criadoEm || x.id.localeCompare(y.id)).slice(0, limite);
      },
      async absorverDelegacao(id, porTurnoId) {
        const t = doTenant(b.turnos).find((x) => x.id === id && x.origem === "delegacao" && x.estado === "pendente");
        if (!t) return null;
        t.estado = "interrompido";
        t.motivoInterrupcao = "absorvido";
        t.absorvidoPor = porTurnoId;
        t.leaseAte = null;
        return t;
      },
      async absorverPendentes(turno, entrada) {
        if (!turno.mensagemOrigemId || (turno.origem !== "conversa" && turno.origem !== "sala")) return { turno, absorvidos: [] };
        const absorvidos = doTenant(b.turnos)
          .filter((t) => t.id !== turno.id && t.conversaId === turno.conversaId && t.agenteId === turno.agenteId && t.estado === "pendente" && (t.origem === "conversa" || t.origem === "sala") && t.mensagemOrigemId && (t.trabalhoId ?? null) === (turno.trabalhoId ?? null))
          .sort((x, y) => x.criadoEm - y.criadoEm);
        for (const t of absorvidos) {
          t.estado = "interrompido";
          t.motivoInterrupcao = "absorvido";
          t.absorvidoPor = turno.id;
          t.leaseAte = null;
        }
        if (absorvidos.length === 0) return { turno, absorvidos };
        const alvo = doTenant(b.turnos).find((t) => t.id === turno.id) ?? turno;
        alvo.entradaTexto = entrada([turno.entradaTexto, ...absorvidos.map((a) => a.entradaTexto)]);
        alvo.entradaAnexos = [...new Set([...turno.entradaAnexos, ...absorvidos.flatMap((a) => a.entradaAnexos)])];
        return { turno: alvo, absorvidos };
      },
      async absorverNaSessao(turno, ids) {
        // NOD-286: como o SQL — fora de trabalho, e só até a primeira fala pendente com anexo do mesmo escopo.
        const escopoDaFala = doTenant(b.turnos).filter((t) => t.id !== turno.id && t.ownerId === escopo.pessoaId && t.conversaId === turno.conversaId && t.agenteId === turno.agenteId && t.estado === "pendente" && t.origem === "conversa" && t.mensagemOrigemId && !t.trabalhoId);
        const absorvidos = ateOPrimeiroAnexo(escopoDaFala).filter((t) => !ids || ids.includes(t.id));
        for (const t of absorvidos) {
          t.estado = "interrompido";
          t.motivoInterrupcao = "absorvido";
          t.absorvidoPor = turno.id;
          t.leaseAte = null;
        }
        return absorvidos;
      },
      async absorverDoTrabalho(turno, ids) {
        if (!turno.trabalhoId || (ids && ids.length === 0)) return [];
        const daFaixa = doTenant(b.turnos).filter((t) => t.id !== turno.id && t.ownerId === escopo.pessoaId && t.trabalhoId === turno.trabalhoId && t.estado === "pendente" && t.mensagemOrigemId);
        const absorvidos = ateOPrimeiroAnexo(daFaixa).filter((t) => !ids || ids.includes(t.id));
        for (const t of absorvidos) {
          t.estado = "interrompido";
          t.motivoInterrupcao = "absorvido";
          t.absorvidoPor = turno.id;
          t.leaseAte = null;
        }
        return absorvidos;
      },
      // ADR-090: o fake não guarda nem aplica a máquina do turno (o reivindicar dele ignora onde o bot trabalha); a regra é
      // coberta só por tests/integration/maquina-do-bot.test.ts, contra o Postgres.
      async rodarDestaVez(conversaId, maquinaId) {
        const ts = doTenant(b.turnos).filter((t) => t.conversaId === conversaId && t.ownerId === escopo.pessoaId && t.estado === "pendente");
        for (const t of ts) b.maquinaDestaVez.set(t.id, maquinaId);
        return ts.length;
      },
      async anteciparEsperasDoLimite(p) {
        let n = 0;
        const ts = doTenant(b.turnos).filter((t) => t.ownerId === escopo.pessoaId);
        for (const t of ts) {
          if (t.estado !== "pendente" || (t.acordarEm ?? null) === null || t.acordarEm! <= p.agora || !(t.harness === p.ia || (t.harness ?? "auto") === "auto")) continue;
          const de = ts.some((x) => x.conversaId === t.conversaId && x.agenteId === t.agenteId && x.estado === "interrompido" && (x.motivoFalha === "limite_do_plano" || x.motivoFalha === "sem_conta")
            && (x.id === t.retomaTurnoId || (t.retomaTurnoId !== null && x.retomaTurnoId === t.retomaTurnoId) || (!!t.mensagemOrigemId && x.mensagemOrigemId === t.mensagemOrigemId)));
          if (!de) continue;
          t.acordarEm = p.agora;
          n += 1;
        }
        return n;
      },
      async cancelarPendente(id) {
        const t = doTenant(b.turnos).find((x) => x.id === id && x.estado === "pendente");
        if (!t) return null;
        t.estado = "interrompido";
        t.motivoInterrupcao = "parado_pela_pessoa";
        t.leaseAte = null;
        return t;
      },
      async pedirInterrupcao(ids, em) {
        let n = 0;
        for (const t of doTenant(b.turnos)) {
          if (ids.includes(t.id) && t.estado === "despachando") {
            t.pararSolicitadoEm ??= em;
            n += 1;
          }
        }
        return n;
      },
      async vencidos(em) {
        return doTenant(b.turnos).filter((t) => t.ownerId === escopo.pessoaId && t.estado === "despachando" && t.leaseAte !== null && t.leaseAte < em);
      },
      async despachandoDaPessoa() {
        return doTenant(b.turnos).filter((t) => t.ownerId === escopo.pessoaId && t.estado === "despachando");
      },
      async pendentesDaPessoa(conversaId) {
        return doTenant(b.turnos).filter((t) => t.ownerId === escopo.pessoaId && t.estado === "pendente" && (!conversaId || t.conversaId === conversaId)).sort(porChegada);
      },
      async vivosDaConversa(conversaId) {
        return doTenant(b.turnos).filter((t) => t.conversaId === conversaId && (t.estado === "pendente" || t.estado === "despachando") && (t.acordarEm ?? 0) <= agora());
      },
      async pendentesRenderizaveis(conversaId) {
        const todos = doTenant(b.turnos);
        const saida: { id: string; motivo: "agente_ocupado_em"; conversaId: string }[] = [];
        for (const p of todos.filter((t) => t.conversaId === conversaId && t.estado === "pendente" && !t.trabalhoId && (t.acordarEm ?? 0) <= agora())) {
          const daConversa = todos.filter((d) => d.estado === "despachando" && !d.trabalhoId && d.conversaId === conversaId);
          const ocupado = daConversa.find((d) => d.agenteId === p.agenteId) ?? daConversa[0];
          if (ocupado) saida.push({ id: p.id, motivo: "agente_ocupado_em", conversaId: ocupado.conversaId });
        }
        return saida;
      },
      async registrarEntrega(turnoId, seqLocal) {
        const chave = `${escopo.tenantId}:${turnoId}:${seqLocal}`;
        if (b.entregas.has(chave)) return false;
        b.entregas.add(chave);
        return true;
      },
      async concluidosPorConversa(conversaIds) {
        const saida = new Map<string, number>();
        for (const id of conversaIds) {
          const n = doTenant(b.turnos).filter((t) => t.conversaId === id && t.estado === "concluido").length;
          if (n > 0) saida.set(id, n);
        }
        return saida;
      },
      async custoPorAgente(janelas) {
        // NOD-273: espelha o SQL — soma `gastos` pelo instante do gasto (`em`), com tokens e a marca de sem custo.
        const somas = new Map<string, { agenteId: string; janela: number; usd: number; tokens: number; semCusto: boolean }>();
        for (const g of doTenant(b.gastos)) {
          if (g.ownerId !== escopo.pessoaId) continue;
          const t = doTenant(b.turnos).find((x) => x.id === g.turnoId);
          if (!t) continue;
          janelas.forEach((j, janela) => {
            if (g.em < j.inicio || g.em >= j.fim) return;
            const chave = `${t.agenteId}:${janela}`;
            const atual = somas.get(chave) ?? { agenteId: t.agenteId, janela, usd: 0, tokens: 0, semCusto: false };
            const tokens = g.tokensEntrada + g.tokensSaida;
            atual.usd += g.custoUsd ?? 0;
            atual.tokens += tokens;
            atual.semCusto ||= g.custoUsd === null && tokens > 0;
            somas.set(chave, atual);
          });
        }
        return [...somas.values()];
      },
      async barradosPorFaltaDeIa(desde) {
        const meus = doTenant(b.turnos);
        return meus
          .filter((t) => t.ownerId === escopo.pessoaId && t.origem === "conversa" && !t.trabalhoId && t.estado === "interrompido" && t.motivoInterrupcao === "executor_indisponivel" && t.motivoFalha !== "sem_conta" && t.motivoFalha !== "limite_do_plano" && t.criadoEm >= desde)
          .filter((t) => !meus.some((n) => n.conversaId === t.conversaId && n.criadoEm > t.criadoEm))
          .sort((x, y) => x.criadoEm - y.criadoEm);
      },
      async travarAbertosDoTrabalho(trabalhoId: string) {
        return doTenant(b.turnos).filter((t) => t.trabalhoId === trabalhoId && (t.estado === "pendente" || t.estado === "despachando")).sort((x, y) => x.criadoEm - y.criadoEm);
      },
      async doTrabalho(trabalhoId) {
        return doTenant(b.turnos).filter((t) => t.trabalhoId === trabalhoId).sort((x, y) => x.criadoEm - y.criadoEm);
      },
      async vincularTrabalho(id, trabalhoId) {
        const t = doTenant(b.turnos).find((x) => x.id === id && x.ownerId === escopo.pessoaId && !x.trabalhoId && x.estado === "despachando");
        if (!t) return null;
        t.trabalhoId = trabalhoId;
        return t;
      },
      async listarDaConversa(conversaId, limite = 50) {
        const todos = doTenant(b.turnos).filter((t) => t.conversaId === conversaId).sort((x, y) => x.criadoEm - y.criadoEm);
        return todos.slice(Math.max(0, todos.length - limite));
      },
    },

    decisoes: {
      async criar(d) {
        const em = agora();
        const decisao = {
          tenantId: escopo.tenantId,
          id: d.id ?? randomUUID(),
          ownerId: escopo.pessoaId,
          decisorId: d.decisorId ?? escopo.pessoaId,
          agenteId: d.agenteId,
          conversaId: d.conversaId,
          turnoId: d.turnoId ?? null,
          tipo: d.tipo,
          estado: "pendente" as const,
          prazoDecisaoEm: iso(d.prazoDecisaoEm),
          prazoExecucaoEm: d.prazoExecucaoEm === null || d.prazoExecucaoEm === undefined ? null : iso(d.prazoExecucaoEm),
          frase: d.frase,
          desfecho: null,
          vistaEm: null,
          criadoEm: iso(em + b.decisoes.length),
          decididaEm: null,
          fioId: d.fioId ?? null,
        };
        b.decisoes.push(decisao);
        return decisao;
      },
      async buscar(id) {
        return doTenant(b.decisoes).find((d) => d.id === id) ?? null;
      },
      async doTurno(turnoId) {
        return doTenant(b.decisoes).filter((d) => d.turnoId === turnoId).sort((x, y) => Date.parse(x.criadoEm) - Date.parse(y.criadoEm));
      },
      async dosFios(ids) {
        const alvo = new Set(ids);
        return doTenant(b.decisoes).filter((d) => alvo.has(d.id) || (d.fioId !== null && alvo.has(d.fioId))).sort((x, y) => Date.parse(x.criadoEm) - Date.parse(y.criadoEm));
      },
      async listarSuaVez(em) {
        return doTenant(b.decisoes)
          .filter((d) => d.decisorId === escopo.pessoaId)
          .filter((d) => d.estado === "pendente" || d.estado === "reaberta" || (d.estado === "vencida" && Date.parse(d.prazoDecisaoEm) >= em - 7 * 24 * 60 * 60 * 1000))
          .sort((x, y) => Date.parse(x.criadoEm) - Date.parse(y.criadoEm))
          .map((d) => ({ ...d, agenteNome: b.agentes.find((a) => a.id === d.agenteId)?.nome ?? "agente", trabalhoId: b.turnos.find((t) => t.id === d.turnoId)?.trabalhoId ?? null }));
      },
      async abertasDoTrabalho(trabalhoId) {
        const turnos = new Set(doTenant(b.turnos).filter((t) => t.trabalhoId === trabalhoId).map((t) => t.id));
        return doTenant(b.decisoes).filter((d) => d.turnoId !== null && turnos.has(d.turnoId) && (d.estado === "pendente" || d.estado === "reaberta"));
      },
      async pendentesDaConversa(conversaId) {
        return doTenant(b.decisoes).filter((d) => d.conversaId === conversaId && (d.estado === "pendente" || d.estado === "reaberta"));
      },
      async marcarVista(id, em) {
        const d = doTenant(b.decisoes).find((x) => x.id === id);
        if (!d) return false;
        d.vistaEm ??= iso(em);
        return true;
      },
      async reivindicarContinuacao(id, por) {
        if (!doTenant(b.decisoes).some((x) => x.id === id)) return null;
        if (!b.continuacoes.has(id)) {
          b.continuacoes.set(id, por);
          return "minha";
        }
        return b.continuacoes.get(id) ?? null;
      },
      async aContinuarDoTurno(turnoId) {
        return doTenant(b.decisoes).filter((d) => d.turnoId === turnoId && d.tipo === "aprovacao" && d.estado === "decidida" && !b.continuacoes.has(d.id)).sort((x, y) => (x.decididaEm ?? 0) - (y.decididaEm ?? 0));
      },
      async decidir(id, p) {
        const d = doTenant(b.decisoes).find((x) => x.id === id && (x.estado === "pendente" || x.estado === "reaberta"));
        if (!d) return null;
        d.estado = "decidida";
        d.desfecho = { tipo: "decidida", por: p.por, em: iso(p.agora) };
        d.decididaEm = p.agora;
        return d;
      },
      async dispensar(id, p) {
        const d = doTenant(b.decisoes).find((x) => x.id === id && x.estado === p.antes && (x.estado === "vencida" || (TIPOS_DISPENSAVEIS_ABERTOS as readonly string[]).includes(x.tipo)));
        if (!d) return null;
        d.estado = "decidida";
        d.desfecho = { tipo: "dispensada", por: p.por, em: iso(p.agora), antes: p.antes };
        d.decididaEm = p.agora;
        return d;
      },
      async reabrir(id, prazoDecisaoEm) {
        const d = doTenant(b.decisoes).find((x) => x.id === id && x.estado === "vencida");
        if (!d) return null;
        d.estado = "reaberta";
        d.prazoDecisaoEm = iso(prazoDecisaoEm);
        d.desfecho = null;
        return d;
      },
      async vencerPendentes(em) {
        const vencidas: Decisao[] = [];
        for (const d of doTenant(b.decisoes)) {
          if ((d.estado === "pendente" || d.estado === "reaberta") && Date.parse(d.prazoDecisaoEm) <= em) {
            d.estado = "vencida";
            d.desfecho = { tipo: d.vistaEm === null ? "expirou_sem_ninguem_ver" : "expirou_com_alguem_ciente", em: iso(em) };
            vencidas.push(d);
          }
        }
        return vencidas;
      },
      async marcarVarrida(id, tipoDeEvento) {
        const chave = `${escopo.tenantId}:${id}:${tipoDeEvento}`;
        if (b.varridos.has(chave)) return false;
        b.varridos.add(chave);
        return true;
      },
      async fecharPorRegra(id, p) {
        const d = doTenant(b.decisoes).find((x) => x.id === id && (x.estado === "pendente" || x.estado === "reaberta" || (p.tambemVencida === true && x.estado === "vencida")));
        if (!d) return null;
        d.estado = "decidida";
        d.desfecho = { tipo: "decidida_por_regra", regra: p.regra, regraVersao: p.regraVersao, em: new Date(p.agora).toISOString() };
        d.decididaEm = p.agora;
        return d;
      },
      async fecharRetomarAnteriores(trabalhoId, turnoIdAtual, p) {
        const atual = doTenant(b.turnos).find((t) => t.id === turnoIdAtual);
        if (!atual) return [];
        const anteriores = new Set(doTenant(b.turnos).filter((t) => t.trabalhoId === trabalhoId && t.id !== atual.id && (t.criadoEm < atual.criadoEm || (t.criadoEm === atual.criadoEm && t.id < atual.id))).map((t) => t.id));
        const fechadas: Decisao[] = [];
        for (const d of doTenant(b.decisoes)) {
          if (d.tipo !== "retomar_turno" || (d.estado !== "pendente" && d.estado !== "reaberta") || d.turnoId === null || !anteriores.has(d.turnoId)) continue;
          d.estado = "decidida";
          d.desfecho = { tipo: "decidida_por_regra", regra: p.regra, regraVersao: p.regraVersao, em: new Date(p.agora).toISOString() };
          d.decididaEm = p.agora;
          fechadas.push(d);
        }
        return fechadas;
      },

      async ultimaDecisaoEm() {
        const ems = doTenant(b.decisoes).filter((d) => d.decisorId === escopo.pessoaId && d.decididaEm !== null).map((d) => d.decididaEm as number);
        return ems.length === 0 ? null : iso(Math.max(...ems));
      },
    },

    itensAprovacao: {
      async criarLote(decisaoId, itens) {
        const criados: ItemAprovacao[] = [];
        for (const i of itens) {
          const item: ItemAprovacao = {
            tenantId: escopo.tenantId,
            id: i.id ?? randomUUID(),
            decisaoId,
            idx: i.idx,
            textoOriginal: i.texto,
            textoFinal: i.texto,
            destino: i.destino,
            selecionado: !i.origemSensivel,
            origemSensivel: i.origemSensivel,
            justificativa: i.justificativa ?? null,
            marcadoPor: null,
            marcadoEm: null,
            editadoPor: null,
            desfecho: i.desfecho ?? null,
            motivoManual: i.motivoManual ?? null,
          };
          b.itens.push(item);
          criados.push(item);
        }
        return criados;
      },
      async listar(decisaoId) {
        return doTenant(b.itens).filter((i) => i.decisaoId === decisaoId).sort((x, y) => x.idx - y.idx);
      },
      async comandoAprovadoNaCadeia(turnoId, comando) {
        const cadeia = new Set<string>();
        let atual = doTenant(b.turnos).find((t) => t.id === turnoId) ?? null;
        for (let saltos = 0; atual && saltos < 50; saltos++) {
          cadeia.add(atual.id);
          atual = atual.retomaTurnoId ? doTenant(b.turnos).find((t) => t.id === atual?.retomaTurnoId) ?? null : null;
        }
        const decisoes = new Set(doTenant(b.decisoes).filter((d) => d.turnoId !== null && cadeia.has(d.turnoId)).map((d) => d.id));
        return doTenant(b.itens).some((i) => decisoes.has(i.decisaoId) && i.destino.conector === "terminal" && i.destino.argumentos.comando === comando && i.selecionado && i.desfecho === "executado");
      },
      async pendentesNaMaquina() {
        return doTenant(b.itens).flatMap((item) => {
          const d = doTenant(b.decisoes).find((x) => x.id === item.decisaoId);
          if (!d || d.estado !== "decidida" || !item.selecionado || item.desfecho !== null || item.destino.execucao !== "maquina") return [];
          return [{ item, decididaEm: d.desfecho ? Date.parse(d.desfecho.em) : 0, porRegra: d.desfecho?.tipo === "decidida_por_regra" }];
        });
      },
      async registrarDesfechoSeAberto(id, desfecho) {
        const i = doTenant(b.itens).find((x) => x.id === id && x.desfecho === null);
        if (!i) return null;
        i.desfecho = desfecho;
        return i;
      },
      async buscar(id) {
        return doTenant(b.itens).find((i) => i.id === id) ?? null;
      },
      async marcar(id, p) {
        const i = doTenant(b.itens).find((x) => x.id === id);
        if (!i) return null;
        i.selecionado = p.selecionado;
        i.marcadoPor = escopo.pessoaId;
        i.marcadoEm = iso(p.agora);
        if (p.textoFinal !== undefined) {
          i.textoFinal = p.textoFinal;
          i.editadoPor = escopo.pessoaId;
        }
        return i;
      },
      async registrarDesfecho(id, desfecho) {
        const i = doTenant(b.itens).find((x) => x.id === id);
        if (!i) return null;
        i.desfecho = desfecho;
        return i;
      },
    },

    rotinas: {
      async criar(r) {
        const rotina: Rotina = {
          tenantId: escopo.tenantId,
          id: r.id ?? randomUUID(),
          agenteId: r.agenteId,
          conversaId: r.conversaId,
          ownerId: escopo.pessoaId,
          cron: r.cron,
          fusoIana: r.fusoIana,
          instrucao: r.instrucao,
          fonte: r.fonte,
          entregavel: r.entregavel,
          limitesAprovacao: r.limitesAprovacao,
          politicaSemDado: r.politicaSemDado,
          exigeAprovacao: r.exigeAprovacao ?? true,
          estado: r.estado ?? "ativa",
          proximaExecucao: r.proximaExecucao,
          criadoEm: agora(),
          excluidoEm: null,
          acessos: r.acessos ?? null,
          soComPendencia: r.soComPendencia ?? false,
        };
        b.rotinas.push(rotina);
        return rotina;
      },
      async buscar(id) {
        return doTenant(b.rotinas).find((r) => r.id === id) ?? null;
      },
      async buscarParaAtualizar(id) {
        // Espelha o SQL: só a dona (o FOR UPDATE passa pela policy de UPDATE). Sem concorrência na memória, sem lock.
        return doTenant(b.rotinas).find((r) => r.id === id && r.ownerId === escopo.pessoaId) ?? null;
      },
      async listar() {
        return doTenant(b.rotinas).filter((r) => r.excluidoEm === null);
      },
      async listarDoAgente(agenteId) {
        return doTenant(b.rotinas).filter((r) => r.agenteId === agenteId && r.excluidoEm === null);
      },
      async contarDoAgente(agenteId) {
        return doTenant(b.rotinas).filter((r) => r.agenteId === agenteId && r.excluidoEm === null).length;
      },
      async ativasVencidas(em) {
        return doTenant(b.rotinas).filter((r) => r.ownerId === escopo.pessoaId && r.estado === "ativa" && r.excluidoEm === null && r.proximaExecucao <= em);
      },
      async atualizarEstado(id, estado) {
        const r = doTenant(b.rotinas).find((x) => x.id === id);
        if (!r) return null;
        r.estado = estado;
        return r;
      },
      async atualizar(id, campos) {
        // Espelha o SQL: só a dona, nunca excluída, e campo ausente fica como está.
        const r = doTenant(b.rotinas).find((x) => x.id === id && x.ownerId === escopo.pessoaId && x.excluidoEm === null);
        if (!r) return null;
        for (const [k, v] of Object.entries(campos)) if (v !== undefined) Object.assign(r, { [k]: v });
        return r;
      },
      async excluir(id, em) {
        const r = doTenant(b.rotinas).find((x) => x.id === id && x.ownerId === escopo.pessoaId && x.excluidoEm === null);
        if (!r) return null;
        r.excluidoEm = em;
        return r;
      },
      async reagendar(id, proximaExecucao) {
        const r = doTenant(b.rotinas).find((x) => x.id === id);
        if (!r) return null;
        r.proximaExecucao = proximaExecucao;
        return r;
      },
    },

    rotinaJanelas: {
      async reivindicar(p) {
        if (doTenant(b.janelas).some((j) => j.rotinaId === p.rotinaId && j.instanteAgendado === p.instanteAgendado)) return false;
        b.janelas.push({ tenantId: escopo.tenantId, rotinaId: p.rotinaId, instanteAgendado: p.instanteAgendado, executor: p.executor, machineId: p.machineId, turnoId: null });
        return true;
      },
      async vincularTurno(p) {
        const j = doTenant(b.janelas).find((x) => x.rotinaId === p.rotinaId && x.instanteAgendado === p.instanteAgendado);
        if (!j) return false;
        j.turnoId = p.turnoId;
        return true;
      },
      async listar(rotinaId) {
        return doTenant(b.janelas).filter((j) => j.rotinaId === rotinaId).sort((x, y) => x.instanteAgendado - y.instanteAgendado);
      },
      async buscarPorTurno(turnoId) {
        return doTenant(b.janelas).find((j) => j.turnoId === turnoId) ?? null;
      },
      // Sem concorrência em memória: travar só confirma que a janela existe.
      async travar(rotinaId, instanteAgendado) {
        return doTenant(b.janelas).some((j) => j.rotinaId === rotinaId && j.instanteAgendado === instanteAgendado);
      },
      async esperaDaCotaDe(raizId, prefixo, agora) {
        const cadeia = new Set([raizId]);
        for (let n = 0; n < 10; n++) for (const v of doTenant(b.turnos)) if (v.origem === "retomada" && v.retomaTurnoId && cadeia.has(v.retomaTurnoId)) cadeia.add(v.id);
        const v = doTenant(b.turnos).filter((x) => x.id !== raizId && cadeia.has(x.id) && x.estado === "pendente" && x.acordarEm !== null && x.acordarEm !== undefined && x.acordarEm > agora && x.entradaTexto.startsWith(prefixo))
          .sort((x, y) => (x.acordarEm ?? 0) - (y.acordarEm ?? 0))[0];
        return v ? { voltaEm: v.acordarEm as number, entrada: v.entradaTexto, harness: v.harness ?? null } : null;
      },
      async retomadaPendenteDe(raizId, exceto) {
        const cadeia = new Set([raizId]);
        for (let n = 0; n < 10; n++) for (const v of doTenant(b.turnos)) if (v.origem === "retomada" && v.retomaTurnoId && cadeia.has(v.retomaTurnoId)) cadeia.add(v.id);
        return doTenant(b.turnos).find((v) => v.id !== raizId && v.id !== exceto && cadeia.has(v.id) && (v.estado === "pendente" || v.estado === "despachando"))?.id ?? null;
      },
      async turnoAberto(rotinaId, ref) {
        const minhas = doTenant(b.janelas).filter((j) => j.rotinaId === rotinaId && j.turnoId !== null);
        const vivo = (x: Turno) => x.estado === "pendente" || x.estado === "despachando";
        const abertas = minhas
          .filter((j) => j.instanteAgendado > ref - 7 * 86_400_000)
          .filter((j) => {
            const t = doTenant(b.turnos).find((x) => x.id === j.turnoId);
            // ADR-099 (I7 revista): sem trabalho, a cadeia de retomadas da execução (até 10 saltos).
            const cadeia = new Set([t?.id]);
            for (let n = 0; n < 10; n++) for (const v of doTenant(b.turnos)) if (v.origem === "retomada" && v.retomaTurnoId && cadeia.has(v.retomaTurnoId)) cadeia.add(v.id);
            return t !== undefined && (vivo(t) || (Boolean(t.trabalhoId) && doTenant(b.turnos).some((v) => v.trabalhoId === t.trabalhoId && vivo(v)))
              || (!t.trabalhoId && doTenant(b.turnos).some((v) => cadeia.has(v.id) && vivo(v))));
          })
          .sort((x, y) => y.instanteAgendado - x.instanteAgendado);
        const j = abertas[0];
        const t = j ? doTenant(b.turnos).find((x) => x.id === j.turnoId) : undefined;
        return j && t
          ? { turnoId: t.id, instanteAgendado: j.instanteAgendado, estado: t.estado, attempted: t.sinais.attempted, acordarEm: t.acordarEm ?? null, criadoEm: t.criadoEm, trabalhoId: t.trabalhoId ?? null }
          : null;
      },
      // definido em 2026-10-15 (pacote A3): a execução aberta com o instante da janela (a lista conta os horários pulados).
      async execucaoAberta(rotinaId, ref) {
        const a = await this.turnoAberto(rotinaId, ref);
        return a ? { turnoId: a.turnoId, instanteAgendado: a.instanteAgendado } : null;
      },
      async turnosPendentesDaRotina(rotinaId, ref) {
        const saida: { turnoId: string; conversaId: string; janelaTurnoId: string }[] = [];
        const vistos = new Set<string>();
        for (const j of doTenant(b.janelas).filter((x) => x.rotinaId === rotinaId && x.turnoId !== null && x.instanteAgendado > ref - 7 * 86_400_000)) {
          const t = doTenant(b.turnos).find((x) => x.id === j.turnoId);
          if (!t) continue;
          const cadeia = new Set<string>([t.id]);
          if (t.trabalhoId) for (const v of doTenant(b.turnos)) if (v.trabalhoId === t.trabalhoId) cadeia.add(v.id);
          for (let n = 0; n < 10; n++) for (const v of doTenant(b.turnos)) if (v.origem === "retomada" && v.retomaTurnoId && cadeia.has(v.retomaTurnoId)) cadeia.add(v.id);
          for (const v of doTenant(b.turnos)) {
            if (!cadeia.has(v.id) || v.estado !== "pendente" || vistos.has(v.id)) continue;
            vistos.add(v.id);
            saida.push({ turnoId: v.id, conversaId: v.conversaId, janelaTurnoId: t.id });
          }
        }
        return saida;
      },
      async podar(rotinaId, ref) {
        const minhas = doTenant(b.janelas).filter((j) => j.rotinaId === rotinaId);
        const sai = new Set(minhas.filter((j) => {
          if (j.instanteAgendado >= ref - 30 * 86_400_000) return false;
          const t = j.turnoId ? doTenant(b.turnos).find((x) => x.id === j.turnoId) : undefined;
          return !t || (t.estado !== "pendente" && t.estado !== "despachando");
        }));
        b.janelas = b.janelas.filter((j) => !sai.has(j));
        return sai.size;
      },
    },

    rotinaExecucoes: {
      async registrar(e) {
        const exec: ExecucaoRotina = { tenantId: escopo.tenantId, id: e.id ?? randomUUID(), rotinaId: e.rotinaId, instanteAgendado: e.instanteAgendado, turnoId: e.turnoId ?? null, desfecho: e.desfecho, motivo: e.motivo ?? null, em: e.em, voltaEm: e.voltaEm ?? null };
        b.execucoes.push(exec);
        return exec;
      },
      async atualizarDesfecho(id, desfecho, motivo = null, em, voltaEm = null) {
        const e = doTenant(b.execucoes).find((x) => x.id === id);
        if (!e) return null;
        e.desfecho = desfecho;
        e.motivo = motivo;
        e.voltaEm = voltaEm;
        if (em !== undefined) e.em = em;
        return e;
      },
      async daJanela(rotinaId, instanteAgendado) {
        return doTenant(b.execucoes).filter((e) => e.rotinaId === rotinaId && e.instanteAgendado === instanteAgendado).sort((x, y) => y.em - x.em || y.id.localeCompare(x.id))[0] ?? null;
      },
      async listar(rotinaId, limite = EXECUCOES_GUARDADAS) {
        return doTenant(b.execucoes).filter((e) => e.rotinaId === rotinaId).sort((x, y) => y.em - x.em || y.id.localeCompare(x.id)).slice(0, limite);
      },
      async podar(rotinaId, guardar = EXECUCOES_GUARDADAS) {
        const minhas = doTenant(b.execucoes).filter((e) => e.rotinaId === rotinaId).sort((x, y) => y.em - x.em || y.id.localeCompare(x.id));
        const sobra = new Set(minhas.slice(guardar).map((e) => e.id));
        b.execucoes = b.execucoes.filter((e) => !sobra.has(e.id));
        return sobra.size;
      },
    },

    salas: {
      async criarComMembros(s, membros) {
        const sala: Sala = {
          tenantId: escopo.tenantId,
          id: s.id ?? randomUUID(),
          ownerId: escopo.pessoaId,
          visibility: "privado",
          nome: s.nome,
          conversaId: s.conversaId,
          politica: s.politica ?? "lead",
          leadAgenteId: s.leadAgenteId ?? null,
          orcamento: s.orcamento ?? { ...ORCAMENTO_INICIAL },
          criadoEm: agora(),
        };
        b.salas.push(sala);
        const criados: MembroSala[] = [];
        for (const m of membros) {
          const membro = await repos.salas.adicionarMembro(sala.id, m);
          if (membro) criados.push(membro);
        }
        return { sala, membros: criados };
      },
      async buscar(id) {
        return doTenant(b.salas).find((s) => s.id === id) ?? null;
      },
      async buscarPorConversa(conversaId) {
        return doTenant(b.salas).find((s) => s.conversaId === conversaId) ?? null;
      },
      async listar() {
        return doTenant(b.salas);
      },
      async membros(salaId) {
        return doTenant(b.membros)
          .filter((m) => m.salaId === salaId && m.removidoEm === null)
          .sort((x, y) => x.criadoEm - y.criadoEm)
          .map(({ criadoEm: _c, ...m }) => m);
      },
      async adicionarMembro(salaId, m) {
        const existente = doTenant(b.membros).find((x) => x.salaId === salaId && x.agenteId === m.agenteId);
        if (existente) {
          existente.removidoEm = null;
          existente.pessoaLeitoraId = m.pessoaLeitoraId;
          const { criadoEm: _c, ...semCriado } = existente;
          return semCriado;
        }
        const membro = { tenantId: escopo.tenantId, salaId, agenteId: m.agenteId, pessoaLeitoraId: m.pessoaLeitoraId, logInteiro: true as const, removidoEm: null, criadoEm: agora() + b.membros.length / 1000 };
        b.membros.push(membro);
        const { criadoEm: _c, ...semCriado } = membro;
        return semCriado;
      },
      async removerMembro(salaId, agenteId, em) {
        const m = doTenant(b.membros).find((x) => x.salaId === salaId && x.agenteId === agenteId && x.removidoEm === null);
        if (!m) return false;
        m.removidoEm = em;
        return true;
      },
      async atualizarOrcamento(id, orcamento) {
        const s = doTenant(b.salas).find((x) => x.id === id);
        if (!s) return false;
        s.orcamento = orcamento;
        return true;
      },
      async atualizarPolitica(id, p) {
        const s = doTenant(b.salas).find((x) => x.id === id);
        if (!s) return null;
        if (p.politica !== undefined) s.politica = p.politica;
        if (p.leadAgenteId !== undefined) s.leadAgenteId = p.leadAgenteId;
        return s;
      },
    },

    githubApp: {
      async config() { return b.githubApp.get(escopo.tenantId) ?? null; },
      async salvar(c) { b.githubApp.set(escopo.tenantId, { ...c, ownerId: b.githubApp.get(escopo.tenantId)?.ownerId ?? escopo.pessoaId }); },
    },
    composio: {
      async chave() { return b.composioChaves.get(escopo.tenantId + escopo.pessoaId) ?? null; },
      async salvarChave(c) { b.composioChaves.set(escopo.tenantId + escopo.pessoaId, c); },
      async sessao(t) { return b.composioSessoes.get(escopo.tenantId + escopo.pessoaId + t) ?? null; },
      async salvarSessao(s) { b.composioSessoes.set(escopo.tenantId + escopo.pessoaId + s.toolkit, s); },
    },
    conectores: {
      async atualizarEndpoint(id, url, envCifrado, envChaves) {
        const c = b.conectores.find((c) => c.id === id && c.ownerId === escopo.pessoaId);
        if (!c) return null;
        Object.assign(c, { url, envCifrado, env: Object.fromEntries(envChaves.map((k) => [k, true])), habilitado: false, catalogo: [], sondadoEm: null, ultimaFalha: null });
        return c;
      },
      async tornarNativo(id, p) {
        const c = b.conectores.find((c) => c.id === id && c.ownerId === escopo.pessoaId);
        if (!c) return null;
        Object.assign(c, { transporte: "stdio", comando: p.comando, args: [], url: null, envCifrado: p.envCifrado, env: Object.fromEntries(p.envChaves.map((k) => [k, true])), habilitado: false, catalogo: [], sondadoEm: null, ultimaFalha: null });
        return c;
      },
      async criar(c) {
        const env: Record<string, true> = {};
        for (const k of c.envChaves ?? []) env[k] = true;
        const conector: ConectorGuardado = {
          tenantId: escopo.tenantId,
          id: c.id ?? randomUUID(),
          ownerId: escopo.pessoaId,
          visibility: c.visibility ?? "privado",
          nome: c.nome,
          slug: c.slug,
          transporte: c.transporte,
          comando: c.comando ?? null,
          args: c.args ?? [],
          url: c.url ?? null,
          env,
          declaracao: c.declaracao,
          habilitado: false,
          catalogo: [],
          sondadoEm: null,
          ultimaFalha: null,
          criadoEm: agora(),
          envCifrado: c.envCifrado ?? null,
        };
        b.conectores.push(conector);
        return conector;
      },
      async buscar(id) {
        return doTenant(b.conectores).find((c) => c.id === id) ?? null;
      },
      async buscarPorSlug(slug) {
        return doTenant(b.conectores).find((c) => c.slug === slug) ?? null;
      },
      async listar() {
        return doTenant(b.conectores);
      },
      async listarHabilitados() {
        return doTenant(b.conectores).filter((c) => c.habilitado);
      },
      async registrarSonda(id, r) {
        const c = doTenant(b.conectores).find((x) => x.id === id);
        if (!c) return null;
        c.sondadoEm = r.agora;
        if (r.ok) {
          c.catalogo = r.catalogo;
          c.habilitado = true;
          c.ultimaFalha = null;
        } else c.ultimaFalha = { motivo: r.motivo, em: r.agora };
        return c;
      },
      async habilitar(id, habilitado) {
        const c = doTenant(b.conectores).find((x) => x.id === id);
        if (!c) return null;
        c.habilitado = habilitado;
        return c;
      },
      async atualizarEnv(id, p) {
        const c = doTenant(b.conectores).find((x) => x.id === id);
        if (!c) return false;
        c.envCifrado = p.envCifrado;
        const env: Record<string, true> = {};
        for (const k of p.envChaves) env[k] = true;
        c.env = env;
        return true;
      },
      async marcarFalha(id, motivo, em) {
        const c = doTenant(b.conectores).find((x) => x.id === id);
        if (!c) return false;
        c.ultimaFalha = { motivo, em };
        return true;
      },
    },

    concessoes: {
      async conceder(c) {
        if (doTenant(b.concessoes).some((x) => x.agenteId === c.agenteId && x.conectorId === c.conectorId && x.capacidade === c.capacidade)) return null;
        const concessao: Concessao = { tenantId: escopo.tenantId, id: c.id ?? randomUUID(), ownerId: escopo.pessoaId, agenteId: c.agenteId, conectorId: c.conectorId, capacidade: c.capacidade, mensagemId: c.mensagemId, criadoEm: agora() };
        b.concessoes.push(concessao);
        return concessao;
      },
      async buscar(id) {
        return doTenant(b.concessoes).find((c) => c.id === id) ?? null;
      },
      async doAgente(agenteId) {
        return doTenant(b.concessoes).filter((c) => c.agenteId === agenteId);
      },
      async contarPorAgente(agenteIds) {
        const saida = new Map<string, number>();
        for (const id of agenteIds) {
          const n = doTenant(b.concessoes).filter((c) => c.agenteId === id).length;
          if (n > 0) saida.set(id, n);
        }
        return saida;
      },
      // Sem concorrência em memória: a trava advisory não tem o que serializar.
      async travar() {
        return undefined;
      },
      async migrarCapacidades(conectorId, mapa) {
        let n = 0;
        for (const c of doTenant(b.concessoes).filter((x) => x.conectorId === conectorId && x.capacidade in mapa)) {
          for (const nova of mapa[c.capacidade] ?? []) {
            if (doTenant(b.concessoes).some((x) => x.agenteId === c.agenteId && x.conectorId === conectorId && x.capacidade === nova)) continue;
            b.concessoes.push({ ...c, id: randomUUID(), capacidade: nova });
            n += 1;
          }
        }
        b.concessoes = b.concessoes.filter((x) => !(x.tenantId === escopo.tenantId && x.conectorId === conectorId && x.capacidade in mapa));
        return n;
      },
      async revogar(id) {
        const i = b.concessoes.findIndex((c) => c.tenantId === escopo.tenantId && c.id === id);
        if (i === -1) return false;
        b.concessoes.splice(i, 1);
        return true;
      },
    },

    procuracoes: {
      async criar(p) {
        const procuracao: Procuracao = { tenantId: escopo.tenantId, id: p.id ?? randomUUID(), ownerId: escopo.pessoaId, agenteConcedenteId: p.agenteConcedenteId, agenteBeneficiarioId: p.agenteBeneficiarioId, classesPermitidas: p.classesPermitidas, tetoDiario: p.tetoDiario, criadoEm: agora() };
        b.procuracoes.push(procuracao);
        return procuracao;
      },
      async listarDoBeneficiario(agenteBeneficiarioId) {
        return doTenant(b.procuracoes).filter((p) => p.agenteBeneficiarioId === agenteBeneficiarioId);
      },
    },

    inventario: {
      async registrar(motor, inv) {
        const existente = b.inventario.find((i) => i.tenantId === escopo.tenantId && i.pessoaId === escopo.pessoaId && i.motor === motor);
        if (existente) existente.inventario = inv;
        else b.inventario.push({ tenantId: escopo.tenantId, pessoaId: escopo.pessoaId, motor, inventario: inv });
        return inv;
      },
      async buscar(motor) {
        return b.inventario.find((i) => i.tenantId === escopo.tenantId && i.pessoaId === escopo.pessoaId && i.motor === motor)?.inventario ?? null;
      },
      async listar() {
        return b.inventario.filter((i) => i.tenantId === escopo.tenantId && i.pessoaId === escopo.pessoaId).map(({ motor, inventario }) => ({ motor, inventario }));
      },
    },

    reacoes: {
      async por(p) {
        const ja = b.reacoes.some((r) => r.tenantId === escopo.tenantId && r.mensagemId === p.mensagemId && r.ownerId === escopo.pessoaId && r.emoji === p.emoji);
        if (ja) return false;
        b.reacoes.push({ tenantId: escopo.tenantId, ownerId: escopo.pessoaId, conversaId: p.conversaId, mensagemId: p.mensagemId, emoji: p.emoji, criadoEm: Date.now() });
        return true;
      },
      async tirar(p) {
        const antes = b.reacoes.length;
        b.reacoes = b.reacoes.filter((r) => !(r.tenantId === escopo.tenantId && r.mensagemId === p.mensagemId && r.ownerId === escopo.pessoaId && r.emoji === p.emoji));
        return b.reacoes.length < antes;
      },
      async dasMensagens(ids) {
        const saida: ReacaoNaFala[] = [];
        for (const id of ids) {
          const desta = doTenant(b.reacoes).filter((r) => r.mensagemId === id);
          for (const emoji of [...new Set(desta.map((r) => r.emoji))]) {
            const comEle = desta.filter((r) => r.emoji === emoji);
            saida.push({ mensagemId: id, emoji, total: comEle.length, minha: comEle.some((r) => r.ownerId === escopo.pessoaId) });
          }
        }
        return saida;
      },
    },

    relatos: {
      async criar(r) {
        const relato: Relato = {
          tenantId: escopo.tenantId,
          id: randomUUID(),
          mensagemId: r.mensagemId,
          tipo: r.tipo ?? "bug",
          origem: r.origem ?? "botao",
          conversaId: r.conversaId,
          turnoId: r.turnoId,
          categoria: r.categoria,
          alcance: r.alcance,
          mensagensAnexadas: r.mensagensAnexadas,
          metadados: {
            estadoTurno: r.estadoTurno,
            origemTurno: r.origemTurno,
            sinais: r.sinais,
            motivoFalha: r.motivoFalha,
            motivoInterrupcao: r.motivoInterrupcao,
            modelo: r.modelo,
            harness: r.harness,
            executor: r.executor,
            machineId: r.machineId,
            custoUsd: r.custoUsd,
            reenvios: r.reenvios,
            confiancaMensagem: r.confiancaMensagem,
            mensagemParcial: r.mensagemParcial,
            versaoApp: r.versaoApp,
            correlationId: r.correlationId,
          },
          diagnostico: null,
          criadoEm: Date.now(),
        };
        b.relatos.push({ ...relato, ownerId: escopo.pessoaId });
        return relato;
      },
      async gravarProsa() {},
      async listar(limite = 100) {
        return doTenant(b.relatos).sort((x, y) => y.criadoEm - x.criadoEm).slice(0, limite);
      },
      async buscar(id) {
        return doTenant(b.relatos).find((r) => r.id === id) ?? null;
      },
      async prosaDe() {
        return null;
      },
      async contarDoNodDesde(desde) {
        return doTenant(b.relatos).filter((r) => r.ownerId === escopo.pessoaId && r.origem === "nod" && r.criadoEm >= desde).length;
      },
      async registrarDiagnostico() {},
      async diagnosticoDoTurno() {
        return null;
      },
    },

    incidentes: {
      // Espelha o SQL (incidentes.repo.ts): um em curso (voltouEm null) por pessoa e tipo; sem advisory lock em memória.
      async travarUltimo(tipo) {
        const meus = b.incidentes.filter((i) => i.tenantId === escopo.tenantId && i.ownerId === escopo.pessoaId && i.tipo === tipo);
        return meus.find((i) => i.voltouEm === null) ?? [...meus].sort((x, y) => (y.voltouEm ?? 0) - (x.voltouEm ?? 0) || y.comecouEm - x.comecouEm)[0] ?? null;
      },
      async abrir(n) {
        if (n.voltouEm === null && b.incidentes.some((i) => i.tenantId === escopo.tenantId && i.ownerId === escopo.pessoaId && i.tipo === n.tipo && i.voltouEm === null)) {
          throw Object.assign(new Error('duplicate key value violates unique constraint "incidente_em_curso"'), { code: "23505" });
        }
        const incidente = { tenantId: escopo.tenantId, ownerId: escopo.pessoaId, id: randomUUID(), tipo: n.tipo, machineId: n.machineId, comecouEm: n.comecouEm, voltouEm: n.voltouEm, rotinas: n.rotinas, conversas: n.conversas, agentes: [...new Set(n.agentes)], dispensadoEm: null, criadoEm: agora() };
        b.incidentes.push(incidente);
        return incidente;
      },
      async mesclar(id, m) {
        const i = b.incidentes.find((x) => x.tenantId === escopo.tenantId && x.ownerId === escopo.pessoaId && x.id === id);
        if (!i) return null;
        i.comecouEm = Math.min(i.comecouEm, m.comecouEm);
        i.voltouEm = m.voltouEm === null ? null : Math.max(i.voltouEm ?? m.voltouEm, m.voltouEm);
        i.rotinas += m.rotinas;
        i.conversas += m.conversas;
        i.agentes = [...new Set([...i.agentes, ...m.agentes])];
        return i;
      },
      async emCurso() {
        return b.incidentes.filter((i) => i.tenantId === escopo.tenantId && i.ownerId === escopo.pessoaId && i.voltouEm === null).sort((x, y) => x.comecouEm - y.comecouEm);
      },
      async marcarVolta(id, em) {
        const i = b.incidentes.find((x) => x.tenantId === escopo.tenantId && x.ownerId === escopo.pessoaId && x.id === id && x.voltouEm === null);
        if (!i) return null;
        i.voltouEm = Math.max(i.comecouEm, em);
        return i;
      },
      async dispensar(id, em) {
        const i = b.incidentes.find((x) => x.tenantId === escopo.tenantId && x.ownerId === escopo.pessoaId && x.id === id);
        if (!i) return null;
        i.dispensadoEm ??= em;
        return i;
      },
      async visiveis(desde) {
        return b.incidentes
          .filter((i) => i.tenantId === escopo.tenantId && i.ownerId === escopo.pessoaId && i.dispensadoEm === null && (i.voltouEm === null || i.voltouEm > desde))
          .sort((x, y) => x.comecouEm - y.comecouEm);
      },
    },

    gastos: {
      async registrar(g) {
        const gasto = { ...g, id: randomUUID(), tenantId: escopo.tenantId, ownerId: escopo.pessoaId };
        b.gastos.push(gasto);
        const { tenantId: _t, ownerId: _o, ...semEscopo } = gasto;
        return semEscopo;
      },
      async algumSemCusto(p) {
        const daConversa = (turnoId: string) => !p.conversaId || doTenant(b.turnos).some((t) => t.id === turnoId && t.conversaId === p.conversaId);
        return doTenant(b.gastos).some((g) => g.ownerId === escopo.pessoaId && g.custoUsd === null && g.tokensEntrada + g.tokensSaida > 0 && g.em >= p.desde && g.em <= p.ate && daConversa(g.turnoId));
      },
      async doTurno(turnoId) {
        return doTenant(b.gastos).filter((g) => g.turnoId === turnoId).map(({ tenantId: _t, ownerId: _o, ...g }) => g);
      },
      async somarMes(em, executor) {
        const inicio = new Date(em);
        inicio.setUTCDate(1);
        inicio.setUTCHours(0, 0, 0, 0);
        return doTenant(b.gastos)
          .filter((g) => g.ownerId === escopo.pessoaId && g.em >= inicio.getTime() && (executor === undefined || g.executor === executor))
          .reduce((s, g) => s + (g.custoUsd ?? 0), 0);
      },
    },

    trilha: {
      async registrar(t) {
        const linha: LinhaTrilha = {
          tenantId: escopo.tenantId,
          id: randomUUID(),
          ownerId: escopo.pessoaId,
          agenteId: t.agenteId,
          turnoId: t.turnoId ?? null,
          conectorId: t.conectorId ?? null,
          ferramenta: t.ferramenta,
          kind: t.kind,
          motivo: t.motivo ?? null,
          regra: t.regra,
          regraVersao: t.regraVersao,
          em: iso(t.em ?? agora()),
        };
        b.trilha.push(linha);
        return linha;
      },
      async doTurno(turnoId) {
        return doTenant(b.trilha).filter((l) => l.turnoId === turnoId);
      },
      async doTurnos(turnoIds) {
        return doTenant(b.trilha).filter((l) => l.turnoId !== null && turnoIds.includes(l.turnoId));
      },
      async filtrar(f = {}) {
        return doTenant(b.trilha)
          .filter((l) => !f.agenteId || l.agenteId === f.agenteId)
          .filter((l) => !f.conectorId || l.conectorId === f.conectorId)
          .filter((l) => !f.dia || l.em.slice(0, 10) === f.dia)
          .sort((x, y) => Date.parse(y.em) - Date.parse(x.em))
          .slice(0, f.limite ?? 500);
      },
    },

    paradas: {
      async ativar(p) {
        const parada = { tenantId: escopo.tenantId, id: randomUUID(), pessoaId: escopo.pessoaId, conversaId: p.conversaId, ativaDesde: p.agora, encerradaEm: null, faixa: null };
        b.paradas.push(parada);
        const { tenantId: _t, ...semTenant } = parada;
        return semTenant;
      },
      async encerrar(id, p) {
        const x = doTenant(b.paradas).find((y) => y.id === id && y.encerradaEm === null);
        if (!x) return null;
        x.encerradaEm = p.agora;
        x.faixa = p.faixa;
        const { tenantId: _t, ...semTenant } = x;
        return semTenant;
      },
      async encerrarAbertas(p) {
        let n = 0;
        for (const x of doTenant(b.paradas)) {
          if (x.pessoaId === escopo.pessoaId && x.encerradaEm === null && (p.conversaId === null || x.conversaId === null || x.conversaId === p.conversaId)) {
            x.encerradaEm = p.agora;
            n += 1;
          }
        }
        return n;
      },
      async ativa(pessoaId, conversaId) {
        return doTenant(b.paradas).some((x) => x.pessoaId === pessoaId && x.encerradaEm === null && (x.conversaId === null || x.conversaId === conversaId));
      },
      async listarAbertas() {
        return doTenant(b.paradas)
          .filter((x) => x.pessoaId === escopo.pessoaId && x.encerradaEm === null)
          .map(({ tenantId: _t, ...p }) => p);
      },
    },

    catcher: {
      async registrar(r) {
        const reg = { tenantId: escopo.tenantId, id: randomUUID(), turnoId: r.turnoId, tipo: r.tipo, dados: r.dados, em: agora() + b.catcher.length / 1000 };
        b.catcher.push(reg);
        const { tenantId: _t, ...semTenant } = reg;
        return semTenant;
      },
      async listar(turnoId) {
        return doTenant(b.catcher)
          .filter((r) => r.turnoId === turnoId)
          .sort((x, y) => x.em - y.em)
          .map(({ tenantId: _t, ...r }) => r);
      },
      async listarRecentes(limite = 100) {
        return doTenant(b.catcher)
          .sort((x, y) => y.em - x.em)
          .slice(0, limite)
          .map(({ tenantId: _t, ...r }) => r);
      },
    },
    maquinaTokens: {
      async criar(e) {
        const l = { tenantId: escopo.tenantId, ownerId: escopo.pessoaId, id: randomUUID(), nome: e.nome, prefixo: e.prefixo, hash: e.hash, criadaEm: agora(), ultimoUsoEm: null as number | null, expiraEm: null as number | null, revogadaEm: null as number | null };
        b.maquinaTokens.push(l);
        return { id: l.id, nome: l.nome, prefixo: l.prefixo, criadaEm: l.criadaEm, ultimoUsoEm: null, revogadaEm: null };
      },
      async listar() {
        return b.maquinaTokens
          .filter((l) => l.tenantId === escopo.tenantId && l.ownerId === escopo.pessoaId)
          .sort((x, y) => y.criadaEm - x.criadaEm)
          .map(({ id, nome, prefixo, criadaEm, ultimoUsoEm, revogadaEm, expiraEm }) => ({ id, nome, prefixo, criadaEm, ultimoUsoEm, revogadaEm: revogadaEm ?? (expiraEm !== null && expiraEm <= Date.now() ? expiraEm : null) }));
      },
      async revogar(id, em) {
        const l = b.maquinaTokens.find((x) => x.tenantId === escopo.tenantId && x.ownerId === escopo.pessoaId && x.id === id);
        if (!l) return false;
        l.revogadaEm ??= em;
        return true;
      },
      async vencerEm(id, ate) {
        const l = b.maquinaTokens.find((x) => x.tenantId === escopo.tenantId && x.ownerId === escopo.pessoaId && x.id === id && x.revogadaEm === null);
        if (!l) return false;
        l.expiraEm = l.expiraEm === null ? ate : Math.min(l.expiraEm, ate);
        return true;
      },
      async buscarVivaPorHash(hash, em) {
        // Filtra expiração como o repo real (maquina-tokens.repo.ts): duplo que ignora `em` esconde bug.
        const l = b.maquinaTokens.find((x) => x.tenantId === escopo.tenantId && x.ownerId === escopo.pessoaId && x.revogadaEm === null && (x.expiraEm === null || x.expiraEm > em) && x.hash.equals(hash));
        return l ? { id: l.id, hash: l.hash } : null;
      },
      async marcarUso(id, em) {
        const l = b.maquinaTokens.find((x) => x.tenantId === escopo.tenantId && x.ownerId === escopo.pessoaId && x.id === id);
        if (l) l.ultimoUsoEm = em;
      },
      async renomear(id, nome) {
        const l = b.maquinaTokens.find((x) => x.tenantId === escopo.tenantId && x.ownerId === escopo.pessoaId && x.id === id && x.revogadaEm === null);
        if (!l) return false;
        l.nome = nome;
        return true;
      },
      async registrarPlataforma(id, plataforma) {
        const l = b.maquinaTokens.find((x) => x.tenantId === escopo.tenantId && x.ownerId === escopo.pessoaId && x.id === id);
        if (l) l.plataforma = plataforma;
      },
      async identificar(id) {
        const l = b.maquinaTokens.find((x) => x.tenantId === escopo.tenantId && x.ownerId === escopo.pessoaId && x.id === id);
        return l ? { nome: l.nome, plataforma: l.plataforma ?? null } : null;
      },
    },
    permissoesPermanentes: {
      async criar(p) {
        const ja = doTenant(b.permissoes).some((x) => x.agenteId === p.agenteId && x.conectorId === p.conectorId && x.capacidade === p.capacidade && x.inativoEm === null);
        if (ja) return null;
        const permissao = {
          tenantId: escopo.tenantId,
          id: p.id ?? randomUUID(),
          ownerId: escopo.pessoaId,
          agenteId: p.agenteId,
          conectorId: p.conectorId,
          capacidade: p.capacidade,
          itemOrigemId: p.itemOrigemId,
          mensagemId: p.mensagemId,
          regraVersao: p.regraVersao,
          criadoEm: agora(),
          inativoEm: null,
          inativoMotivo: null,
        };
        b.permissoes.push(permissao);
        return permissao;
      },
      async ativasDoAgente(agenteId) {
        return doTenant(b.permissoes).filter((p) => p.agenteId === agenteId && p.ownerId === escopo.pessoaId && p.inativoEm === null);
      },
      async listar(agenteId) {
        return doTenant(b.permissoes).filter((p) => p.ownerId === escopo.pessoaId && (!agenteId || p.agenteId === agenteId));
      },
      async buscar(id) {
        return doTenant(b.permissoes).find((p) => p.id === id) ?? null;
      },
      async desativar(id, motivo, quando) {
        const p = doTenant(b.permissoes).find((x) => x.id === id && x.ownerId === escopo.pessoaId && x.inativoEm === null);
        if (!p) return false;
        p.inativoEm = quando;
        p.inativoMotivo = motivo;
        return true;
      },
      async migrarCapacidades(conectorId, mapa, quando) {
        let n = 0;
        for (const p of doTenant(b.permissoes).filter((x) => x.conectorId === conectorId && x.inativoEm === null && x.capacidade in mapa)) {
          b.permissoes.push({ ...p, id: randomUUID(), capacidade: mapa[p.capacidade] ?? p.capacidade });
          p.inativoEm = quando;
          p.inativoMotivo = "capacidade_fora_do_catalogo";
          n += 1;
        }
        return n;
      },
      async desativarPor(filtro, motivo, quando) {
        const alvos = doTenant(b.permissoes).filter((p) => p.inativoEm === null
          && (!filtro.agenteId || p.agenteId === filtro.agenteId)
          && (!filtro.conectorId || p.conectorId === filtro.conectorId)
          && (!filtro.capacidade || p.capacidade === filtro.capacidade));
        for (const p of alvos) { p.inativoEm = quando; p.inativoMotivo = motivo; }
        return alvos.length;
      },
    },
    raioX: {
      async gravarComposicao(turnoId, composicao) {
        b.raioX.set(turnoId, { execucao: null, ...b.raioX.get(turnoId), composicao });
      },
      async gravarExecucao(turnoId, execucao) {
        b.raioX.set(turnoId, { composicao: null, ...b.raioX.get(turnoId), execucao });
      },
      async doTurno(turnoId) {
        const t = doTenant(b.turnos).find((x) => x.id === turnoId);
        if (!t) return null;
        const r = b.raioX.get(t.id);
        return { turnoId: t.id, agenteId: t.agenteId, estado: t.estado, custoUsd: t.custoUsd, criadoEm: t.criadoEm, composicao: r?.composicao ?? null, execucao: r?.execucao ?? null };
      },
      async daConversa(conversaId, limite) {
        return doTenant(b.turnos).filter((t) => t.conversaId === conversaId).sort((x, y) => y.criadoEm - x.criadoEm).slice(0, limite)
          .map((t) => ({ turnoId: t.id, agenteId: t.agenteId, estado: t.estado, custoUsd: t.custoUsd, criadoEm: t.criadoEm, composicao: null, execucao: b.raioX.get(t.id)?.execucao ?? null }));
      },
      async totalDesde(conversaId, desde) {
        const comGasto = (id: string) => doTenant(b.gastos).some((g) => g.turnoId === id && g.tokensEntrada + g.tokensSaida > 0);
        const com = doTenant(b.turnos).filter((t) => t.conversaId === conversaId && t.criadoEm >= desde && (t.custoUsd !== null || comGasto(t.id)));
        const parcial = com.some((t) => t.custoUsd === null);
        return { custoUsd: com.reduce((s, t) => s + (t.custoUsd ?? 0), 0), turnos: com.length, ...(parcial ? { parcial: true } : {}) };
      },
    },
    preferencias: (() => {
      const chave = `${escopo.tenantId}:${escopo.pessoaId}`;
      const atual = (): Preferencias => b.preferencias.get(chave) ?? { modoDev: false, avisosFechados: [], usoDoMac: "equilibrado", maquinaPadraoId: null, ordemIas: null, iasNoLimite: {} };
      return {
        async buscar() {
          return atual();
        },
        async gravar(p) {
          const nova = { ...atual(), ...(p.modoDev !== undefined ? { modoDev: p.modoDev } : {}), ...(p.usoDoMac !== undefined ? { usoDoMac: p.usoDoMac } : {}), ...(p.ordemIas !== undefined ? { ordemIas: p.ordemIas } : {}) };
          b.preferencias.set(chave, nova);
          return nova;
        },
        async registrarLimite(ia, limite) {
          const nova = { ...atual(), iasNoLimite: { ...atual().iasNoLimite, [ia]: limite } };
          b.preferencias.set(chave, nova);
          return nova.iasNoLimite;
        },
        async limparLimite(ia) {
          const a = atual();
          if (!a.iasNoLimite?.[ia]) return false;
          const limites = { ...a.iasNoLimite };
          delete limites[ia];
          b.preferencias.set(chave, { ...a, iasNoLimite: limites });
          return true;
        },
        async definirMaquinaPadrao(maquinaId) {
          const nova = { ...atual(), maquinaPadraoId: maquinaId };
          b.preferencias.set(chave, nova);
          return nova;
        },
        async fecharAviso(aviso) {
          const a = atual();
          const nova = a.avisosFechados.includes(aviso) ? a : { ...a, avisosFechados: [...a.avisosFechados, aviso] };
          b.preferencias.set(chave, nova);
          return nova;
        },
      };
    })(),
    onboarding: (() => {
      const chave = `${escopo.tenantId}:${escopo.pessoaId}`;
      const atual = (): LinhaOnboarding => b.onboarding.get(chave) ?? { etapa: null, guiaId: null, botId: null, concluidoEm: null, campos: { apelido: null, comoConheceu: null, objetivo: null, tamanhoTime: null } };
      const mudar = async (fn: (l: LinhaOnboarding) => LinhaOnboarding) => {
        const l = fn(atual());
        b.onboarding.set(chave, l);
        return l;
      };
      const CAMPO = { apelido: "apelido", como_conheceu: "comoConheceu", objetivo: "objetivo", tamanho_time: "tamanhoTime" } as const;
      return {
        async buscar() { return atual(); },
        definirEtapa: (etapa: Exclude<LinhaOnboarding["etapa"], "concluido" | null>) => mudar((l) => ({ ...l, etapa })),
        reiniciar: () => mudar((l) => ({ ...l, etapa: "ola", concluidoEm: null, botId: null, campos: { apelido: null, comoConheceu: null, objetivo: null, tamanhoTime: null } })),
        concluir: (em: number) => mudar((l) => ({ ...l, etapa: "concluido", concluidoEm: em })),
        anotar: (campo: keyof typeof CAMPO, valor: string) => mudar((l) => ({ ...l, campos: { ...l.campos, [CAMPO[campo]]: valor } })),
        definirGuia: (id: string) => mudar((l) => ({ ...l, guiaId: id })),
        definirBot: (id: string) => mudar((l) => ({ ...l, botId: id })),
      };
    })(),
    comandos: {
      async gravar(catalogo) {
        b.comandos.set(`${escopo.tenantId}:${escopo.pessoaId}`, { catalogo, em: agora() });
      },
      async buscar() {
        return b.comandos.get(`${escopo.tenantId}:${escopo.pessoaId}`) ?? null;
      },
    },
    usoDoPlano: {
      async gravar(uso, _machineId, contaId = null) {
        const gravar = (chave: string, u: UsoDoPlano) => {
          const atual = b.usoDoPlano.get(chave);
          if (!atual || atual.medidoEm < u.medidoEm) b.usoDoPlano.set(chave, u);
        };
        if (contaId) gravar(`${escopo.tenantId}:${escopo.pessoaId}:conta:${contaId}`, { ...uso, contaId });
        gravar(`${escopo.tenantId}:${escopo.pessoaId}:${uso.harness}`, uso);
      },
      async listar() {
        const prefixo = `${escopo.tenantId}:${escopo.pessoaId}:`;
        return [...b.usoDoPlano].filter(([k]) => k.startsWith(prefixo) && !k.startsWith(`${prefixo}conta:`)).map(([, v]) => v).sort((x, y) => x.harness.localeCompare(y.harness));
      },
      async listarPorConta() {
        const prefixo = `${escopo.tenantId}:${escopo.pessoaId}:conta:`;
        return [...b.usoDoPlano].filter(([k]) => k.startsWith(prefixo)).map(([, v]) => v).sort((x, y) => x.harness.localeCompare(y.harness) || (x.contaId ?? "").localeCompare(y.contaId ?? ""));
      },
    },
    leituras: (() => {
      const chave = (conversaId: string) => `${escopo.tenantId}:${escopo.pessoaId}:${conversaId}`;
      const nova = (m: Mensagem) => (m.kind === "texto" || m.kind === "artefato") && !(m.autoria.autor_tipo === "pessoa" && m.autoria.autor_id === escopo.pessoaId);
      const naoLidas = (conversaId: string) => {
        const ate = b.leituras.get(chave(conversaId)) ?? -Infinity;
        return doTenant(b.mensagens).filter((m) => m.conversaId === conversaId && m.criadoEm > ate && nova(m)).sort((x, y) => x.criadoEm - y.criadoEm);
      };
      return {
        async resumo() {
          return doTenant(b.conversas)
            .filter((c) => c.tipo === "sala" || c.ownerId === escopo.pessoaId)
            .flatMap((c) => {
              const ms = naoLidas(c.id);
              return ms.length ? [{ conversaId: c.id, tipo: c.tipo, agenteId: c.agenteId, salaId: c.salaId, total: ms.length, desde: ms[0]!.criadoEm, ultimaEm: ms[ms.length - 1]!.criadoEm }] : [];
            })
            .sort((x, y) => y.ultimaEm - x.ultimaEm);
        },
        async mensagens(conversaIds: readonly string[], por = 3) {
          const saida = new Map<string, { primeira: Mensagem; ultimas: Mensagem[]; daRotina: boolean }>();
          for (const id of conversaIds) {
            const ms = naoLidas(id);
            if (!ms.length) continue;
            const turnos = new Set(ms.map((m) => m.turnoId));
            saida.set(id, { primeira: ms[0]!, ultimas: ms.slice(-por), daRotina: doTenant(b.turnos).some((t) => turnos.has(t.id) && t.origem === "rotina") });
          }
          return saida;
        },
        async marcarLida(conversaId: string) {
          const ultima = Math.max(...doTenant(b.mensagens).filter((m) => m.conversaId === conversaId).map((m) => m.criadoEm), -Infinity);
          const ate = Number.isFinite(ultima) ? ultima : agora();
          b.leituras.set(chave(conversaId), Math.max(b.leituras.get(chave(conversaId)) ?? -Infinity, ate));
        },
        async marcarNaoLida(conversaId: string) {
          const ultima = Math.max(...doTenant(b.mensagens).filter((m) => m.conversaId === conversaId && nova(m)).map((m) => m.criadoEm), -Infinity);
          if (!Number.isFinite(ultima)) return false;
          b.leituras.set(chave(conversaId), ultima - 0.001);
          return true;
        },
      };
    })(),
    // definido em 2026-10-04 (ADR-075): ligações em memória, só o necessário para os testes de unidade.
    ligacoes: (() => {
      type L = import("../../src/contracts/ligacao.ts").Ligacao & { ownerId: string; tenantId: string };
      const lista: L[] = [];
      const falas: (import("../../src/contracts/ligacao.ts").FalaLigacao & { ligacaoId: string })[] = [];
      let consentimento: { versao: number | null; em: number | null } = { versao: null, em: null };
      const minhas = () => lista.filter((l) => l.tenantId === escopo.tenantId && l.ownerId === escopo.pessoaId);
      const sem = (l: L | undefined) => (l ? (({ ownerId: _o, tenantId: _t, ...r }) => r)(l) : null);
      return {
        async criar(n: import("../../src/repositories/ligacoes.repo.ts").NovaLigacao) {
          if (minhas().some((l) => l.estado === "chamando" || l.estado === "em_curso")) return null;
          const l: L = { ...n, id: randomUUID(), estado: "chamando", mensagemId: null, iniciadaEm: agora(), atendidaEm: null, encerradaEm: null, motivoFim: null, duracaoMs: null, religacoes: 0, trocas: 0, interrupcoes: 0, sttSegundos: 0, ttsCaracteres: 0, custoEstimadoUsd: null, latenciaP50Ms: null, latenciaP95Ms: null, avaliacao: null, transcricaoApagadaEm: null, resumida: false, ownerId: escopo.pessoaId, tenantId: escopo.tenantId };
          lista.push(l);
          return sem(l);
        },
        async buscar(id: string) { return sem(minhas().find((l) => l.id === id)); },
        async viva() { return sem(minhas().find((l) => l.estado === "chamando" || l.estado === "em_curso")); },
        async vivas() { return minhas().filter((l) => l.estado === "chamando" || l.estado === "em_curso").map((l) => sem(l)!); },
        async vincularMensagem(id: string, mensagemId: string) { const l = minhas().find((x) => x.id === id); if (l) l.mensagemId = mensagemId; },
        async atender(id: string, em: number) { const l = minhas().find((x) => x.id === id && (x.estado === "chamando" || x.estado === "em_curso")); if (!l) return null; l.estado = "em_curso"; l.atendidaEm ??= em; return sem(l); },
        async religou(id: string) { const l = minhas().find((x) => x.id === id); if (l) l.religacoes += 1; },
        async encerrar(id: string, p: { motivo: import("../../src/contracts/voz.ts").MotivoFimLigacao; agora: number }) {
          const l = minhas().find((x) => x.id === id && (x.estado === "chamando" || x.estado === "em_curso"));
          if (!l) return null;
          l.estado = l.atendidaEm === null ? "nao_atendida" : "encerrada";
          l.encerradaEm = p.agora;
          l.motivoFim = l.atendidaEm === null && ["pessoa_desligou", "cerebro_caiu", "midia_caiu"].includes(p.motivo) ? "nao_atendida" : p.motivo;
          l.duracaoMs = l.atendidaEm === null ? 0 : Math.max(0, p.agora - l.atendidaEm);
          return sem(l);
        },
        async marcarResumida(id: string) { const l = minhas().find((x) => x.id === id); if (l) l.resumida = true; },
        async duracaoDesde(desde: number) { return minhas().filter((l) => l.iniciadaEm >= desde && l.iniciadaPor === "pessoa").reduce((s, l) => s + (l.duracaoMs ?? 0), 0); },
        async gravarFala(f: import("../../src/repositories/ligacoes.repo.ts").NovaFala) { if (falas.some((x) => x.ligacaoId === f.ligacaoId && x.seq === f.seq)) return false; falas.push({ ligacaoId: f.ligacaoId, seq: f.seq, autor: f.autor, tipo: f.tipo, texto: f.texto, inicioMs: f.inicioMs, fimMs: f.fimMs, interrompida: f.interrompida }); return true; },
        async falas(ligacaoId: string) { return falas.filter((f) => f.ligacaoId === ligacaoId).sort((a, b) => a.seq - b.seq).map(({ ligacaoId: _l, ...r }) => r); },
        async ultimasFalas(ligacaoId: string, n: number) { return falas.filter((f) => f.ligacaoId === ligacaoId).sort((a, b) => a.seq - b.seq).slice(-n).map(({ ligacaoId: _l, ...r }) => r); },
        async apagarFalas(ligacaoId: string, em: number) { const antes = falas.length; for (let i = falas.length - 1; i >= 0; i--) if (falas[i]!.ligacaoId === ligacaoId) falas.splice(i, 1); const l = minhas().find((x) => x.id === ligacaoId); if (l) l.transcricaoApagadaEm = em; return antes - falas.length; },
        async avaliar(id: string, nota: "boa" | "ruim") { const l = minhas().find((x) => x.id === id); if (!l || (l.estado !== "encerrada" && l.estado !== "nao_atendida")) return false; l.avaliacao = nota; return true; },
        async consentimento() { return consentimento; },
        async consentir(versao: number, em: number) { consentimento = { versao, em }; },
        async atualizarLinha() { /* a linha vive em mensagens; o teste de unidade não a confere */ },
      };
    })(),
    liberacoesDispensadas: (() => {
      const prefixo = (agenteId: string) => `${escopo.tenantId}:${escopo.pessoaId}:${agenteId}:`;
      return {
        async doAgente(agenteId: string) {
          return Object.fromEntries([...b.liberacoesDispensadas].filter(([k]) => k.startsWith(prefixo(agenteId))).map(([k, em]) => [k.slice(prefixo(agenteId).length), em]));
        },
        async dispensar(agenteId: string, conectorIds: readonly string[], em: number) {
          const ids = [...new Set(conectorIds)];
          for (const id of ids) b.liberacoesDispensadas.set(prefixo(agenteId) + id, Math.max(b.liberacoesDispensadas.get(prefixo(agenteId) + id) ?? -Infinity, em));
          return ids.length;
        },
      };
    })(),
    frentes: (() => {
      const meus = () => b.lotes.filter((l) => l.tenantId === escopo.tenantId && l.ownerId === escopo.pessoaId);
      const semDonoLote = ({ tenantId: _t, ownerId: _d, ...l }: LoteDeFrentes & { tenantId: string; ownerId: string }): LoteDeFrentes => ({ ...l });
      return {
        async criarLote(n: NovoLote) {
          const linha = { tenantId: escopo.tenantId, ownerId: escopo.pessoaId, id: randomUUID(), agenteId: n.agenteId, abertoPorTurnoId: n.abertoPorTurnoId, trabalhoId: n.trabalhoId ?? null, avisarACadaUma: n.avisarACadaUma === true, retornoTurnoId: null, criadoEm: agora(), devolvidoEm: null };
          b.lotes.push(linha);
          return semDonoLote(linha);
        },
        async buscarLote(id: string) { const l = doTenant(b.lotes).find((x) => x.id === id); return l ? semDonoLote(l) : null; },
        async buscarLoteTravado(id: string) { const l = meus().find((x) => x.id === id); return l ? semDonoLote(l) : null; },
        async ligarAoLote(loteId: string, ids: readonly string[]) {
          const lote = doTenant(b.lotes).find((x) => x.id === loteId && x.devolvidoEm === null);
          if (!lote) return 0;
          const alvos = doTenant(b.trabalhos).filter((t) => ids.includes(t.id) && t.ownerId === escopo.pessoaId && t.agenteId === lote.agenteId && t.forma === "frente" && !t.loteId);
          for (const t of alvos) t.loteId = loteId;
          return alvos.length;
        },
        async gravarResumo(trabalhoId: string, resumo: ResumoFrente) {
          const t = doTenant(b.trabalhos).find((x) => x.id === trabalhoId && x.ownerId === escopo.pessoaId && x.forma === "frente");
          if (!t) return false;
          t.resumo = resumo;
          return true;
        },
        async frentesDoLote(loteId: string) {
          return doTenant(b.trabalhos).filter((t) => t.loteId === loteId).sort((x, y) => x.criadoEm - y.criadoEm)
            .map((t) => ({ id: t.id, titulo: t.titulo, estado: t.estado, resumo: t.resumo ?? null, terminadoEm: t.terminadoEm, deFora: t.origem === "colega", motivo: null, quedas: 0 }));
        },
        // ADR-099 (I9): a consulta das frentes caídas se prova no Postgres (tests/integration/frentes-caidas.test.ts).
        async frentesCaidas() {
          return [];
        },
        async lotesAbertosPor(ids: readonly string[]) {
          return doTenant(b.lotes).filter((l) => ids.includes(l.abertoPorTurnoId)).sort((x, y) => x.criadoEm - y.criadoEm).map(semDonoLote);
        },
        async marcarDevolvido(loteId: string, retornoTurnoId: string | null, em: number) {
          const l = meus().find((x) => x.id === loteId && x.devolvidoEm === null);
          if (!l) return null;
          l.devolvidoEm = em;
          l.retornoTurnoId = retornoTurnoId;
          return semDonoLote(l);
        },
        async loteDoRetorno(retornoTurnoId: string) {
          const l = meus().find((x) => x.retornoTurnoId === retornoTurnoId);
          return l ? semDonoLote(l) : null;
        },
        async trocarRetorno(loteId: string, retornoTurnoId: string) {
          const l = meus().find((x) => x.id === loteId && x.devolvidoEm !== null);
          if (!l) return false;
          l.retornoTurnoId = retornoTurnoId;
          return true;
        },
      };
    })(),
    // ADR-099 (I10): o estado do dono se prova no Postgres (tests/integration/estado-do-dono.test.ts); aqui, as frentes
    // vivas e as decisões abertas, o bastante para o estado principal.
    donos: {
      async fatos(agenteIds: readonly string[]) {
        const vivos = doTenant(b.turnos).filter((t) => agenteIds.includes(t.agenteId) && t.estado === "despachando");
        const decisoes = new Map<string, { quantas: number; desde: number }>();
        for (const d of doTenant(b.decisoes).filter((x) => agenteIds.includes(x.agenteId) && (x.estado === "pendente" || x.estado === "reaberta"))) {
          const atual = decisoes.get(d.agenteId);
          const em = Date.parse(d.criadoEm);
          decisoes.set(d.agenteId, { quantas: (atual?.quantas ?? 0) + 1, desde: Math.min(atual?.desde ?? em, em) });
        }
        return {
          vivos: new Map(vivos.filter((t) => !t.trabalhoId).map((t) => [t.agenteId, t.criadoEm])),
          vivosPropria: new Map(vivos.filter((t) => !t.trabalhoId && doTenant(b.conversas).some((c) => c.id === t.conversaId && c.tipo === "propria")).map((t) => [t.agenteId, t.criadoEm])),
          frentesVivas: new Set(vivos.flatMap((t) => (t.trabalhoId ? [t.trabalhoId] : []))),
          decisoes,
          comandos: [],
          voltas: [],
          colegas: [],
          fila: [],
        };
      },
    },
    // ADR-099 (I7 revista): os pedidos entre bots na triagem do dono. A trava e as quedas se provam no Postgres
    // (tests/integration/fila-triagem.test.ts, tests/concurrency/pedidos-cruzados.test.ts); aqui, o mínimo para a regra.
    pedidosDeColega: {
      async travar() {},
      async abertos(desde: number, filtro: { de?: string } = {}): Promise<PedidoAberto[]> {
        const ms = doTenant(b.mensagens);
        const fechado = (id: unknown) => typeof id === "string" && doTenant(b.trabalhos).some((t) => t.id === id && ["terminado", "parado", "falhou"].includes(t.estado));
        const handoffs = ms.flatMap((m) => (m.payload?.kind === "handoff" && m.payload.tarefaId && m.criadoEm >= desde && !fechado(m.payload.trabalhoId)
          && !ms.some((r) => r.conversaId === m.conversaId && r.payload?.kind === "peer_ask" && r.payload.tarefaId === (m.payload?.kind === "handoff" ? m.payload.tarefaId : null))
          ? [{ de: m.payload.de, para: m.payload.para, tarefaId: m.payload.tarefaId, criadoEm: m.criadoEm, texto: m.payload.motivo }] : []));
        const frentes = doTenant(b.trabalhos)
          .filter((t) => t.pedidoPorAgenteId && ["na_fila", "rodando", "precisa_de_voce", "fechado_ocioso"].includes(t.estado))
          .map((t) => ({ de: t.pedidoPorAgenteId as string, para: t.agenteId, tarefaId: null, criadoEm: t.criadoEm, texto: null }));
        return [...handoffs, ...frentes].filter((p) => filtro.de === undefined || p.de === filtro.de);
      },
      async livres(ids: readonly string[], em: number) {
        return ids.filter((id) => !doTenant(b.turnos).some((t) => t.agenteId === id && (t.estado === "despachando" || (t.estado === "pendente" && (t.acordarEm == null || t.acordarEm <= em)))));
      },
      async frentesAbertasDosTurnos(turnoIds: readonly string[]) {
        const lotes = doTenant(b.lotes).filter((l) => turnoIds.includes(l.abertoPorTurnoId) && l.devolvidoEm === null).map((l) => l.id);
        return doTenant(b.trabalhos).filter((t) => t.loteId && lotes.includes(t.loteId) && ["na_fila", "rodando", "precisa_de_voce", "fechado_ocioso"].includes(t.estado)).length;
      },
      async esperasRodandoDosTurnos(turnoIds: readonly string[]) {
        return doTenant(b.esperas).filter((e) => turnoIds.includes(e.turnoId) && e.estado === "rodando").length;
      },
      async triagensParadas() {
        return [];
      },
    },
    // Chat limpo (PR 1): a Atividade é consulta de faixa e de índice no Postgres (tests/integration/atividade.test.ts).
    atividade: {
      faixaDoDia: soNoPostgres,
      mensagens: soNoPostgres,
      contarMensagens: soNoPostgres,
      negacoesDeConector: soNoPostgres,
      contarNegacoesDeConector: soNoPostgres,
      trabalhos: soNoPostgres,
      contarTrabalhos: soNoPostgres,
    },
  } satisfies Repos;

  return repos;
}
