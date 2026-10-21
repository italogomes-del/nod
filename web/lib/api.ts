import type { AtividadeDto, ContagemDaAtividade } from "../../src/contracts/atividade.ts";
import type { AnexoMeta } from "../../src/contracts/anexo.ts";
import type { ArtefatoDto } from "../../src/contracts/artefato.ts";
import type { AcaoComputador, ComputadorDto, ResultadoComputador } from "../../src/contracts/computador.ts";
import type { DisponibilidadeDitado } from "../../src/contracts/ditado.ts";
import type { PreferenciaHarness } from "../../src/contracts/harness.ts";
import type { Agente, FormaAgente, CorAgente, ModoAprovacao } from "../../src/contracts/agente.ts";
import type { AmbienteBancoDto, ChaveEmitidaDto, ChaveMaquinaDto, ConversaDto, FrotaDto, ModoSessaoDto, RespostaMutacao, RotinaDto, SuaVezDto } from "../../src/contracts/api.ts";
import type { Concessao } from "../../src/contracts/concessao.ts";
import type { MaquinasDto } from "../../src/contracts/maquina.ts";
import type { CodigoCifrado, ContasIaDto, IaComConta, LoginNaMaquina, ModoDasContas, MotivoDaNota } from "../../src/contracts/contas-ia.ts";
import type { EntradaRelato, Relato } from "../../src/contracts/relato.ts";
import type { Experimentos, Preferencias, RaioXConversa, RaioXTurno } from "../../src/contracts/raio-x.ts";
import type { ComandosDto } from "../../src/contracts/comandos.ts";
import type { NaoLidosDto } from "../../src/contracts/nao-lidos.ts";
import type { Conector } from "../../src/contracts/conector.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
import type { EstadoExecutor, IdExecutor } from "../../src/contracts/executor.ts";
import type { Inventario } from "../../src/contracts/inventario.ts";
import type { IasDaPessoa, InteligenciaBot, PedidoInteligencia } from "../../src/contracts/inteligencia.ts";
import type { DecisaoDaPessoa } from "../../src/contracts/troca-de-ia.ts";
import type { UsoDoPlanoDto } from "../../src/contracts/uso-do-plano.ts";
import type { IdHarness } from "../../src/contracts/harness.ts";
import type { Memoria, TipoMemoria } from "../../src/contracts/memoria.ts";
import type { ReacaoNaFala } from "../../src/contracts/reacao.ts";
import type { RespostaPendencias } from "../../src/contracts/pendencia.ts";
import type { AppComLogo } from "../../src/contracts/marketplace.ts";
import type { ExecucaoRotina } from "../../src/contracts/rotina.ts";
import type { MembroSala, Sala } from "../../src/contracts/sala.ts";
import type { FaixaParada, Turno } from "../../src/contracts/turno.ts";
import type { EventoLinha, TaxaDeAbertura, TrabalhoDetalheDto, TrabalhosDto } from "../../src/contracts/trabalho.ts";
import type { CustoDoDiaDto } from "../../src/contracts/cota.ts";
import type { DisponibilidadeLigacao, FalaLigacao, Ligacao, LigacaoCriada } from "../../src/contracts/ligacao.ts";
import type { IaDaLigacao } from "../../src/contracts/voz.ts";
import type { AcaoComandoVoz } from "../../src/contracts/voz.ts";
import type { IdVozNod, VelocidadeVoz } from "../../src/contracts/vozes.ts";
import type { MotivoAvaliacaoLigacao } from "./ligacao-protocolo.ts";
import type { WorkspaceDto } from "../../src/contracts/workspace.ts";
import type { EstadoOnboarding, PedidoEtapaOnboarding } from "../../src/contracts/onboarding.ts";
import type { Escopo } from "../../src/shared/types.ts";
import { corpoDoEnvio } from "./envio-idempotente.ts";
import { podeRepetir, tentarDeNovo } from "./tentar-de-novo.ts";
import { ErroApi, ehAbort, erroDaResposta, falhaDeTransporte, rotaDe } from "./erro-api.ts";

export { ErroApi, FRASE_SEM_INTERNET, FRASE_SERVIDOR_INDISPONIVEL, rotaDe } from "./erro-api.ts";

/**
 * Cliente REST da web (ADR-020: a web DECIDE, nunca executa; ADR-018: só `import type` de src).
 * Toda rota escopada vai por /api/t/:tenantId (ADR-005); o cookie da sessão vai sozinho. Erro do
 * servidor chega como `ErroApi` com o código FECHADO da tabela de erros — a web renderiza o código,
 * nunca inventa texto a partir de err.message (ADR-002/004).
 */
export type SalaDto = { sala: Sala; membros: MembroSala[] };
export type RegistroCatcher = { id: string; turnoId: string; tipo: string; dados: Record<string, unknown>; em: number };

/**
 * Quem acompanha a rede (main.ts): `falhou` a cada falha de transporte (inclusive as que ainda vão repetir), `voltou`
 * quando o nod responde qualquer coisa. Um só, como o resto do estado da página.
 */
export type ObservadorDeRede = { falhou(e: ErroApi): void; voltou(): void };
let observador: ObservadorDeRede | null = null;
export function observarRede(o: ObservadorDeRede | null): void {
  observador = o;
}

/**
 * `silencioso`: chamada de fundo que a pessoa não fez (o lote da telemetria, inclusive o do `pagehide`): a falha dela
 * não acende o "Reconectando…" (revisão NOD-215) — quem chama já engole o erro.
 */
type OpcoesPedido = { keepalive?: true; silencioso?: true };

async function pedir<T>(metodo: string, url: string, corpo?: unknown, opcoesPedido: OpcoesPedido = {}): Promise<T> {
  const rota = rotaDe(metodo, url);
  const { silencioso, ...opcoes } = opcoesPedido;
  const obs = silencioso ? null : observador;
  let r: Response;
  try {
    r = await fetch(url, {
      method: metodo,
      headers: corpo === undefined ? {} : { "content-type": "application/json" },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      ...opcoes,
    });
  } catch (e) {
    // Navegação/troca de tela cancelou: não é falha, ninguém precisa de aviso.
    if (ehAbort(e)) throw e;
    const falha = falhaDeTransporte(rota);
    obs?.falhou(falha);
    throw falha;
  }
  let texto = "";
  try {
    texto = await r.text();
  } catch (e) {
    if (ehAbort(e)) throw e;
    const falha = falhaDeTransporte(rota);
    obs?.falhou(falha);
    throw falha;
  }
  let lido: unknown = null;
  try {
    lido = texto === "" ? null : JSON.parse(texto);
  } catch {
    lido = null;
  }
  if (!r.ok) {
    const erro = erroDaResposta(r.status, lido, rota);
    if (erro.codigo === "servidor_indisponivel") obs?.falhou(erro);
    else obs?.voltou();
    throw erro;
  }
  obs?.voltou();
  return lido as T;
}

/** GET e mutação com chave de idempotência atravessam alguns segundos de servidor fora (web/lib/tentar-de-novo.ts). */
function pedirDeNovoSeCair<T>(metodo: string, url: string, corpo?: unknown, chave?: string): Promise<T> {
  if (!podeRepetir(metodo, chave)) return pedir<T>(metodo, url, corpo);
  return tentarDeNovo(() => pedir<T>(metodo, url, corpo));
}

function subir(url: string, arquivo: File, mime: string, aoProgresso?: (fracao: number) => void): Promise<AnexoMeta> {
  const rota = rotaDe("POST", url);
  // Upload não repete sozinho (não é idempotente): só a frase certa.
  return new Promise((resolver, rejeitar) => {
    const x = new XMLHttpRequest();
    x.open("POST", url);
    x.setRequestHeader("content-type", mime);
    x.setRequestHeader("x-nod-nome", encodeURIComponent(arquivo.name));
    x.upload.onprogress = (e) => { if (e.lengthComputable) aoProgresso?.(e.loaded / e.total); };
    x.onerror = () => {
      const falha = falhaDeTransporte(rota);
      observador?.falhou(falha);
      rejeitar(falha);
    };
    x.onload = () => {
      let lido: unknown = null;
      try { lido = JSON.parse(x.responseText); } catch { lido = null; }
      if (x.status >= 200 && x.status < 300) {
        observador?.voltou();
        // Corpo vazio/ilegível num 2xx: objeto vazio como antes do NOD-215 (quem chama lê meta.id sem estourar).
        resolver((lido ?? {}) as AnexoMeta);
        return;
      }
      const erro = erroDaResposta(x.status, lido, rota);
      if (erro.codigo === "servidor_indisponivel") observador?.falhou(erro);
      else observador?.voltou();
      rejeitar(erro);
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
  const get = <T>(caminho: string) => pedirDeNovoSeCair<T>("GET", `${base}/${caminho}`);
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
    // Plano das IAs (2026-10-10): a ordem do Automático da pessoa, o estado com o limite e os modelos; e a escolha do bot.
    ias: () => get<IasDaPessoa>("ias"),
    // definido em 2026-10-16 (plano "tela limpa", decisão E6): o anel de uso do seletor de IA no campo.
    usoDoPlano: () => get<UsoDoPlanoDto>("uso-do-plano"),
    gravarOrdemIas: (ordemIas: IdHarness[] | null) => pedir<Preferencias>("PUT", `${base}/preferencias`, { ordemIas }),
    gravarInteligencia: (agenteId: string, pedido: PedidoInteligencia) => pedir<{ agente: Agente }>("PUT", `${base}/agentes/${encodeURIComponent(agenteId)}/inteligencia`, pedido),
    inteligencia: (agenteId: string) => get<{ inteligencia: InteligenciaBot }>(`agentes/${encodeURIComponent(agenteId)}/inteligencia`),
    conversa: (id: string) => get<ConversaDto>(`conversas/${id}/mensagens`),
    /** NOD-156: `idEnvio` é a chave da fala (nasce no compositor); o reenvio com a mesma chave não duplica. */
    enviar: (conversaId: string, texto: string, anexos: readonly string[] = [], idEnvio?: string, respondeA?: string) =>
      pedirDeNovoSeCair<RespostaMutacao>("POST", `${base}/conversas/${conversaId}/mensagens`, corpoDoEnvio(texto, anexos, idEnvio, respondeA), idEnvio),
    /** ADR-113: põe (`marcada`) ou tira a reação da pessoa numa fala; devolve as reações dela. */
    reagir: (mensagemId: string, emoji: string, marcada: boolean) => pedir<{ reacoes: ReacaoNaFala[] }>("PUT", `${base}/mensagens/${encodeURIComponent(mensagemId)}/reacoes`, { emoji, marcada }),
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
    // ADR-083: a faixa de Trabalhos recolhida também é preferência (só o campo que mudou vai no corpo).
    // ADR-111: `experimentos` leva só a chave que mudou ({ calibracao }, { memoriaLonga } ou, ADR-112, { whatsapp }).
    gravarPreferencias: (p: Partial<Pick<Preferencias, "modoDev" | "usoDoMac">> & { experimentos?: Partial<Experimentos> }) => pedir<Preferencias>("PUT", `${base}/preferencias`, p),
    raioXDaConversa: (id: string, desde: number) => get<RaioXConversa>(`conversas/${encodeURIComponent(id)}/raio-x?desde=${desde}`),
    raioXDoTurno: (id: string) => get<RaioXTurno>(`turnos/${encodeURIComponent(id)}/raio-x`),
    // O "/" do chat (0038): o catálogo do Mac e os comandos da conversa; a nova sessão é do nod.
    comandos: () => get<ComandosDto>("comandos"),
    novaSessao: (conversaId: string) => post<RespostaMutacao>(`conversas/${encodeURIComponent(conversaId)}/nova-sessao`),
    relatos: () => get<{ relatos: Relato[] }>("relatos"),
    // ADR-083 §8 (definido em 2026-10-07): os trabalhos (tasks) dos bots, a tela da task e o que se faz nela.
    trabalhos: (agenteId?: string) => get<TrabalhosDto>(agenteId ? `trabalhos?agenteId=${encodeURIComponent(agenteId)}` : "trabalhos"),
    trabalho: (id: string) => get<TrabalhoDetalheDto>(`trabalhos/${encodeURIComponent(id)}`),
    // ADR-099 §7 (definido em 2026-10-12): quanto cada bot gastou hoje, no fuso da pessoa (o servidor não o guarda).
    custoHoje: (fuso: string) => get<CustoDoDiaDto>(`custo-hoje?fuso=${encodeURIComponent(fuso)}`),
    escreverNoTrabalho: (id: string, texto: string) => post<RespostaMutacao>(`trabalhos/${encodeURIComponent(id)}/mensagens`, { texto }),
    pararTrabalho: (id: string) => post<RespostaMutacao>(`trabalhos/${encodeURIComponent(id)}/parar`),
    trabalhoDepois: (id: string, depoisDe: string) => post<RespostaMutacao>(`trabalhos/${encodeURIComponent(id)}/depois`, { depoisDe }),
    trabalhoFazerAqui: (id: string) => post<RespostaMutacao>(`trabalhos/${encodeURIComponent(id)}/fazer-aqui`),
    // #191: o que a tela mostrou e o que a pessoa abriu, em lote; a taxa por tipo aparece no Modo dev.
    // Revisão W12 (2026-10-08): o último lote sai no `pagehide`; com keepalive o POST termina depois de a aba fechar.
    telemetriaLinhas: (eventos: readonly EventoLinha[]) => pedir<RespostaMutacao>("POST", `${base}/telemetria/linhas`, { eventos }, { keepalive: true, silencioso: true }),
    taxasLinhas: () => get<TaxaDeAbertura[]>("telemetria/linhas"),
    criarAgente: (nome?: string, perfil?: { titulo?: string; descricao?: string; interativo?: boolean }) => post<{ agente: Agente; conversa: Conversa }>("agentes", { dono: "pessoa", nome, ...perfil }),
    editarPerfil: (id: string, perfil: { nome?: string; titulo?: string; descricao?: string; modelo?: string; harness?: PreferenciaHarness; esforco?: string; forma?: FormaAgente; cor?: CorAgente }) => patch<{ agente: Agente }>(`agentes/${id}`, perfil),
    // ADR-059: o botão de aprovações do campo; o servidor escreve a troca na conversa do bot. O total exige `confirmado`
    // (o segundo clique do menu, emenda de 2026-10-18): sem ele o servidor responde 400.
    mudarModoAprovacao: (id: string, modo: ModoAprovacao, confirmado = false) => post<{ agente: Agente; mudou: boolean }>(`agentes/${id}/modo-aprovacao`, confirmado ? { modo, confirmado: true } : { modo }),
    fixar: (id: string, fixado?: boolean) => post<{ agente: Agente }>(`agentes/${id}/fixar`, fixado === undefined ? {} : { fixado }),
    ocultar: (id: string, oculto?: boolean) => post<{ agente: Agente }>(`agentes/${id}/ocultar`, oculto === undefined ? {} : { oculto }),
    duplicar: (id: string) => post<{ agente: Agente; conversa: Conversa }>(`agentes/${id}/duplicar`),
    memorias: (agenteId: string) => get<{ memorias: Memoria[] }>(`agentes/${agenteId}/memoria`),
    // Chat limpo (ADR-114, PR 2): a Atividade do bot, um dia por página, e só o "N hoje" da gaveta (contagem=1).
    atividade: (agenteId: string, dia: string, fuso: string) => get<AtividadeDto>(`agentes/${encodeURIComponent(agenteId)}/atividade?dia=${encodeURIComponent(dia)}&fuso=${encodeURIComponent(fuso)}`),
    contagemAtividade: (agenteId: string, dia: string, fuso: string) => get<ContagemDaAtividade>(`agentes/${encodeURIComponent(agenteId)}/atividade?dia=${encodeURIComponent(dia)}&fuso=${encodeURIComponent(fuso)}&contagem=1`),
    // ADR-113: o "Lembrar disso" da fala manda a conversa, para a linha "Anotei …" aparecer nela.
    criarMemoria: (agenteId: string, tipo: TipoMemoria, texto: string, conversaId?: string) => post<{ memoria: Memoria }>(`agentes/${agenteId}/memoria`, { tipo, texto, ...(conversaId ? { conversaId } : {}) }),
    editarMemoria: (agenteId: string, id: string, campos: { texto?: string; tipo?: TipoMemoria }) => patch<{ memoria: Memoria }>(`agentes/${agenteId}/memoria/${id}`, campos),
    apagarMemoria: (agenteId: string, id: string) => del<RespostaMutacao>(`agentes/${agenteId}/memoria/${id}`),
    // ADR-064: o "a fazer" do bot — a lista, o Descartar da pessoa e o Fazer agora (vira mensagem na conversa).
    pendencias: (agenteId: string) => get<RespostaPendencias>(`agentes/${agenteId}/pendencias`),
    descartarPendencia: (agenteId: string, id: string) => post<RespostaMutacao>(`agentes/${agenteId}/pendencias/${id}/descartar`),
    fazerPendenciaAgora: (agenteId: string, id: string) => post<RespostaMutacao>(`agentes/${agenteId}/pendencias/${id}/fazer-agora`),
    confirmarProposta: (id: string) => post<RespostaMutacao>(`propostas/${id}/confirmar`),
    recusarProposta: (id: string) => post<RespostaMutacao>(`propostas/${id}/recusar`),
    criarRotina: (entrada: { agenteId: string; cron: string; fusoIana: string; instrucao: string; fonte: string; entregavel: string; limitesAprovacao: string; politicaSemDado: string }) => post<RespostaMutacao>("rotinas", entrada),
    executarRotina: (id: string, opcoes?: { confirmar?: boolean }) => post<RespostaMutacao>(`rotinas/${id}/executar`, opcoes?.confirmar ? { confirmar: true } : undefined),
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
    verificarApp: (slug: string) => post<{ conectado: boolean; falhou?: boolean; causa?: "composio" | "app" | null }>(`marketplace/${encodeURIComponent(slug)}/verificar`),
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
    // ADR-095: o microfone do campo de mensagem aparece? 200 com o motivo, nunca erro.
    disponibilidadeDitado: () => get<DisponibilidadeDitado>("voz/ditado/disponibilidade"),
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
    // ADR-090: as máquinas, onde cada bot trabalha, o pareamento por código e o "rodar em outra desta vez".
    maquinas: () => get<MaquinasDto>("maquinas"),
    maquinaDoBot: (agenteId: string, maquinaId: string | null) => pedir<{ agente: Agente }>("PUT", `${base}/agentes/${encodeURIComponent(agenteId)}/maquina`, { maquinaId }),
    moverBots: (maquinaId: string, agentes: string[]) => pedir<{ movidos: number }>("PUT", `${base}/maquinas/${encodeURIComponent(maquinaId)}/bots`, { agentes }),
    maquinaPadrao: (maquinaId: string | null) => pedir<{ padraoId: string | null }>("PUT", `${base}/maquinas/padrao`, { maquinaId }),
    verDispositivo: (codigo: string) => get<{ nome: string; plataforma: string; pedidoHaS: number }>(`maquinas/dispositivos/${encodeURIComponent(codigo)}`),
    aprovarDispositivo: (codigo: string) => post<{ ok: true }>(`maquinas/dispositivos/${encodeURIComponent(codigo)}/aprovar`),
    // NOD-314: a task que espera uma máquina sem contato roda os turnos pendentes dela em outra, uma vez.
    rodarTrabalhoDestaVez: (trabalhoId: string, maquinaId: string) =>
      post<{ turnos: number; motivo?: "ja_refeito" | null }>(`trabalhos/${encodeURIComponent(trabalhoId)}/rodar-desta-vez`, { maquinaId }),
    rodarDestaVez: (conversaId: string, maquinaId: string, turnoId?: string, contaId?: string) =>
      post<{ turnos: number; turnoId?: string | null; motivo?: MotivoDaNota | null }>(`conversas/${encodeURIComponent(conversaId)}/rodar-desta-vez`, { maquinaId, ...(turnoId ? { turnoId } : {}), ...(contaId ? { contaId } : {}) }),
    // ADR-102: as contas de IA da pessoa em todas as máquinas, o login numa máquina pela tela e o convite da VM.
    contasIa: () => get<ContasIaDto>("contas-ia"),
    ordemContas: (ids: string[]) => pedir<null>("PUT", `${base}/contas-ia/ordem`, { ids }),
    modoContas: (modo: ModoDasContas) => pedir<null>("PUT", `${base}/contas-ia/modo`, { modo }),
    mudarConta: (id: string, corpo: { apelido?: string; entraNaTrocaAutomatica?: boolean }) => patch<null>(`contas-ia/${encodeURIComponent(id)}`, corpo),
    sairDaConta: (id: string, maquinaId: string) => post<{ ok: true }>(`contas-ia/${encodeURIComponent(id)}/sair`, { maquinaId }),
    removerConta: (id: string) => del<{ ok: true }>(`contas-ia/${encodeURIComponent(id)}`),
    seguirComConta: (id: string, conversaId: string, turnoId?: string) =>
      post<{ turnoId?: string | null; motivo?: MotivoDaNota | null }>(`contas-ia/${encodeURIComponent(id)}/seguir`, { conversaId, ...(turnoId ? { turnoId } : {}) }),
    tentarDeNovoConta: (id: string, p: { conversaId?: string; turnoId?: string }) =>
      post<{ turnoId?: string | null; motivo?: MotivoDaNota | null; acordados?: number }>(`contas-ia/${encodeURIComponent(id)}/tentar-de-novo`, p),
    // ADR-108 (R4/R6): a escolha no aviso de troca de IA do bot.
    /** Revisão do PR 2 (I2): `trocaId` diz qual aviso (o bot pode ter um por IA). */
    decidirTrocaDeIa: (agenteId: string, decisao: DecisaoDaPessoa, trocaId?: string) => post<{ decisao: string; aplicada: boolean; tasks: number }>(`agentes/${encodeURIComponent(agenteId)}/troca-de-ia`, { decisao, ...(trocaId ? { trocaId } : {}) }),
    pedirLogin: (maquinaId: string, p: { ia: IaComConta; contaId?: string; apelido?: string | null }) => post<LoginNaMaquina>(`maquinas/${encodeURIComponent(maquinaId)}/logins`, p),
    verLogin: (maquinaId: string, loginId: string) => get<LoginNaMaquina>(`maquinas/${encodeURIComponent(maquinaId)}/logins/${encodeURIComponent(loginId)}`),
    colarCodigoLogin: (maquinaId: string, loginId: string, cifrado: CodigoCifrado) => post<{ ok: true }>(`maquinas/${encodeURIComponent(maquinaId)}/logins/${encodeURIComponent(loginId)}/codigo`, { cifrado }),
    cancelarLogin: (maquinaId: string, loginId: string) => post<{ ok: true }>(`maquinas/${encodeURIComponent(maquinaId)}/logins/${encodeURIComponent(loginId)}/cancelar`),
    renomearMaquina: (id: string, nome: string) => patch<{ id: string; nome: string }>(`maquinas/${encodeURIComponent(id)}`, { nome }),
    desconectarMaquina: (id: string, sairDasContas: boolean) => post<{ ok: true; contas: number; aguardandoMaquina: boolean }>(`maquinas/${encodeURIComponent(id)}/desconectar`, { sairDasContas }),
    criarConvite: () => post<{ convite: string; expiraEm: number }>("maquinas/convites"),
    verConvite: (convite: string) => get<{ estado: "pendente" } | { estado: "chegou"; codigo: string; pedido: { nome: string; plataforma: string; pedidoHaS: number } }>(`maquinas/convites/${encodeURIComponent(convite)}`),
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
  atual: () => pedirDeNovoSeCair<Escopo>("GET", "/api/sessao"),
  modo: () => pedirDeNovoSeCair<ModoSessaoDto>("GET", "/api/sessao/modo"),
  entrar: (pessoaId: string) => pedir<Escopo>("POST", "/api/sessao/entrar", { pessoaId }),
  urlGoogle: "/api/sessao/google",
};
