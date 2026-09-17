import type { Agente } from "../../src/contracts/agente.ts";
import type { ChaveEmitidaDto, ChaveMaquinaDto, ConversaDto, FrotaDto, ModoSessaoDto, RespostaMutacao, RotinaDto, SuaVezDto } from "../../src/contracts/api.ts";
import type { Concessao } from "../../src/contracts/concessao.ts";
import type { Conector } from "../../src/contracts/conector.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
import type { Inventario } from "../../src/contracts/inventario.ts";
import type { Memoria, TipoMemoria } from "../../src/contracts/memoria.ts";
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
    urlEventos: `${base}/eventos`,
    frota: () => get<FrotaDto>("frota"),
    inventario: (forcar = false) => get<Inventario>(`inventario${forcar ? "?forcar=1" : ""}`),
    conversa: (id: string) => get<ConversaDto>(`conversas/${id}/mensagens`),
    enviar: (conversaId: string, texto: string) => post<RespostaMutacao>(`conversas/${conversaId}/mensagens`, { texto }),
    pararConversa: (conversaId: string) => post<FaixaParada>(`conversas/${conversaId}/parar`),
    pararTudo: () => post<FaixaParada>("parar"),
    turno: (id: string) => get<{ turno: Turno }>(`turnos/${id}`),
    criarAgente: (nome?: string) => post<{ agente: Agente; conversa: Conversa }>("agentes", nome ? { dono: "pessoa", nome } : { dono: "pessoa" }),
    editarPerfil: (id: string, perfil: { nome?: string; titulo?: string; descricao?: string; modelo?: string }) => patch<{ agente: Agente }>(`agentes/${id}`, perfil),
    fixar: (id: string, fixado?: boolean) => post<{ agente: Agente }>(`agentes/${id}/fixar`, fixado === undefined ? {} : { fixado }),
    ocultar: (id: string, oculto?: boolean) => post<{ agente: Agente }>(`agentes/${id}/ocultar`, oculto === undefined ? {} : { oculto }),
    duplicar: (id: string) => post<{ agente: Agente; conversa: Conversa }>(`agentes/${id}/duplicar`),
    memorias: (agenteId: string) => get<{ memorias: Memoria[] }>(`agentes/${agenteId}/memoria`),
    criarMemoria: (agenteId: string, tipo: TipoMemoria, texto: string) => post<{ memoria: Memoria }>(`agentes/${agenteId}/memoria`, { tipo, texto }),
    editarMemoria: (agenteId: string, id: string, campos: { texto?: string; tipo?: TipoMemoria }) => patch<{ memoria: Memoria }>(`agentes/${agenteId}/memoria/${id}`, campos),
    apagarMemoria: (agenteId: string, id: string) => del<RespostaMutacao>(`agentes/${agenteId}/memoria/${id}`),
    confirmarProposta: (id: string) => post<RespostaMutacao>(`propostas/${id}/confirmar`),
    recusarProposta: (id: string) => post<RespostaMutacao>(`propostas/${id}/recusar`),
    rotinas: () => get<{ rotinas: RotinaDto[] }>("rotinas"),
    execucoes: (rotinaId: string) => get<{ execucoes: ExecucaoRotina[] }>(`rotinas/${rotinaId}/execucoes`),
    pausarRotina: (id: string) => post<RespostaMutacao>(`rotinas/${id}/pausar`),
    ativarRotina: (id: string) => post<RespostaMutacao>(`rotinas/${id}/ativar`),
    salas: () => get<{ salas: SalaDto[] }>("salas"),
    criarSala: (nome: string, agenteIds: string[]) => post<RespostaMutacao>("salas", { nome, agenteIds }),
    postarNaSala: (salaId: string, texto: string) => post<RespostaMutacao>(`salas/${salaId}/mensagens`, { texto }),
    pararSala: (salaId: string) => post<FaixaParada>(`salas/${salaId}/parar`),
    conectores: () => get<{ conectores: Conector[] }>("conectores"),
    registrarConector: (c: Record<string, unknown>) => post<{ ok: true; ids: { conector: string }; conector: Conector }>("conectores", c),
    sondarConector: (id: string) => post<{ ok: boolean; conector: Conector }>(`conectores/${id}/sondar`),
    habilitarConector: (id: string, habilitado: boolean) => post<{ conector: Conector }>(`conectores/${id}/${habilitado ? "habilitar" : "desabilitar"}`),
    concessoes: (agenteId: string) => get<{ concessoes: Concessao[] }>(`agentes/${agenteId}/concessoes`),
    conceder: (agenteId: string, conectorId: string, capacidade: string) => post<{ ok: true; ids: { concessao: string; mensagem: string }; naoInclui: string[] }>(`agentes/${agenteId}/concessoes`, { conectorId, capacidade }),
    revogar: (concessaoId: string) => del<RespostaMutacao>(`concessoes/${concessaoId}`),
    suaVez: () => get<SuaVezDto>("sua-vez"),
    decidir: (id: string, corpo: { itens?: { id: string; selecionado: boolean; textoFinal?: string }[]; recusar?: boolean }) => post<RespostaMutacao>(`decisoes/${id}/decidir`, corpo),
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
