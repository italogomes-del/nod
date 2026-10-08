import type { AnexoMeta } from "../../src/contracts/anexo.ts";
import type { ArtefatoDto } from "../../src/contracts/artefato.ts";
import type { AcaoComputador, ComputadorDto, ResultadoComputador } from "../../src/contracts/computador.ts";
import type { PreferenciaHarness } from "../../src/contracts/harness.ts";
import type { Agente, FormaAgente, CorAgente, ModoAprovacao } from "../../src/contracts/agente.ts";
import type { AmbienteBancoDto, ChaveEmitidaDto, ChaveMaquinaDto, ConversaDto, FrotaDto, ModoSessaoDto, RespostaMutacao, RotinaDto, SuaVezDto } from "../../src/contracts/api.ts";
import type { Concessao } from "../../src/contracts/concessao.ts";
import type { EntradaRelato, Relato } from "../../src/contracts/relato.ts";
import type { Preferencias, RaioXConversa, RaioXTurno } from "../../src/contracts/raio-x.ts";
import type { ComandosDto } from "../../src/contracts/comandos.ts";
import type { NaoLidosDto } from "../../src/contracts/nao-lidos.ts";
import type { Conector } from "../../src/contracts/conector.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
import type { EstadoExecutor, IdExecutor } from "../../src/contracts/executor.ts";
import type { Inventario } from "../../src/contracts/inventario.ts";
import type { Memoria, TipoMemoria } from "../../src/contracts/memoria.ts";
import type { RespostaPendencias } from "../../src/contracts/pendencia.ts";
import type { AppComLogo } from "../../src/contracts/marketplace.ts";
import type { ExecucaoRotina } from "../../src/contracts/rotina.ts";
import type { MembroSala, Sala } from "../../src/contracts/sala.ts";
import type { FaixaParada, Turno } from "../../src/contracts/turno.ts";
import type { DisponibilidadeLigacao, FalaLigacao, Ligacao, LigacaoCriada } from "../../src/contracts/ligacao.ts";
import type { IaDaLigacao } from "../../src/contracts/voz.ts";
import type { AcaoComandoVoz } from "../../src/contracts/voz.ts";
import type { IdVozNod, VelocidadeVoz } from "../../src/contracts/vozes.ts";
import type { MotivoAvaliacaoLigacao } from "./ligacao-protocolo.ts";
import type { WorkspaceDto } from "../../src/contracts/workspace.ts";
import type { EstadoOnboarding, PedidoEtapaOnboarding } from "../../src/contracts/onboarding.ts";
import type { Escopo } from "../../src/shared/types.ts";
import { corpoDoEnvio } from "./envio-idempotente.ts";

/**
 * Cliente REST da web (ADR-020: a web DECIDE, nunca executa; ADR-018: só `import type` de src).
 * Toda rota escopada vai por /api/t/:tenantId (ADR-005); o cookie da sessão vai sozinho. Erro do
 * servidor chega como `ErroApi` com o código FECHADO da tabela de erros — a web renderiza o código,
 * nunca inventa texto a partir de err.message (ADR-002/004).
 */
/** NOD-174: quando o servidor não manda frase (proxy, corpo vazio), a pessoa lê isto — nunca "falha" solta. */
const FALHA_SEM_FRASE = "Algo deu errado. Tente de novo; se repetir, relate o problema.";
const FALHA_DE_REDE = "Não conseguimos falar com o servidor. Confira a conexão e tente de novo.";

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
    throw new ErroApi(r.status, e.codigo ?? "falha_interna", e.mensagem ?? FALHA_SEM_FRASE, e.correlation_id ?? null);
  }
  return lido as T;
}

function subir(url: string, arquivo: File, mime: string, aoProgresso?: (fracao: number) => void): Promise<AnexoMeta> {
  return new Promise((resolver, rejeitar) => {
    const x = new XMLHttpRequest();
    x.open("POST", url);
    x.setRequestHeader("content-type", mime);
    x.setRequestHeader("x-nod-nome", encodeURIComponent(arquivo.name));
    x.upload.onprogress = (e) => { if (e.lengthComputable) aoProgresso?.(e.loaded / e.total); };
    x.onerror = () => rejeitar(new ErroApi(0, "falha_interna", FALHA_DE_REDE));
    x.onload = () => {
      let lido: { codigo?: string; mensagem?: string } & Partial<AnexoMeta> = {};
      try { lido = JSON.parse(x.responseText) as typeof lido; } catch { lido = {}; }
      if (x.status >= 200 && x.status < 300) resolver(lido as AnexoMeta);
      else rejeitar(new ErroApi(x.status, lido.codigo ?? "falha_interna", lido.mensagem ?? FALHA_SEM_FRASE));
    };
    x.send(arquivo);
  });
}

export type Api = ReturnType<typeof criarApi>;

export type { MotivoAvaliacaoLigacao };

/** O corpo da decisão por voz (plano, "Aprovação por voz" §5): o servidor confere o comando e monta o resto. */
export type DecisaoPorVoz = { canal: "voz"; ligacaoId: string; comandoId: string; acao: AcaoComandoVoz };

/** Chamado pelo motor da ligação (web/lib/ligacao.ts) ao receber `comando`: a decisão sai com o cookie da própria página. */
export function decidirPorVoz(tenantId: string, decisaoId: string, corpo: DecisaoPorVoz): Promise<RespostaMutacao> {
  return pedir<RespostaMutacao>("POST", `/api/t/${encodeURIComponent(tenantId)}/decisoes/${encodeURIComponent(decisaoId)}/decidir`, corpo);
}

export function criarApi(escopo: Escopo) {
  const base = `/api/t/${encodeURIComponent(escopo.tenantId)}`;
  const get = <T>(caminho: string) => pedir<T>("GET", `${base}/${caminho}`);
  const post = <T>(caminho: string, corpo?: unknown) => pedir<T>("POST", `${base}/${caminho}`, corpo ?? {});
  const patch = <T>(caminho: string, corpo: unknown) => pedir<T>("PATCH", `${base}/${caminho}`, corpo);
  const del = <T>(caminho: string) => pedir<T>("DELETE", `${base}/${caminho}`);
  return {
    escopo,
    workspace: (id: string) => get<WorkspaceDto>(`conversas/${id}/workspace`),
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
    organizarAgente: (id: string, campos: { secao?: string; naoLido?: boolean; fixado?: boolean; ordem?: string[] }) => patch<{ agente: Agente }>(`agentes/${id}/organizacao`, campos),
    /** Não lidos (definido em 2026-09-29, 0039). */
    naoLidos: () => get<NaoLidosDto>("nao-lidos"),
    marcarLida: (conversaId: string) => post<RespostaMutacao>(`conversas/${conversaId}/lida`),
    marcarNaoLida: (conversaId: string) => post<RespostaMutacao>(`conversas/${conversaId}/nao-lida`),
    marcarTudoLido: () => post<RespostaMutacao>("nao-lidos/marcar-tudo"),
    excluirAgente: (id: string) => del<{ agente: Agente }>(`agentes/${id}`),
    restaurarAgente: (id: string) => post<{ agente: Agente }>(`agentes/${id}/restaurar`),
    inventario: (forcar = false) => get<Inventario>(`inventario${forcar ? "?forcar=1" : ""}`),
    ambiente: () => get<AmbienteBancoDto>("ambiente"),
    executor: () => get<EstadoExecutor>("executor"),
    trocarExecutor: (id: IdExecutor) => post<EstadoExecutor>("executor", { id }),
    conversa: (id: string) => get<ConversaDto>(`conversas/${id}/mensagens`),
    /** NOD-156: `idEnvio` é a chave da fala (nasce no compositor); o reenvio com a mesma chave não duplica. */
    enviar: (conversaId: string, texto: string, anexos: readonly string[] = [], idEnvio?: string) =>
      post<RespostaMutacao>(`conversas/${conversaId}/mensagens`, corpoDoEnvio(texto, anexos, idEnvio)),
    /** ADR-046: o arquivo sobe cru (não em JSON) e volta como metadado; progresso só existe no XHR. */
    subirAnexo: (conversaId: string, arquivo: File, mime: string, aoProgresso?: (fracao: number) => void) => subir(`${base}/conversas/${conversaId}/anexos`, arquivo, mime, aoProgresso),
    urlAnexo: (conversaId: string, anexoId: string) => `${base}/conversas/${encodeURIComponent(conversaId)}/anexos/${encodeURIComponent(anexoId)}`,
    pararConversa: (conversaId: string) => post<FaixaParada>(`conversas/${conversaId}/parar`),
    pararTudo: () => post<FaixaParada>("parar"),
    turno: (id: string) => get<{ turno: Turno }>(`turnos/${id}`),
    cancelarTurno: (id: string) => post<RespostaMutacao>(`turnos/${id}/cancelar`),
    relatar: (entrada: EntradaRelato) => post<RespostaMutacao>("relatos", entrada),
    // Modo dev (0036): a preferência mora no servidor e o Raio-X é lido por conversa (a faixa) e por turno (a gaveta).
    preferencias: () => get<Preferencias>("preferencias"),
    gravarPreferencias: (p: Pick<Preferencias, "modoDev">) => pedir<Preferencias>("PUT", `${base}/preferencias`, p),
    // definido em 2026-10-06 (0059): o aviso fechado fica com a pessoa — o app do Mac limpa o localStorage.
    fecharAviso: (chave: string) => pedir<Preferencias>("POST", `${base}/preferencias/avisos-fechados`, { chave }),
    raioXDaConversa: (id: string, desde: number) => get<RaioXConversa>(`conversas/${encodeURIComponent(id)}/raio-x?desde=${desde}`),
    raioXDoTurno: (id: string) => get<RaioXTurno>(`turnos/${encodeURIComponent(id)}/raio-x`),
    // O "/" do chat (0038): o catálogo do Mac e os comandos da conversa; a nova sessão é do nod.
    comandos: () => get<ComandosDto>("comandos"),
    novaSessao: (conversaId: string) => post<RespostaMutacao>(`conversas/${encodeURIComponent(conversaId)}/nova-sessao`),
    relatos: () => get<{ relatos: Relato[] }>("relatos"),
    criarAgente: (nome?: string, perfil?: { titulo?: string; descricao?: string; interativo?: boolean }) => post<{ agente: Agente; conversa: Conversa }>("agentes", { dono: "pessoa", nome, ...perfil }),
    editarPerfil: (id: string, perfil: { nome?: string; titulo?: string; descricao?: string; modelo?: string; harness?: PreferenciaHarness; esforco?: string; forma?: FormaAgente; cor?: CorAgente }) => patch<{ agente: Agente }>(`agentes/${id}`, perfil),
    // ADR-059: o chip de aprovações do campo; o servidor escreve a troca na conversa do bot.
    mudarModoAprovacao: (id: string, modo: ModoAprovacao) => post<{ agente: Agente; mudou: boolean }>(`agentes/${id}/modo-aprovacao`, { modo }),
    fixar: (id: string, fixado?: boolean) => post<{ agente: Agente }>(`agentes/${id}/fixar`, fixado === undefined ? {} : { fixado }),
    ocultar: (id: string, oculto?: boolean) => post<{ agente: Agente }>(`agentes/${id}/ocultar`, oculto === undefined ? {} : { oculto }),
    duplicar: (id: string) => post<{ agente: Agente; conversa: Conversa }>(`agentes/${id}/duplicar`),
    memorias: (agenteId: string) => get<{ memorias: Memoria[] }>(`agentes/${agenteId}/memoria`),
    criarMemoria: (agenteId: string, tipo: TipoMemoria, texto: string) => post<{ memoria: Memoria }>(`agentes/${agenteId}/memoria`, { tipo, texto }),
    editarMemoria: (agenteId: string, id: string, campos: { texto?: string; tipo?: TipoMemoria }) => patch<{ memoria: Memoria }>(`agentes/${agenteId}/memoria/${id}`, campos),
    apagarMemoria: (agenteId: string, id: string) => del<RespostaMutacao>(`agentes/${agenteId}/memoria/${id}`),
    // ADR-064: o "a fazer" do bot — a lista, o Descartar da pessoa e o Fazer agora (vira mensagem na conversa).
    pendencias: (agenteId: string) => get<RespostaPendencias>(`agentes/${agenteId}/pendencias`),
    descartarPendencia: (agenteId: string, id: string) => post<RespostaMutacao>(`agentes/${agenteId}/pendencias/${id}/descartar`),
    fazerPendenciaAgora: (agenteId: string, id: string) => post<RespostaMutacao>(`agentes/${agenteId}/pendencias/${id}/fazer-agora`),
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
    // definido em 2026-09-24 (ADR-048): o GitHub pode conectar na hora (gh logado nesta máquina, sem URL de login) ou dizer o que falta (`frase`).
    conectarApp: (slug: string) => post<{ url?: string; conectorId?: string; conectado?: boolean; frase?: string }>(`marketplace/${encodeURIComponent(slug)}/conectar`),
    appGithub: (p: { appId: string; instalacaoId: string; chavePrivada: string }) => post<{ configurado: boolean }>("marketplace/github/app", p),
    tokenGithub: (token: string) => post<{ conectado: boolean; conectorId: string }>("marketplace/github/token", { token }),
    verificarApp: (slug: string) => post<{ conectado: boolean; falhou?: boolean }>(`marketplace/${encodeURIComponent(slug)}/verificar`),
    atualizarCredenciais: (id: string, env: Record<string, string>) => patch<{ conector: Conector }>(`conectores/${id}/credenciais`, { env }),
    registrarConector: (c: Record<string, unknown>) => post<{ ok: true; ids: { conector: string }; conector: Conector }>("conectores", c),
    sondarConector: (id: string) => post<{ ok: boolean; conector: Conector }>(`conectores/${id}/sondar`),
    habilitarConector: (id: string, habilitado: boolean) => post<{ conector: Conector }>(`conectores/${id}/${habilitado ? "habilitar" : "desabilitar"}`),
    concessoes: (agenteId: string) => get<{ concessoes: Concessao[]; liberacoesDispensadas?: Record<string, number> }>(`agentes/${agenteId}/concessoes`),
    // definido em 2026-10-05: o cartão da conversa que oferece liberar apps recém-conectados (web/telas/card-liberar.ts).
    liberarApps: (agenteId: string, apps: { conectorId: string; nivel: "leitura" | "escrita" }[]) => post<RespostaMutacao>(`agentes/${agenteId}/acessos/liberar`, { apps }),
    dispensarLiberacao: (agenteId: string, conectorIds: string[]) => post<RespostaMutacao>(`agentes/${agenteId}/acessos/dispensar`, { conectorIds }),
    conceder: (agenteId: string, conectorId: string, capacidade: string) => post<{ ok: true; ids: { concessao: string; mensagem: string }; naoInclui: string[] }>(`agentes/${agenteId}/concessoes`, { conectorId, capacidade }),
    revogar: (concessaoId: string) => del<RespostaMutacao>(`concessoes/${concessaoId}`),
    // definido em 2026-09-25: Nenhum / Ler / Ler e alterar por bot e app (marketplace e painel do bot).
    definirNivel: (agenteId: string, conectorId: string, nivel: "nenhum" | "leitura" | "escrita") => post<RespostaMutacao>(`agentes/${agenteId}/acessos`, { conectorId, nivel }),
    revogarAcessos: (agenteId: string, ids: string[]) => post<RespostaMutacao>(`agentes/${agenteId}/concessoes/revogar`, { ids }),
    // definido em 2026-09-24 ("aviso no Mac"): `ver: false` → `?ver=0`, a leitura da janela escondida ou
    // fora de foco, que não carimba vista_em (ADR-007, refinamento da mesma data).
    suaVez: (ver = true) => get<SuaVezDto>(ver ? "sua-vez" : "sua-vez?ver=0"),
    dispensarIncidente: (id: string) => post<RespostaMutacao>(`incidentes/${id}/dispensar`),
    // Modo ligação (definido em 2026-10-04, ADR-071/075): disponibilidade é 200 com o motivo, nunca erro.
    disponibilidadeLigacao: (agenteId: string) => get<DisponibilidadeLigacao>(`ligacoes/disponibilidade?agenteId=${encodeURIComponent(agenteId)}`),
    consentirVoz: (versao: number) => post<RespostaMutacao>("voz/consentimento", { versao }),
    criarLigacao: (agenteId: string) => post<LigacaoCriada>("ligacoes", { agenteId }),
    ligacaoViva: () => get<{ ligacao: Ligacao | null }>("ligacoes/viva"),
    encerrarLigacao: (id: string) => post<RespostaMutacao>(`ligacoes/${encodeURIComponent(id)}/encerrar`),
    /** Rede de segurança (2026-10-05): a IA do Mac caiu no meio da ligação e a pessoa escolheu com qual continuar. */
    continuarLigacao: (id: string, ia: IaDaLigacao) => post<{ ligacao: Ligacao }>(`ligacoes/${encodeURIComponent(id)}/continuar`, { ia }),
    avaliarLigacao: (id: string, nota: "boa" | "ruim", motivo?: MotivoAvaliacaoLigacao) => post<RespostaMutacao>(`ligacoes/${encodeURIComponent(id)}/avaliacao`, motivo ? { nota, motivo } : { nota }),
    falasLigacao: (id: string) => get<{ falas: FalaLigacao[] }>(`ligacoes/${encodeURIComponent(id)}/falas`),
    apagarFalasLigacao: (id: string) => del<RespostaMutacao>(`ligacoes/${encodeURIComponent(id)}/falas`),
    /** Ajustes da ligação: a voz e a velocidade do bot valem a partir da próxima frase. */
    ajustarVoz: (agenteId: string, ajuste: { voz?: IdVozNod | null; vozVelocidade?: VelocidadeVoz }) => patch<{ voz: string | null; vozVelocidade: number }>(`agentes/${encodeURIComponent(agenteId)}/voz`, ajuste),
    // Onboarding por ligação (definido em 2026-10-04, ADR-077): a etapa mora no servidor; a web só lê e pede para mudar.
    onboarding: () => get<EstadoOnboarding>("onboarding"),
    etapaOnboarding: (p: PedidoEtapaOnboarding) => post<EstadoOnboarding>("onboarding/etapa", p),
    concluirOnboarding: () => post<EstadoOnboarding>("onboarding/concluir"),
    botDoOnboarding: (nome: string, descricao: string) => post<EstadoOnboarding>("onboarding/bot", { nome, descricao }),
    rotinaDoOnboarding: (indice: number) => post<EstadoOnboarding>("onboarding/rotina", { indice }),
    /** A decisão 'bot' do onboarding decidida pelo clique: o nome e a descrição podem ter sido editados no card. */
    decidirBot: (id: string, corpo: { nome?: string; descricao?: string; recusar?: boolean }) => post<RespostaMutacao>(`decisoes/${id}/decidir`, corpo),
    decidir: (id: string, corpo: { itens?: { id: string; selecionado: boolean; textoFinal?: string }[]; recusar?: boolean; sempre?: boolean; restoDaTarefa?: boolean; capacidades?: string[]; selecionados?: number[] }) => post<RespostaMutacao>(`decisoes/${id}/decidir`, corpo),
    responder: (id: string, texto: string) => post<RespostaMutacao>(`decisoes/${id}/responder`, { texto }),
    retomar: (id: string, texto?: string) => post<RespostaMutacao>(`decisoes/${id}/retomar`, texto ? { texto } : {}),
    reabrir: (id: string) => post<RespostaMutacao>(`decisoes/${id}/reabrir`),
    dispensar: (id: string) => post<RespostaMutacao>(`decisoes/${id}/dispensar`),
    trilha: (q: string) => get<{ linhas: unknown[] }>(`trilha${q ? `?${q}` : ""}`),
    devCatcher: () => get<{ executor: string; registros: RegistroCatcher[] }>("dev/catcher"),
    chaves: () => get<{ chaves: ChaveMaquinaDto[] }>("maquinas/chaves"),
    emitirChave: (nome: string) => post<ChaveEmitidaDto>("maquinas/chaves", { nome }),
    revogarChave: (id: string) => del<{ ok: true }>(`maquinas/chaves/${id}`),
    /** ADR-069: abre o pedido de pareamento do Mac que pediu; o código volta ao app pelo 127.0.0.1. */
    parearMac: (nome: string, desafio: string) => post<{ codigo: string }>("maquinas/pareamentos", { nome, desafio }),
    // ADR-051 (definido em 2026-09-28): o card do artefato busca o HTML da SUA versão e o estado da pessoa.
    versaoArtefato: (id: string, versao: number) => get<ArtefatoDto>(`artefatos/${encodeURIComponent(id)}/versoes/${versao}`),
    salvarEstadoArtefato: (id: string, dados: unknown) => pedir<{ ok: true }>("PUT", `${base}/artefatos/${encodeURIComponent(id)}/estado`, { dados }),
    /** Ao fechar a página: keepalive deixa o PUT terminar depois de a aba sair (o que falhar aqui se perde, sem aviso). */
    salvarEstadoArtefatoAoSair: (id: string, dados: unknown) => {
      void fetch(`${base}/artefatos/${encodeURIComponent(id)}/estado`, { method: "PUT", keepalive: true, headers: { "content-type": "application/json" }, body: JSON.stringify({ dados }) }).catch(() => undefined);
    },
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
