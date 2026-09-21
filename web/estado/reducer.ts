import type { ChaveEmitidaDto, ChaveMaquinaDto, ConversaDto, FrotaDto, RotinaDto, SuaVezDto } from "../../src/contracts/api.ts";
import type { Concessao } from "../../src/contracts/concessao.ts";
import type { Conector } from "../../src/contracts/conector.ts";
import type { EstadoExecutor } from "../../src/contracts/executor.ts";
import type { FrameSse, TipoFrame } from "../../src/contracts/frame.ts";
import type { Inventario } from "../../src/contracts/inventario.ts";
import type { AppComLogo } from "../../src/contracts/marketplace.ts";
import type { Memoria } from "../../src/contracts/memoria.ts";
import type { Negacao } from "../../src/contracts/negacao.ts";
import type { ExecucaoRotina } from "../../src/contracts/rotina.ts";
import type { Relato } from "../../src/contracts/relato.ts";
import type { MembroSala, Sala } from "../../src/contracts/sala.ts";
import type { FaixaParada } from "../../src/contracts/turno.ts";
import type { Escopo } from "../../src/shared/types.ts";
import type { EstadoConexao } from "../lib/live-events.ts";

/**
 * Estado da web (ADR-020: a web decide, nunca executa; ADR-029: todo fail-closed vira estado
 * escrito). O servidor é a fonte da verdade: um frame SSE (ADR-016) NÃO carrega o conteúdo — ele
 * diz o que mudou (kind, conversaId, turnoId) e o reducer marca o que precisa ser REIDRATADO por
 * REST (`invalidacoes`); só os deltas de turno (efêmeros) entram direto no estado. Nada aqui lê
 * Date.now(): `agora` chega pela ação `tick`.
 */
export type Tela =
  | { tipo: "frota" }
  | { tipo: "conversa"; conversaId: string; agenteId: string }
  | { tipo: "sala"; salaId: string; conversaId: string }
  | { tipo: "gestao" }
  | { tipo: "perfil"; agenteId: string }
  | { tipo: "memoria"; agenteId: string }
  | { tipo: "rotinas" }
  | { tipo: "nova-rotina"; agenteId?: string }
  | { tipo: "novo-bot" }
  | { tipo: "conectores"; app?: string; voltar?: { tipo: "conversa"; conversaId: string; agenteId: string } | { tipo: "sala"; salaId: string; conversaId: string } }
  | { tipo: "sua-vez" }
  | { tipo: "nova-sala" }
  | { tipo: "chaves" }
  | { tipo: "relatos" }
  /** Configuração da conta: conexão, computadores e administração (substituiu o rail em 2026-09-18). */
  | { tipo: "espaco" };

export type TurnoVivo = { turnoId: string; conversaId: string; estado: "na_fila" | "rodando"; executor: string | null; machineId: string | null; desde: number };

export type ConversaEstado = ConversaDto & {
  /** Texto em streaming por turno (turno.delta), descartado ao encerrar. */
  deltas: Record<string, string>;
  carregadaEm: number;
};

export type NegacaoVista = Negacao & { conversaId: string | null; vistaEm: number };

export type Invalidacao = "gestao" | "frota" | "sua-vez" | "rotinas" | "conectores" | "inventario" | "executor" | "salas" | "chaves" | "relatos" | `conversa:${string}` | `memoria:${string}` | `concessoes:${string}` | `execucoes:${string}`;

export type Estado = {
  sessao: Escopo | null;
  tela: Tela;
  frota: FrotaDto | null;
  gestao?: FrotaDto | null;
  inventario: Inventario | null;
  /** Interruptor de executor da máquina (catcher ⇄ claude-cli): estado escrito de cada opção e a última recusa. */
  executor: EstadoExecutor | null;
  conversas: Record<string, ConversaEstado>;
  turnosVivos: Record<string, TurnoVivo>;
  salas: { sala: Sala; membros: MembroSala[] }[];
  suaVez: SuaVezDto | null;
  rotinas: RotinaDto[];
  execucoes: Record<string, ExecucaoRotina[]>;
  conectores: Conector[];
  marketplace: AppComLogo[];
  composioConfigurado: boolean;
  autorizacaoApp: { slug: string; url: string } | null;
  avisoConexao: string | null;
  concessoes: Record<string, Concessao[]>;
  memorias: Record<string, Memoria[]>;
  /** Minhas chaves de máquina (ADR-031); null = ainda não carregou. */
  chaves: ChaveMaquinaDto[] | null;
  /** Relatos de comportamento indesejado (ADR-041); null = ainda não carregou. */
  relatos: Relato[] | null;
  /**
   * A chave crua recém-emitida: mostrada UMA vez e descartada ao sair da tela. Fica só na memória da
   * aba — nunca em storage — e o servidor não tem como mostrá-la de novo.
   */
  chaveEmitida: ChaveEmitidaDto | null;
  negacoes: NegacaoVista[];
  faixaParada: FaixaParada | null;
  conexao: { estado: EstadoConexao; tentativa: number; proximaEmMs: number | null };
  /** O que a próxima volta do main precisa buscar por REST (conjunto, sem duplicata). */
  invalidacoes: Invalidacao[];
  agora: number;
  erro: { codigo: string; mensagem: string; correlationId?: string | null } | null;
  ocupado: boolean;
};

export type Acao =
  | { tipo: "autorizacao-app"; slug: string; url: string }
  | { tipo: "aviso-conexao"; texto: string | null }
  | { tipo: "sessao"; escopo: Escopo | null }
  | { tipo: "navegar"; tela: Tela }
  | { tipo: "tick"; agora: number }
  | { tipo: "conexao"; estado: EstadoConexao; tentativa: number; proximaEmMs: number | null }
  | { tipo: "frame"; frame: FrameSse; agora: number }
  | { tipo: "hidratar-gestao"; gestao: FrotaDto }
  | { tipo: "hidratar-frota"; frota: FrotaDto }
  | { tipo: "hidratar-inventario"; inventario: Inventario }
  | { tipo: "hidratar-executor"; executor: EstadoExecutor }
  | { tipo: "hidratar-conversa"; conversa: ConversaDto; agora: number }
  | { tipo: "hidratar-sua-vez"; suaVez: SuaVezDto }
  | { tipo: "hidratar-rotinas"; rotinas: RotinaDto[] }
  | { tipo: "hidratar-execucoes"; rotinaId: string; execucoes: ExecucaoRotina[] }
  | { tipo: "hidratar-conectores"; conectores: Conector[]; marketplace?: AppComLogo[]; composioConfigurado?: boolean }
  | { tipo: "hidratar-concessoes"; agenteId: string; concessoes: Concessao[] }
  | { tipo: "hidratar-memorias"; agenteId: string; memorias: Memoria[] }
  | { tipo: "hidratar-salas"; salas: { sala: Sala; membros: MembroSala[] }[] }
  | { tipo: "hidratar-chaves"; chaves: ChaveMaquinaDto[] }
  | { tipo: "hidratar-relatos"; relatos: Relato[] }
  | { tipo: "chave-emitida"; emitida: ChaveEmitidaDto | null }
  | { tipo: "faixa"; faixa: FaixaParada | null }
  | { tipo: "invalidar"; quais: Invalidacao[] }
  | { tipo: "invalidacoes-tratadas"; quais: Invalidacao[] }
  | { tipo: "erro"; erro: { codigo: string; mensagem: string; correlationId?: string | null } | null }
  | { tipo: "ocupado"; valor: boolean };

export const estadoInicial: Estado = {
  sessao: null,
  tela: { tipo: "frota" },
  frota: null,
  inventario: null,
  executor: null,
  conversas: {},
  turnosVivos: {},
  salas: [],
  suaVez: null,
  rotinas: [],
  execucoes: {},
  conectores: [],
  marketplace: [],
  composioConfigurado: false,
  autorizacaoApp: null,
  avisoConexao: null,
  concessoes: {},
  memorias: {},
  chaves: null,
  relatos: null,
  chaveEmitida: null,
  negacoes: [],
  faixaParada: null,
  conexao: { estado: "parado", tentativa: 0, proximaEmMs: null },
  invalidacoes: [],
  agora: 0,
  erro: null,
  ocupado: false,
};

function texto(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

function invalidar(estado: Estado, ...quais: (Invalidacao | null)[]): Estado {
  const novas = quais.filter((q): q is Invalidacao => q !== null && !estado.invalidacoes.includes(q));
  return novas.length === 0 ? estado : { ...estado, invalidacoes: [...estado.invalidacoes, ...novas] };
}

function semTurnoVivo(estado: Estado, turnoId: string | null): Estado {
  if (!turnoId || !estado.turnosVivos[turnoId]) return estado;
  const turnosVivos = { ...estado.turnosVivos };
  delete turnosVivos[turnoId];
  return { ...estado, turnosVivos };
}

function semDelta(estado: Estado, conversaId: string | null, turnoId: string | null): Estado {
  if (!conversaId || !turnoId) return estado;
  const c = estado.conversas[conversaId];
  if (!c || !(turnoId in c.deltas)) return estado;
  const deltas = { ...c.deltas };
  delete deltas[turnoId];
  return { ...estado, conversas: { ...estado.conversas, [conversaId]: { ...c, deltas } } };
}

/** Um handler por TipoFrame — a tabela é TOTAL: um tipo novo no contrato não compila sem entrar aqui. */
type Handler = (estado: Estado, frame: FrameSse, agora: number) => Estado;

const conv = (f: FrameSse): Invalidacao | null => {
  const id = texto(f.dados.conversaId);
  return id ? `conversa:${id}` : null;
};

const POR_FRAME: Record<TipoFrame, Handler> = {
  "mensagem.nova": (e, f) => invalidar(e, conv(f)),
  "turno.iniciado": (e, f, agora) => {
    const turnoId = texto(f.dados.turnoId);
    const conversaId = texto(f.dados.conversaId);
    if (!turnoId || !conversaId) return invalidar(e, conv(f));
    // dados.kind distingue "na fila" (turno_criado) de "rodando" (turno_despachado) — pendência L8 §5.
    const estado = f.dados.kind === "turno_despachado" ? "rodando" : "na_fila";
    const anterior = e.turnosVivos[turnoId];
    const vivo: TurnoVivo = { turnoId, conversaId, estado, executor: texto(f.dados.executor) ?? anterior?.executor ?? null, machineId: texto(f.dados.machine_id) ?? anterior?.machineId ?? null, desde: anterior?.desde ?? agora };
    return invalidar({ ...e, turnosVivos: { ...e.turnosVivos, [turnoId]: vivo } }, conv(f));
  },
  "turno.delta": (e, f) => {
    const turnoId = texto(f.dados.turnoId);
    const conversaId = texto(f.dados.conversaId);
    const trecho = typeof f.dados.texto === "string" ? f.dados.texto : "";
    if (!turnoId || !conversaId) return e;
    const c = e.conversas[conversaId];
    const vivo = e.turnosVivos[turnoId];
    const turnosVivos = vivo && vivo.estado !== "rodando" ? { ...e.turnosVivos, [turnoId]: { ...vivo, estado: "rodando" as const } } : e.turnosVivos;
    if (!c) return { ...e, turnosVivos };
    return { ...e, turnosVivos, conversas: { ...e.conversas, [conversaId]: { ...c, deltas: { ...c.deltas, [turnoId]: (c.deltas[turnoId] ?? "") + trecho } } } };
  },
  "turno.encerrado": (e, f) => invalidar(semDelta(semTurnoVivo(e, texto(f.dados.turnoId)), texto(f.dados.conversaId), texto(f.dados.turnoId)), conv(f), "frota"),
  "turno.interrompido": (e, f) => invalidar(semDelta(semTurnoVivo(e, texto(f.dados.turnoId)), texto(f.dados.conversaId), texto(f.dados.turnoId)), conv(f), "frota", "sua-vez"),
  "decisao.nova": (e, f) => invalidar(e, "sua-vez", conv(f)),
  "decisao.decidida": (e, f) => invalidar(e, "sua-vez", conv(f)),
  "decisao.vencida": (e, f) => invalidar(e, "sua-vez", conv(f)),
  "proposta.nova": (e, f) => invalidar(e, conv(f)),
  "rotina.criada": (e, f) => invalidar(e, "rotinas", conv(f)),
  "rotina.executou": (e, f) => {
    const rotinaId = texto(f.dados.rotinaId) ?? texto(f.dados.rotina_id);
    return invalidar(e, "rotinas", conv(f), rotinaId ? `execucoes:${rotinaId}` : null);
  },
  "sala.handoff": (e, f) => invalidar(e, conv(f)),
  negacao: (e, f, agora) => {
    const classe = f.dados.classe;
    const motivo = f.dados.motivo;
    const nome = texto(f.dados.nome) ?? texto(f.dados.ferramenta) ?? "(sem nome)";
    const valida = (classe === "ferramenta_negada" || classe === "conector_indisponivel" || classe === "plano_ausente") && typeof motivo === "string";
    if (!valida) return invalidar(e, conv(f));
    const vista: NegacaoVista = { classe, nome, motivo: motivo as Negacao["motivo"], desde: typeof f.dados.desde === "number" ? f.dados.desde : agora, terminal: f.dados.terminal === true, conversaId: texto(f.dados.conversaId), vistaEm: agora };
    // definido em 2026-09-16: as 20 mais recentes bastam na tela; o registro completo está na trilha.
    return invalidar({ ...e, negacoes: [vista, ...e.negacoes].slice(0, 20) }, conv(f));
  },
  "computador.mudou": (e) => e,
  "inventario.mudou": (e) => invalidar(e, "inventario", "frota", "executor"),
  "agente.mudou": (e, f) => {
    const agenteId = texto(f.dados.agente_id) ?? texto(f.dados.agenteId);
    const memoria: Invalidacao | null = f.dados.acao === "memoria_criada" && agenteId ? `memoria:${agenteId}` : null;
    const concessoes: Invalidacao | null = f.dados.kind === "concessao_criada" && agenteId ? `concessoes:${agenteId}` : null;
    return invalidar(e, "frota", "gestao", ...(["excluir", "restaurar", "duplicado"].includes(String(f.dados.acao)) ? ["rotinas", "salas", "sua-vez"] as const : []), conv(f), memoria, concessoes);
  },
  "parada.faixa": (e, f) => {
    const faixa: FaixaParada = {
      interrompidas: typeof f.dados.interrompidas === "number" ? f.dados.interrompidas : 0,
      naoInterrompidas: [],
      jaEntregues: [],
      nadaRodando: f.dados.nada_rodando === true,
    };
    return invalidar({ ...e, faixaParada: faixa }, conv(f));
  },
  // O relato é registro, não estado vivo da conversa: nada na timeline muda, então nada se invalida.
  // A tela de relatos recarrega quando é aberta (definido em 2026-09-21).
  "relato.criado": (e) => e,
  resumed: (e, f) => (f.dados.resumed === true ? e : invalidar(e, "frota", "sua-vez", "rotinas", "conectores", "inventario", "executor", "salas", ...Object.keys(e.conversas).map((id): Invalidacao => `conversa:${id}`))),
};

export function aplicarFrame(estado: Estado, frame: FrameSse, agora: number): Estado {
  const handler = POR_FRAME[frame.tipo];
  return handler ? handler(estado, frame, agora) : estado;
}

export function reduzir(estado: Estado, acao: Acao): Estado {
  switch (acao.tipo) {
    case "sessao":
      // Trocou a pessoa: chaves E relatos somem. Relato carrega correlationId, machineId e o erro
      // cru do fornecedor — não pode ficar na tela da próxima sessão (ADR-002).
      return { ...estado, sessao: acao.escopo, chaves: acao.escopo?.pessoaId === estado.sessao?.pessoaId ? estado.chaves : null, relatos: acao.escopo?.pessoaId === estado.sessao?.pessoaId ? estado.relatos : null, chaveEmitida: null };
    case "navegar":
      return {
        ...estado,
        tela: acao.tela,
        erro: null,
        faixaParada: acao.tela.tipo === estado.tela.tipo ? estado.faixaParada : null,
        // Saiu da tela de chaves: a chave crua some da memória (ela aparece uma vez só).
        chaveEmitida: acao.tela.tipo === "chaves" ? estado.chaveEmitida : null,
      };
    case "tick":
      return { ...estado, agora: acao.agora };
    case "conexao":
      return { ...estado, conexao: { estado: acao.estado, tentativa: acao.tentativa, proximaEmMs: acao.proximaEmMs } };
    case "frame":
      return aplicarFrame(estado, acao.frame, acao.agora);
    case "hidratar-gestao":
      return { ...estado, gestao: acao.gestao };
    case "hidratar-frota":
      return { ...estado, frota: acao.frota, inventario: acao.frota.inventario };
    case "hidratar-inventario":
      return { ...estado, inventario: acao.inventario };
    case "hidratar-executor":
      return { ...estado, executor: acao.executor };
    case "hidratar-conversa": {
      const anterior = estado.conversas[acao.conversa.conversa.id];
      const vivosDaConversa = new Set(Object.values(estado.turnosVivos).filter((t) => t.conversaId === acao.conversa.conversa.id).map((t) => t.turnoId));
      const deltas: Record<string, string> = {};
      for (const [turnoId, t] of Object.entries(anterior?.deltas ?? {})) if (vivosDaConversa.has(turnoId)) deltas[turnoId] = t;
      return { ...estado, conversas: { ...estado.conversas, [acao.conversa.conversa.id]: { ...acao.conversa, deltas, carregadaEm: acao.agora } } };
    }
    case "hidratar-sua-vez":
      return { ...estado, suaVez: acao.suaVez };
    case "hidratar-rotinas":
      return { ...estado, rotinas: acao.rotinas };
    case "hidratar-execucoes":
      return { ...estado, execucoes: { ...estado.execucoes, [acao.rotinaId]: acao.execucoes } };
    case "autorizacao-app":
      return { ...estado, autorizacaoApp: { slug: acao.slug, url: acao.url }, avisoConexao: null };
    case "aviso-conexao":
      return { ...estado, avisoConexao: acao.texto };
    case "hidratar-conectores":
      return { ...estado, conectores: acao.conectores, marketplace: acao.marketplace ?? estado.marketplace, composioConfigurado: acao.composioConfigurado ?? estado.composioConfigurado };
    case "hidratar-concessoes":
      return { ...estado, concessoes: { ...estado.concessoes, [acao.agenteId]: acao.concessoes } };
    case "hidratar-memorias":
      return { ...estado, memorias: { ...estado.memorias, [acao.agenteId]: acao.memorias } };
    case "hidratar-salas":
      return { ...estado, salas: acao.salas };
    case "hidratar-chaves":
      return { ...estado, chaves: acao.chaves };
    case "hidratar-relatos":
      return { ...estado, relatos: acao.relatos };
    case "chave-emitida":
      return acao.emitida ? invalidar({ ...estado, chaveEmitida: acao.emitida }, "chaves") : { ...estado, chaveEmitida: null };
    case "faixa":
      return { ...estado, faixaParada: acao.faixa };
    case "invalidar":
      return invalidar(estado, ...acao.quais);
    case "invalidacoes-tratadas":
      return { ...estado, invalidacoes: estado.invalidacoes.filter((q) => !acao.quais.includes(q)) };
    case "erro":
      return { ...estado, erro: acao.erro, ocupado: false };
    case "ocupado":
      return { ...estado, ocupado: acao.valor };
  }
}

export function agenteDaTela(estado: Estado): string | null {
  const t = estado.tela;
  if (t.tipo === "conversa" || t.tipo === "perfil" || t.tipo === "memoria") return t.agenteId;
  return null;
}

export function conversaDaTela(estado: Estado): ConversaEstado | null {
  const t = estado.tela;
  if (t.tipo !== "conversa" && t.tipo !== "sala") return null;
  return estado.conversas[t.conversaId] ?? null;
}

/** O que a tela atual precisa ter carregado (o main busca o que faltar). */
export function invalidacoesDaTela(estado: Estado): Invalidacao[] {
  const t = estado.tela;
  const faltas: Invalidacao[] = [];
  if (estado.tela.tipo === "gestao" && !estado.gestao) faltas.push("gestao");
  if (!estado.frota) faltas.push("frota");
  if ((t.tipo === "conversa" || t.tipo === "sala") && !estado.conversas[t.conversaId]) faltas.push(`conversa:${t.conversaId}`);
  if (t.tipo === "sala" && estado.salas.length === 0) faltas.push("salas");
  if (t.tipo === "nova-sala" && estado.salas.length === 0) faltas.push("salas");
  if (t.tipo === "memoria" && !estado.memorias[t.agenteId]) faltas.push(`memoria:${t.agenteId}`);
  if ((t.tipo === "perfil" || t.tipo === "conversa") && !estado.concessoes[t.agenteId]) faltas.push(`concessoes:${t.agenteId}`);
  // definido em 2026-09-18: as rotinas do bot moram no painel Detalhes da conversa, então precisam
  // chegar junto com ela — não só na tela dedicada.
  if ((t.tipo === "rotinas" || t.tipo === "conversa") && estado.rotinas.length === 0) faltas.push("rotinas");
  if ((t.tipo === "conectores" || t.tipo === "conversa" || t.tipo === "sala") && estado.marketplace.length === 0) faltas.push("conectores");
  // A fila alimenta o badge ⚑ da sidebar e a faixa de chamada em QUALQUER tela: sem o rail, ela é o
  // único aviso de que há decisão parada.
  if (!estado.suaVez) faltas.push("sua-vez");
  if ((t.tipo === "chaves" || t.tipo === "espaco") && !estado.chaves) faltas.push("chaves");
  // O frame relato.criado não invalida nada (é registro), então a tela busca quando ainda não tem.
  if (t.tipo === "relatos" && !estado.relatos) faltas.push("relatos");
  return faltas.filter((f) => !estado.invalidacoes.includes(f));
}
