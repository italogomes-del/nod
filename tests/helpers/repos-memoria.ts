import type { ConfigGithubApp } from "../../src/repositories/github-app.repo.ts";
import type { MimeAnexo } from "../../src/contracts/anexo.ts";
import type { ComposicaoRaioX, ExecucaoRaioX, Preferencias } from "../../src/contracts/raio-x.ts";
import type { CatalogoDeComandos } from "../../src/contracts/comandos.ts";
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
import type { ExecucaoRotina, Rotina } from "../../src/contracts/rotina.ts";
import type { MembroSala, Sala } from "../../src/contracts/sala.ts";
import type { Relato } from "../../src/contracts/relato.ts";
import type { Turno } from "../../src/contracts/turno.ts";
import type { LinhaTrilha } from "../../src/db/schema/trilha.ts";
import { ORCAMENTO_INICIAL } from "../../src/domain/canal-orcamento.ts";
import type { ConectorGuardado } from "../../src/repositories/conectores.repo.ts";
import type { EventoGravavel } from "../../src/repositories/events.repo.ts";
import type { Gasto } from "../../src/repositories/gastos.repo.ts";
import type { ItemOutbox } from "../../src/repositories/outbox.repo.ts";
import type { Parada } from "../../src/repositories/paradas.repo.ts";
import type { Pessoa } from "../../src/repositories/pessoas.repo.ts";
import type { JanelaReivindicada } from "../../src/repositories/rotina-janelas.repo.ts";
import type { Repos } from "../../src/repositories/tipos.ts";
import { EXECUCOES_GUARDADAS, LEASE_MS } from "../../src/shared/constantes.ts";
import type { Escopo } from "../../src/shared/types.ts";
import { PESSOA_MARLON, TENANT_LEAPY } from "./ids.ts";

/**
 * `Repos` em memória para tests/unit/use-cases (Leapy §1: a fábrica de tx vira `(fn) => fn({} as never)`
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
  conversas: Conversa[];
  mensagens: Mensagem[];
  anexos: { tenantId: string; ownerId: string; id: string; conversaId: string; mensagemId: string | null; nome: string; mime: MimeAnexo; bytes: Buffer; criadoEm: number }[];
  /** ADR-051 (0031): artefato, versões e o estado por pessoa (UNIQUE tenant+artefato+owner reproduzido). */
  artefatos: (Artefato & { tenantId: string; ownerId: string })[];
  artefatoVersoes: (VersaoArtefato & { tenantId: string; ownerId: string })[];
  artefatoEstados: (EstadoArtefato & { tenantId: string; ownerId: string; json: string })[];
  propostas: Proposta[];
  turnos: Turno[];
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
  /** 0036: o Raio-X de cada turno e as preferências de cada pessoa (chave tenant:pessoa). */
  raioX: Map<string, { composicao: ComposicaoRaioX | null; execucao: ExecucaoRaioX | null }>;
  preferencias: Map<string, Preferencias>;
  /** 0038: o catálogo do "/" de cada pessoa (chave tenant:pessoa). */
  comandos: Map<string, { catalogo: CatalogoDeComandos; em: number }>;
  /** 0039: o "lido até" de cada pessoa em cada conversa (chave tenant:pessoa:conversa). */
  leituras: Map<string, number>;
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
  trilha: LinhaTrilha[];
  paradas: (Parada & { tenantId: string })[];
  catcher: { tenantId: string; id: string; turnoId: string; tipo: string; dados: Record<string, unknown>; em: number }[];
  events: (EventoGravavel & { tenantId: string; id: string; createdAt: number })[];
  outbox: (ItemOutbox & { tenantId: string; ownerId: string; entregueEm: number | null; abandonadoEm: number | null; canceladoEm: number | null })[];
  maquinaTokens: { tenantId: string; ownerId: string; id: string; nome: string; prefixo: string; hash: Buffer; criadaEm: number; ultimoUsoEm: number | null; expiraEm: number | null; revogadaEm: number | null }[];
};

export function criarBancoMemoria(): { banco: BancoMemoria; repos(escopo?: Escopo): Repos } {
  const banco: BancoMemoria = {
    pessoas: [],
    agentes: [],
    geracoes: new Map(),
    memorias: [],
    conversas: [],
    mensagens: [],
    anexos: [],
    artefatos: [],
    artefatoVersoes: [],
    artefatoEstados: [],
    propostas: [],
    turnos: [],
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
    raioX: new Map(),
    preferencias: new Map(),
    comandos: new Map(),
    leituras: new Map(),
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
    trilha: [],
    paradas: [],
    catcher: [],
    events: [],
    outbox: [],
    maquinaTokens: [],
  };
  return { banco, repos: (escopo = { tenantId: TENANT_LEAPY, pessoaId: PESSOA_MARLON }) => reposSobre(banco, escopo) };
}

/** Atalho: um banco novo e a visão da pessoa dada (default Marlon na Leapy). */
export function reposMemoria(escopo?: Escopo): Repos {
  return criarBancoMemoria().repos(escopo);
}

const agora = () => Date.now();
const iso = (n: number) => new Date(n).toISOString();
const semDono = (l: Artefato & { tenantId: string; ownerId: string }): Artefato => ({ id: l.id, agenteId: l.agenteId, conversaId: l.conversaId, titulo: l.titulo, versaoAtual: l.versaoAtual, criadoEm: l.criadoEm, atualizadoEm: l.atualizadoEm });

function reposSobre(b: BancoMemoria, escopo: Escopo): Repos {
  const doTenant = <T extends { tenantId: string }>(lista: T[]) => lista.filter((x) => x.tenantId === escopo.tenantId);
  /** A linha do índice único propostas_acesso_de_rotina_aberta (0026): pedido de rotina pendente por (dona, agente, app). */
  const acessoDeRotinaAberto = (agenteId: string, conector: string): Proposta | null =>
    doTenant(b.propostas).find((p) => p.agenteId === agenteId && p.estado === "pendente" && p.payload.kind === "acesso" && p.payload.conector === conector && p.payload.rotinaId !== undefined) ?? null;

  const repos = {
    computadores: {
      buscarVinculo: async () => null,
      obter: async () => null, travar: async () => null, configurar: async () => undefined,
      ocupar: async () => undefined, liberar: async () => undefined, atividade: async () => [],
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
      async cancelarPendentesDaPessoa(em: number) {
        let n = 0;
        for (const o of doTenant(b.outbox)) {
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
      async excluir(id, em) {
        const a = doTenant(b.agentes).find((a) => a.id === id && a.ownerId === escopo.pessoaId && !a.excluidoEm);
        if (!a) return null;
        a.excluidoEm = em;
        a.fixado = false;
        b.geracoes.set(id, (b.geracoes.get(id) ?? 0) + 1);
        for (const r of doTenant(b.rotinas).filter((r) => r.agenteId === id)) r.estado = "pausada";
        b.concessoes = b.concessoes.filter((c) => c.agenteId !== id);
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
          modelo: a.modelo,
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
          .sort((x, y) => Number(y.fixado) - Number(x.fixado) || x.criadoEm - y.criadoEm);
      },
      async atualizarPerfil(id, perfil) {
        const a = doTenant(b.agentes).find((x) => x.id === id);
        if (!a) return null;
        Object.assign(a, {
          nome: perfil.nome ?? a.nome,
          titulo: perfil.titulo ?? a.titulo,
          descricao: perfil.descricao ?? a.descricao,
          confirmado: perfil.confirmado ?? a.confirmado,
          modelo: perfil.modelo ?? a.modelo,
          forma: perfil.forma ?? a.forma,
          cor: perfil.cor ?? a.cor,
          // 0037: null volta ao padrão do modelo; ausente não mexe (o coalesce não serve aqui).
          esforco: perfil.esforco === undefined ? a.esforco ?? null : perfil.esforco,
        });
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
        return true;
      },
      async atualizarSessaoCli(id, sessaoCli, sessaoExecutor = null, sessaoHarness = null) {
        const c = doTenant(b.conversas).find((x) => x.id === id);
        if (!c) return false;
        c.sessaoCli = sessaoCli;
        c.sessaoExecutor = sessaoCli ? sessaoExecutor : null;
        c.sessaoHarness = sessaoCli ? sessaoHarness : null;
        c.sessaoEm = sessaoCli ? agora() : null;
        return true;
      },
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
        return mensagem;
      },
      async buscar(id) {
        return doTenant(b.mensagens).find((m) => m.id === id) ?? null;
      },
      async listarDaConversa(conversaId, limite = 200) {
        const todas = doTenant(b.mensagens).filter((m) => m.conversaId === conversaId).sort((x, y) => x.criadoEm - y.criadoEm);
        return todas.slice(Math.max(0, todas.length - limite));
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
      async pedidoDaTarefa(turnoId) {
        return doTenant(b.mensagens).filter((m) => m.turnoId === turnoId && m.payload?.kind === "peer_pedido").sort((x, y) => x.criadoEm - y.criadoEm)[0] ?? null;
      },
      async marcarParcial(id, parcial) {
        const m = doTenant(b.mensagens).find((x) => x.id === id);
        if (!m) return false;
        m.parcial = parcial;
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
    },

    turnos: {
      async buscarTravado(id: string) {
        return doTenant(b.turnos).find((t) => t.id === id) ?? null;
      },
      async travarRetomadas() {
        // Em memória tudo roda em série: não há o que travar.
      },
      async retomadaNaFila(retomaTurnoId: string) {
        return doTenant(b.turnos).filter((t) => t.ownerId === escopo.pessoaId && t.retomaTurnoId === retomaTurnoId && t.origem === "retomada" && t.estado === "pendente").sort((x, y) => y.criadoEm - x.criadoEm)[0] ?? null;
      },
      async juntarEntrada(id: string, texto: string) {
        const t = doTenant(b.turnos).find((x) => x.id === id && x.ownerId === escopo.pessoaId && x.estado === "pendente");
        if (!t) return null;
        t.entradaTexto = `${t.entradaTexto}\n\n${texto}`;
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
          criadoEm: agora() + b.turnos.length / 1000,
          mensagemOrigemId: t.mensagemOrigemId ?? null,
          absorvidoPor: null,
          sobProcuracaoDe: t.sobProcuracaoDe ?? null,
        };
        b.turnos.push(turno);
        return turno;
      },
      async buscar(id) {
        return doTenant(b.turnos).find((t) => t.id === id) ?? null;
      },
      async reivindicar(p) {
        const vivos = doTenant(b.turnos);
        const candidatos = vivos
          .filter((t) => t.ownerId === escopo.pessoaId && t.estado === "pendente")
          .filter((t) => !vivos.some((d) => d.estado === "despachando" && (d.conversaId === t.conversaId || d.agenteId === t.agenteId)))
          .sort((x, y) => Number(x.origem === "rotina") - Number(y.origem === "rotina") || x.criadoEm - y.criadoEm);
        const t = candidatos[0];
        if (!t) return null;
        t.estado = "despachando";
        t.machineId = p.machineId;
        t.leaseAte = p.agora + LEASE_MS;
        t.sinais = { ...t.sinais, attempted: true };
        return t;
      },
      async renovarLease(id, machineId, sinais, em) {
        const t = doTenant(b.turnos).find((x) => x.id === id && x.machineId === machineId);
        if (!t) return { ativo: false };
        t.sinais = {
          attempted: t.sinais.attempted || !!sinais.attempted,
          rejected: t.sinais.rejected || !!sinais.rejected,
          promptSubmitted: t.sinais.promptSubmitted || !!sinais.promptSubmitted,
          producedOutput: t.sinais.producedOutput || !!sinais.producedOutput,
        };
        const ativo = t.estado === "despachando" && t.pararSolicitadoEm === null;
        if (ativo) t.leaseAte = em + LEASE_MS;
        return { ativo };
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
        return totais.length === 0 ? null : Math.max(...totais);
      },
      async interromper(id, motivo) {
        const t = doTenant(b.turnos).find((x) => x.id === id && (x.estado === "pendente" || x.estado === "despachando"));
        if (!t) return null;
        t.estado = "interrompido";
        t.motivoInterrupcao = motivo;
        t.leaseAte = null;
        return t;
      },
      async absorverPendentes(turno, entrada) {
        if (!turno.mensagemOrigemId || (turno.origem !== "conversa" && turno.origem !== "sala")) return { turno, absorvidos: [] };
        const absorvidos = doTenant(b.turnos)
          .filter((t) => t.id !== turno.id && t.conversaId === turno.conversaId && t.agenteId === turno.agenteId && t.estado === "pendente" && (t.origem === "conversa" || t.origem === "sala") && t.mensagemOrigemId)
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
        return doTenant(b.turnos).filter((t) => t.ownerId === escopo.pessoaId && t.estado === "pendente" && (!conversaId || t.conversaId === conversaId));
      },
      async vivosDaConversa(conversaId) {
        return doTenant(b.turnos).filter((t) => t.conversaId === conversaId && (t.estado === "pendente" || t.estado === "despachando"));
      },
      async pendentesRenderizaveis(conversaId) {
        const todos = doTenant(b.turnos);
        const saida: { id: string; motivo: "agente_ocupado_em"; conversaId: string }[] = [];
        for (const p of todos.filter((t) => t.conversaId === conversaId && t.estado === "pendente")) {
          const ocupado = todos.find((d) => d.estado === "despachando" && d.agenteId === p.agenteId) ?? todos.find((d) => d.estado === "despachando" && d.conversaId === p.conversaId);
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
          .map((d) => ({ ...d, agenteNome: b.agentes.find((a) => a.id === d.agenteId)?.nome ?? "agente" }));
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
        const d = doTenant(b.decisoes).find((x) => x.id === id && (x.estado === "pendente" || x.estado === "reaberta"));
        if (!d) return null;
        d.estado = "decidida";
        d.desfecho = { tipo: "decidida_por_regra", regra: p.regra, regraVersao: p.regraVersao, em: new Date(p.agora).toISOString() };
        d.decididaEm = p.agora;
        return d;
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
        };
        b.rotinas.push(rotina);
        return rotina;
      },
      async buscar(id) {
        return doTenant(b.rotinas).find((r) => r.id === id) ?? null;
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
      async turnoAberto(rotinaId) {
        const abertas = doTenant(b.janelas)
          .filter((j) => j.rotinaId === rotinaId && j.turnoId !== null)
          .filter((j) => ["pendente", "despachando"].includes(doTenant(b.turnos).find((t) => t.id === j.turnoId)?.estado ?? ""))
          .sort((x, y) => y.instanteAgendado - x.instanteAgendado);
        return abertas[0]?.turnoId ?? null;
      },
    },

    rotinaExecucoes: {
      async registrar(e) {
        const exec: ExecucaoRotina = { tenantId: escopo.tenantId, id: e.id ?? randomUUID(), rotinaId: e.rotinaId, instanteAgendado: e.instanteAgendado, turnoId: e.turnoId ?? null, desfecho: e.desfecho, motivo: e.motivo ?? null, em: e.em };
        b.execucoes.push(exec);
        return exec;
      },
      async atualizarDesfecho(id, desfecho, motivo = null, em) {
        const e = doTenant(b.execucoes).find((x) => x.id === id);
        if (!e) return null;
        e.desfecho = desfecho;
        e.motivo = motivo;
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

    relatos: {
      async criar(r) {
        const relato: Relato = {
          tenantId: escopo.tenantId,
          id: randomUUID(),
          mensagemId: r.mensagemId,
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
          .map(({ id, nome, prefixo, criadaEm, ultimoUsoEm, revogadaEm }) => ({ id, nome, prefixo, criadaEm, ultimoUsoEm, revogadaEm }));
      },
      async revogar(id, em) {
        const l = b.maquinaTokens.find((x) => x.tenantId === escopo.tenantId && x.ownerId === escopo.pessoaId && x.id === id);
        if (!l) return false;
        l.revogadaEm ??= em;
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
        const com = doTenant(b.turnos).filter((t) => t.conversaId === conversaId && t.criadoEm >= desde && t.custoUsd !== null);
        return { custoUsd: com.reduce((s, t) => s + (t.custoUsd ?? 0), 0), turnos: com.length };
      },
    },
    preferencias: {
      async buscar() {
        return b.preferencias.get(`${escopo.tenantId}:${escopo.pessoaId}`) ?? { modoDev: false };
      },
      async gravar(p) {
        b.preferencias.set(`${escopo.tenantId}:${escopo.pessoaId}`, { modoDev: p.modoDev });
        return { modoDev: p.modoDev };
      },
    },
    comandos: {
      async gravar(catalogo) {
        b.comandos.set(`${escopo.tenantId}:${escopo.pessoaId}`, { catalogo, em: agora() });
      },
      async buscar() {
        return b.comandos.get(`${escopo.tenantId}:${escopo.pessoaId}`) ?? null;
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
  } satisfies Repos;

  return repos;
}
