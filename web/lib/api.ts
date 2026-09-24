import type { AcaoComputador, ComputadorDto, ResultadoComputador } from "../../src/contracts/computador.ts";
import type { PreferenciaHarness } from "../../src/contracts/harness.ts";
import type { Agente, FormaAgente, CorAgente } from "../../src/contracts/agente.ts";
import type { AmbienteBancoDto, ChaveEmitidaDto, ChaveMaquinaDto, ConversaDto, FrotaDto, ModoSessaoDto, RespostaMutacao, RotinaDto, SuaVezDto } from "../../src/contracts/api.ts";
import type { Concessao } from "../../src/contracts/concessao.ts";
import type { EntradaRelato, Relato } from "../../src/contracts/relato.ts";
import type { Conector } from "../../src/contracts/conector.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
import type { EstadoExecutor, IdExecutor } from "../../src/contracts/executor.ts";
import type { Inventario } from "../../src/contracts/inventario.ts";
import type { Memoria, TipoMemoria } from "../../src/contracts/memoria.ts";
import type { AppComLogo } from "../../src/contracts/marketplace.ts";
import type { ExecucaoRotina } from "../../src/contracts/rotina.ts";
import type { MembroSala, Sala } from "../../src/contracts/sala.ts";
import type { FaixaParada, Turno } from "../../src/contracts/turno.ts";
import type { Escopo } from "../../src/shared/types.ts";

/**
 * Cliente REST da web (ADR-020: a web DECIDE, nunca executa; ADR-018: só `import type` de src).
 * Toda rota escopada vai por /api/t/:tenantId (ADR-005); o cookie da sessão vai sozinho. Erro do
 * servidor chega como `ErroApi` com o código FECHADO da tabela de erros — a web renderiza o código,
 * nunca inventa texto a partir de err.message (ADR-002/004).
 */
export class ErroApi extends Error {
  readonly status: number;
  readonly codigo: string;
  readonly correlationId: string | null;
  constructor(status: number, codigo: string, mensagem: string, correlationId: string | null = null) {
    super(mensagem);
    this.name = "ErroApi";
    this.status = status;
    this.codigo = codigo;
    this.correlationId = correlationId;
  }
}

export type SalaDto = { sala: Sala; membros: MembroSala[] };
export type RegistroCatcher = { id: string; turnoId: string; tipo: string; dados: Record<string, unknown>; em: number };

async function pedir<T>(metodo: string, url: string, corpo?: unknown): Promise<T> {
  const r = await fetch(url, {
    method: metodo,
    headers: corpo === undefined ? {} : { "content-type": "application/json" },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const texto = await r.text();
  let lido: unknown = null;
  try {
    lido = texto === "" ? null : JSON.parse(texto);
  } catch {
    lido = null;
  }
  if (!r.ok) {
    const e = (typeof lido === "object" && lido !== null ? lido : {}) as { codigo?: string; mensagem?: string; correlation_id?: string | null };
    throw new ErroApi(r.status, e.codigo ?? "falha_interna", e.mensagem ?? "falha", e.correlation_id ?? null);
  }
  return lido as T;
}

export type Api = ReturnType<typeof criarApi>;

export function criarApi(escopo: Escopo) {
  const base = `/api/t/${encodeURIComponent(escopo.tenantId)}`;
  const get = <T>(caminho: string) => pedir<T>("GET", `${base}/${caminho}`);
  const post = <T>(caminho: string, corpo?: unknown) => pedir<T>("POST", `${base}/${caminho}`, corpo ?? {});
  const patch = <T>(caminho: string, corpo: unknown) => pedir<T>("PATCH", `${base}/${caminho}`, corpo);
  const del = <T>(caminho: string) => pedir<T>("DELETE", `${base}/${caminho}`);
  return {
    escopo,
    workspace: (id: string) => get<{ disponivel: boolean; vinculo: { pasta: string; preparado: { caminho: string; modo: string } | null } | null }>(`conversas/${id}/workspace`),
    pastasWorkspace: (id: string, caminho?: string) => post<{ caminho: string; pai: string; selecionavel: boolean; pastas: { nome: string; caminho: string }[] }>(`conversas/${id}/workspace/pastas`, { caminho }),
    escolherWorkspace: (id: string, pasta: string) => post(`conversas/${id}/workspace`, { pasta }),
    revogarWorkspace: (id: string) => del(`conversas/${id}/workspace`),
    permitirPasta: (propostaId: string, pasta: string) => post(`propostas/${propostaId}/permitir-pasta`, { pasta }),
    computador: (id: string) => get<ComputadorDto>(`agentes/${encodeURIComponent(id)}/computador`),
    configurarComputador: (id: string, operacao: string) => post<{ ok: true }>(`agentes/${encodeURIComponent(id)}/computador`, { operacao }),
    acaoComputador: (id: string, acao: AcaoComputador) => post<ResultadoComputador>(`agentes/${encodeURIComponent(id)}/computador/acoes`, acao),
    urlEventos: `${base}/eventos`,
    frota: () => get<FrotaDto>("frota"),
    gestaoAgentes: () => get<FrotaDto>("gestao-agentes"),
    organizarAgente: (id: string, campos: { secao?: string; naoLido?: boolean }) => patch<{ agente: Agente }>(`agentes/${id}/organizacao`, campos),
    excluirAgente: (id: string) => del<{ agente: Agente }>(`agentes/${id}`),
    restaurarAgente: (id: string) => post<{ agente: Agente }>(`agentes/${id}/restaurar`),
    inventario: (forcar = false) => get<Inventario>(`inventario${forcar ? "?forcar=1" : ""}`),
    ambiente: () => get<AmbienteBancoDto>("ambiente"),
    executor: () => get<EstadoExecutor>("executor"),
    trocarExecutor: (id: IdExecutor) => post<EstadoExecutor>("executor", { id }),
    conversa: (id: string) => get<ConversaDto>(`conversas/${id}/mensagens`),
    enviar: (conversaId: string, texto: string) => post<RespostaMutacao>(`conversas/${conversaId}/mensagens`, { texto }),
    pararConversa: (conversaId: string) => post<FaixaParada>(`conversas/${conversaId}/parar`),
    pararTudo: () => post<FaixaParada>("parar"),
    turno: (id: string) => get<{ turno: Turno }>(`turnos/${id}`),
    relatar: (entrada: EntradaRelato) => post<RespostaMutacao>("relatos", entrada),
    relatos: () => get<{ relatos: Relato[] }>("relatos"),
    criarAgente: (nome?: string, perfil?: { titulo?: string; descricao?: string; interativo?: boolean }) => post<{ agente: Agente; conversa: Conversa }>("agentes", { dono: "pessoa", nome, ...perfil }),
    editarPerfil: (id: string, perfil: { nome?: string; titulo?: string; descricao?: string; modelo?: string; harness?: PreferenciaHarness; forma?: FormaAgente; cor?: CorAgente }) => patch<{ agente: Agente }>(`agentes/${id}`, perfil),
    fixar: (id: string, fixado?: boolean) => post<{ agente: Agente }>(`agentes/${id}/fixar`, fixado === undefined ? {} : { fixado }),
    ocultar: (id: string, oculto?: boolean) => post<{ agente: Agente }>(`agentes/${id}/ocultar`, oculto === undefined ? {} : { oculto }),
    duplicar: (id: string) => post<{ agente: Agente; conversa: Conversa }>(`agentes/${id}/duplicar`),
    memorias: (agenteId: string) => get<{ memorias: Memoria[] }>(`agentes/${agenteId}/memoria`),
    criarMemoria: (agenteId: string, tipo: TipoMemoria, texto: string) => post<{ memoria: Memoria }>(`agentes/${agenteId}/memoria`, { tipo, texto }),
    editarMemoria: (agenteId: string, id: string, campos: { texto?: string; tipo?: TipoMemoria }) => patch<{ memoria: Memoria }>(`agentes/${agenteId}/memoria/${id}`, campos),
    apagarMemoria: (agenteId: string, id: string) => del<RespostaMutacao>(`agentes/${agenteId}/memoria/${id}`),
    confirmarProposta: (id: string) => post<RespostaMutacao>(`propostas/${id}/confirmar`),
    recusarProposta: (id: string) => post<RespostaMutacao>(`propostas/${id}/recusar`),
    criarRotina: (entrada: { agenteId: string; cron: string; fusoIana: string; instrucao: string; fonte: string; entregavel: string; limitesAprovacao: string; politicaSemDado: string }) => post<RespostaMutacao>("rotinas", entrada),
    executarRotina: (id: string) => post<RespostaMutacao>(`rotinas/${id}/executar`),
    rotinas: () => get<{ rotinas: RotinaDto[] }>("rotinas"),
    execucoes: (rotinaId: string) => get<{ execucoes: ExecucaoRotina[] }>(`rotinas/${rotinaId}/execucoes`),
    pausarRotina: (id: string) => post<RespostaMutacao>(`rotinas/${id}/pausar`),
    ativarRotina: (id: string) => post<RespostaMutacao>(`rotinas/${id}/ativar`),
    salas: () => get<{ salas: SalaDto[] }>("salas"),
    criarSala: (nome: string, agenteIds: string[]) => post<RespostaMutacao>("salas", { nome, agenteIds }),
    postarNaSala: (salaId: string, texto: string) => post<RespostaMutacao>(`salas/${salaId}/mensagens`, { texto }),
    pararSala: (salaId: string) => post<FaixaParada>(`salas/${salaId}/parar`),
    conectores: () => get<{ conectores: Conector[]; marketplace: AppComLogo[]; composioConfigurado: boolean }>("conectores"),
    configurarComposio: (chave: string) => post<{ configurado: boolean }>("marketplace/configurar", { chave }),
    conectarApp: (slug: string) => post<{ url: string; conectorId: string }>(`marketplace/${encodeURIComponent(slug)}/conectar`),
    verificarApp: (slug: string) => post<{ conectado: boolean }>(`marketplace/${encodeURIComponent(slug)}/verificar`),
    atualizarCredenciais: (id: string, env: Record<string, string>) => patch<{ conector: Conector }>(`conectores/${id}/credenciais`, { env }),
    registrarConector: (c: Record<string, unknown>) => post<{ ok: true; ids: { conector: string }; conector: Conector }>("conectores", c),
    sondarConector: (id: string) => post<{ ok: boolean; conector: Conector }>(`conectores/${id}/sondar`),
    habilitarConector: (id: string, habilitado: boolean) => post<{ conector: Conector }>(`conectores/${id}/${habilitado ? "habilitar" : "desabilitar"}`),
    concessoes: (agenteId: string) => get<{ concessoes: Concessao[] }>(`agentes/${agenteId}/concessoes`),
    conceder: (agenteId: string, conectorId: string, capacidade: string) => post<{ ok: true; ids: { concessao: string; mensagem: string }; naoInclui: string[] }>(`agentes/${agenteId}/concessoes`, { conectorId, capacidade }),
    revogar: (concessaoId: string) => del<RespostaMutacao>(`concessoes/${concessaoId}`),
    revogarAcessos: (agenteId: string, ids: string[]) => post<RespostaMutacao>(`agentes/${agenteId}/concessoes/revogar`, { ids }),
    suaVez: () => get<SuaVezDto>("sua-vez"),
    decidir: (id: string, corpo: { itens?: { id: string; selecionado: boolean; textoFinal?: string }[]; recusar?: boolean; sempre?: boolean }) => post<RespostaMutacao>(`decisoes/${id}/decidir`, corpo),
    responder: (id: string, texto: string) => post<RespostaMutacao>(`decisoes/${id}/responder`, { texto }),
    retomar: (id: string, texto?: string) => post<RespostaMutacao>(`decisoes/${id}/retomar`, texto ? { texto } : {}),
    reabrir: (id: string) => post<RespostaMutacao>(`decisoes/${id}/reabrir`),
    trilha: (q: string) => get<{ linhas: unknown[] }>(`trilha${q ? `?${q}` : ""}`),
    devCatcher: () => get<{ executor: string; registros: RegistroCatcher[] }>("dev/catcher"),
    chaves: () => get<{ chaves: ChaveMaquinaDto[] }>("maquinas/chaves"),
    emitirChave: (nome: string) => post<ChaveEmitidaDto>("maquinas/chaves", { nome }),
    revogarChave: (id: string) => del<{ ok: true }>(`maquinas/chaves/${id}`),
  };
}

/**
 * Sessão (ADR-019/030): GET /api/sessao devolve o escopo ou 401. O modo diz como a tela de entrada se
 * desenha: `google` é um link de navegação para /api/sessao/google (o servidor redireciona); `entrar`
 * só existe no login de desenvolvimento (NOD_LOGIN=stub, 127.0.0.1).
 */
export const sessao = {
  atual: () => pedir<Escopo>("GET", "/api/sessao"),
  modo: () => pedir<ModoSessaoDto>("GET", "/api/sessao/modo"),
  entrar: (pessoaId: string) => pedir<Escopo>("POST", "/api/sessao/entrar", { pessoaId }),
  urlGoogle: "/api/sessao/google",
};
