import { appendFileSync } from "node:fs";
import type { Readable, Writable } from "node:stream";
import { pathToFileURL } from "node:url";
import type { Negacao } from "../../contracts/negacao.ts";
import type { PlanoTurno } from "../../contracts/plano-turno.ts";
import { LONGPOLL_APROVACAO_MS, ORCAMENTO_RESULTADO_CHARS } from "../../shared/constantes.ts";
import type { Relogio } from "../../shared/types.ts";
import { ferramentaDoPlano, ferramentasMcp, validadeDoPlano } from "./catalogo.ts";
import { criarClienteNod, ehFalhaTransporte, type ClienteNod } from "./cliente-nod-stub.ts";
import { PROTOCOLO_MCP } from "./cliente-mcp.ts";
import { cortar } from "./corte.ts";
import { CODIGO, erro, interpretar, resposta, type IdJsonRpc } from "./jsonrpc.ts";
import { criarLineSplitter } from "./line-splitter.ts";
import { envolverNaoConfiavel, neutralizarDelimitadores } from "./moldura.ts";
import { conteudoNegado, negacaoConectorIndisponivel, negacaoFerramenta, negacaoPlanoAusente, type ConteudoMcp } from "./negacao.ts";

/**
 * Proxy MCP do nod (ADR-013, ADR-024): o ÚNICO servidor MCP que o CLI enxerga. JSON-RPC 2.0 sobre
 * stdio, sem SDK. Consome SÓ o plano de turno (GET /api/interno/plano com o Bearer do token):
 * sem token, sem plano, plano expirado ou catálogo vazio → tools/list [] e tools/call negado com
 * classe plano_ausente (fail-closed renderizado, ADR-029). tools/list nunca vem de cache: busca o
 * plano de novo a cada lista. tools/call é serializado (responder N antes de N+1) e despacha ao
 * servidor, que decide (parada, catálogo, concessão, trilha); aqui só o que é LOCAL por desenho:
 * nome fora do plano (terminal, avisa o servidor), servidor fora (conector_indisponivel com
 * `desde`), corte ao orçamento e moldura do conteúdo não confiável (ADR-026).
 *
 * NUNCA escreve em stdout fora do JSON-RPC (o CLI lê o stdout) nem usa src/obs/log.ts (console);
 * diagnóstico opcional vai para o arquivo NOD_PROXY_LOG (o CLI engole stderr, mapa-cli).
 */
export type OpcoesProxy = {
  cliente: ClienteNod;
  agora: Relogio;
  /** definido em 2026-09-16: uma fatia de LONGPOLL_APROVACAO_MS; sem decisão o modelo é mandado encerrar o turno. */
  longpollMs?: number;
  versao?: string;
  diagnostico?: (evento: string, campos?: Record<string, string | number | boolean | null>) => void;
};

export type Proxy = {
  /** Trata UMA linha JSON-RPC e devolve a resposta serializada (null para notificação). Exposto para teste. */
  tratarLinha(linha: string): Promise<string | null>;
  /** Liga stdin → tratarLinha → stdout, serializado. */
  ligar(entrada: Readable, saida: Writable): Promise<void>;
  estado(): { plano: PlanoTurno | null; semPlanoDesde: number | null; servidorForaDesde: number | null };
};

const INSTRUCAO_PENDENTE = "encerre o turno; a decisão retoma depois" as const;

function texto(t: string): ConteudoMcp {
  return { content: [{ type: "text", text: t }] };
}

export function criarProxy(opcoes: OpcoesProxy): Proxy {
  const { cliente, agora } = opcoes;
  const longpoll = opcoes.longpollMs ?? LONGPOLL_APROVACAO_MS;
  const diag = opcoes.diagnostico ?? (() => undefined);
  let plano: PlanoTurno | null = null;
  let semPlanoDesde: number | null = null;
  let servidorForaDesde: number | null = null;
  let fila: Promise<unknown> = Promise.resolve();

  async function buscarPlano(): Promise<void> {
    const r = await cliente.plano();
    if (r.ok) {
      plano = r.plano;
      semPlanoDesde = null;
      servidorForaDesde = null;
      diag("plano_recebido", { turno: r.plano.turnoId, ferramentas: r.plano.catalogo.ferramentas.length });
      return;
    }
    plano = null;
    if (r.motivo === "servidor_fora") servidorForaDesde ??= agora();
    semPlanoDesde ??= agora();
    diag("plano_ausente", { motivo: r.motivo, status: r.status });
  }

  function negarPlano(id: IdJsonRpc, motivo: "plano_ausente" | "plano_expirado" | "catalogo_vazio"): string {
    const n: Negacao = negacaoPlanoAusente(motivo, semPlanoDesde ?? agora());
    return erro(id, CODIGO.negacaoNod, `nenhum trabalho começa: ${motivo}`, n);
  }

  async function toolsCall(id: IdJsonRpc, params: unknown): Promise<string> {
    const p = (typeof params === "object" && params !== null ? params : {}) as { name?: unknown; arguments?: unknown };
    const nome = typeof p.name === "string" ? p.name : "";
    const argumentos = (typeof p.arguments === "object" && p.arguments !== null ? p.arguments : {}) as Record<string, unknown>;
    const v = validadeDoPlano(plano, agora());
    if (!v.ok) {
      if (v.motivo === "plano_expirado") semPlanoDesde ??= agora();
      return negarPlano(id, v.motivo);
    }
    const ferramenta = ferramentaDoPlano(v.plano, nome);
    if (!ferramenta) {
      // Decidido LOCALMENTE contra o plano (ADR-013): terminal; o servidor grava a trilha e pede interrupção.
      const n = negacaoFerramenta(nome || "(sem nome)", "fora_do_catalogo", agora());
      diag("negacao_local", { nome, motivo: n.motivo });
      await cliente.negacao(n).catch(() => undefined);
      return resposta(id, conteudoNegado(n, agora()));
    }
    const r = await cliente.ferramenta(nome, argumentos);
    if (ehFalhaTransporte(r)) {
      servidorForaDesde ??= agora();
      const n = negacaoConectorIndisponivel(nome, servidorForaDesde, r.transporte === "timeout" ? "timeout_transporte" : "conector_indisponivel");
      diag("servidor_fora", { nome, transporte: r.transporte, status: r.status });
      return resposta(id, conteudoNegado(n, agora()));
    }
    servidorForaDesde = null;
    if ("aguardar" in r) {
      const a = await cliente.aguardar(r.aguardar, longpoll);
      if (!ehFalhaTransporte(a) && a.estado === "decidida") {
        return resposta(id, texto(JSON.stringify({ estado: "decidida", itens: a.itens })));
      }
      return resposta(id, texto(JSON.stringify({ estado: "pendente", decisao_id: r.aguardar, instrucao: INSTRUCAO_PENDENTE })));
    }
    if (!r.ok) {
      diag("negacao_servidor", { nome, motivo: r.negacao.motivo, terminal: r.negacao.terminal });
      return resposta(id, conteudoNegado(r.negacao, agora()));
    }
    let conteudo = cortar(r.conteudo, v.plano.politicaExecucao.orcamentoResultadoChars || ORCAMENTO_RESULTADO_CHARS).texto;
    conteudo = neutralizarDelimitadores(conteudo);
    if (r.confianca === "nao_confiavel") {
      const origem = ferramenta.origem === "conector" ? (v.plano.catalogo.servidores.find((s) => s.conectorId === ferramenta.conectorId)?.nome ?? nome) : nome;
      conteudo = envolverNaoConfiavel(conteudo, origem);
    }
    return resposta(id, texto(conteudo));
  }

  async function tratarDentro(linha: string): Promise<string | null> {
    const m = interpretar(linha);
    if (m.tipo === "invalida") {
      return m.motivo === "json_invalido" ? erro(null, CODIGO.parseError, "JSON inválido") : erro(m.id, CODIGO.invalidRequest, "requisição inválida");
    }
    if (m.tipo === "resposta") return null;
    if (m.tipo === "notificacao") return null;
    const { id, metodo, params } = m;
    switch (metodo) {
      case "initialize": {
        await buscarPlano();
        const pv = (typeof params === "object" && params !== null ? (params as { protocolVersion?: unknown }).protocolVersion : undefined);
        return resposta(id, {
          protocolVersion: typeof pv === "string" ? pv : PROTOCOLO_MCP,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "nod", version: opcoes.versao ?? "0.1.0" },
        });
      }
      case "ping":
        return resposta(id, {});
      case "tools/list": {
        await buscarPlano();
        const v = validadeDoPlano(plano, agora());
        return resposta(id, { tools: v.ok ? ferramentasMcp(v.plano) : [] });
      }
      case "tools/call":
        return toolsCall(id, params);
      default:
        return erro(id, CODIGO.methodNotFound, `método não suportado: ${metodo}`);
    }
  }

  function tratarLinha(linha: string): Promise<string | null> {
    const r = fila.then(() => tratarDentro(linha));
    fila = r.catch(() => undefined);
    return r;
  }

  return {
    tratarLinha,
    estado: () => ({ plano, semPlanoDesde, servidorForaDesde }),
    ligar(entrada, saida) {
      const splitter = criarLineSplitter();
      const escrever = (l: string | null) => {
        if (l !== null) saida.write(`${l}\n`);
      };
      const tratar = (linha: string) => tratarLinha(linha).then(escrever, (e: unknown) => escrever(erro(null, CODIGO.internalError, e instanceof Error ? e.name : "falha interna")));
      return new Promise<void>((resolve) => {
        entrada.on("data", (chunk: Buffer | string) => {
          for (const linha of splitter.alimentar(chunk)) void tratar(linha);
        });
        entrada.on("end", () => {
          for (const linha of splitter.encerrar()) void tratar(linha);
          void fila.then(() => resolve());
        });
      });
    },
  };
}

/** Diagnóstico em ARQUIVO (NOD_PROXY_LOG): nunca stdout (é o canal JSON-RPC) nem console. */
function diagnosticoEmArquivo(caminho: string | undefined): OpcoesProxy["diagnostico"] {
  if (!caminho) return () => undefined;
  return (evento, campos = {}) => {
    try {
      appendFileSync(caminho, `${JSON.stringify({ ts: new Date().toISOString(), evento, ...campos })}\n`);
    } catch {
      // diagnóstico é best-effort
    }
  };
}

export async function main(env: Readonly<Record<string, string | undefined>> = process.env): Promise<void> {
  const url = env.NOD_URL ?? "";
  const token = env.NOD_TOKEN_TURNO ?? "";
  const semToken: ClienteNod = {
    plano: async () => ({ ok: false, motivo: "plano_ausente", status: null }),
    ferramenta: async () => ({ transporte: "falha_tecnica", status: null }),
    aguardar: async () => ({ transporte: "falha_tecnica", status: null }),
    negacao: async () => undefined,
  };
  const cliente = url && token ? criarClienteNod({ url, token }) : semToken;
  const proxy = criarProxy({ cliente, agora: () => Date.now(), diagnostico: diagnosticoEmArquivo(env.NOD_PROXY_LOG) });
  await proxy.ligar(process.stdin, process.stdout);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().then(() => process.exit(0));
}
