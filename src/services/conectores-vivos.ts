import { criarClienteMcp, ErroTransporteMcp, type ClienteMcp } from "../adapters/mcp-proxy/cliente-mcp.ts";
import { sondarConector, type ConfigSonda } from "../adapters/mcp-proxy/probe.ts";
import type { Conector } from "../contracts/conector.ts";
import { COMANDO_GITHUB_NATIVO } from "../contracts/github.ts";
import type { ResultadoSonda, ServicesNod } from "../contracts/servicos.ts";
import { montarAmbiente } from "../domain/ambiente-executor.ts";
import { log } from "../obs/log.ts";
import { CHAMADA_CONECTOR_MS } from "../shared/constantes.ts";
import type { Relogio } from "../shared/types.ts";

/**
 * Cache de clientes MCP dos conectores no PROCESSO DO SERVIDOR (core-features §credencial: o env
 * decifrado nunca sai daqui; o proxy na máquina da pessoa só fala com o servidor). SEM BANCO
 * (EMENDA 3): quem carrega o conector e decifra o env é o callback `carregar`, injetado pela
 * composição (L9) com repos + src/db/cifra.ts. Uma chamada por vez por conector (o cliente
 * serializa); cliente que cai é descartado e a próxima chamada respawna.
 */
export type ContextoChamada = { rotina: boolean };

export type ConfigConectorVivo = ConfigSonda & {
  /**
   * definido em 2026-09-24 (ADR-048): credencial com validade (token de instalação do GitHub App, 1 h).
   * Depois deste instante o cliente vivo é descartado e a próxima chamada recarrega com um novo.
   */
  expiraEm?: number;
};

export type OpcoesConectoresVivos = {
  /**
   * Devolve a configuração com env DECIFRADO, ou null se o conector não existe/não é visível.
   * `contexto.rotina` (ADR-048): o conector nativo do GitHub só pode usar o App da organização em
   * turno de rotina — por isso o cliente vivo é guardado por (conector, rotina).
   */
  carregar(conectorId: string, contexto: ContextoChamada): Promise<ConfigConectorVivo | null>;
  /**
   * definido em 2026-09-24 (ADR-048): a sonda de conector NATIVO, sem processo — o catálogo é o
   * contrato e o jeito já foi conferido na entrada. null = não é nativo, segue a sonda de sempre.
   */
  sondarNativo?(conector: Conector): Promise<ResultadoSonda | null>;
  agora: Relogio;
  /** definido em 2026-09-16: 15 s — teto da chamada a conector; acima disso é conector_indisponivel para o modelo (o teto do tools/call do CLI é medido pela L4). */
  timeoutChamadaMs?: number;
  ambiente?: Readonly<Record<string, string | undefined>>;
  fetchImpl?: typeof fetch;
};

export { CHAMADA_CONECTOR_MS };

export type ConectoresVivos = ServicesNod<unknown>["conectores"] & {
  fechar(): Promise<void>;
  /** Quantos clientes vivos (métrica/testes). */
  vivos(): number;
};

export function criarConectoresVivos(opcoes: OpcoesConectoresVivos): ConectoresVivos {
  const clientes = new Map<string, ClienteMcp>();
  const validade = new Map<string, number>();
  const timeout = opcoes.timeoutChamadaMs ?? CHAMADA_CONECTOR_MS;

  const chave = (conectorId: string, contexto: ContextoChamada) => `${conectorId}|${contexto.rotina ? "rotina" : "interativo"}`;

  async function clienteDe(conectorId: string, contexto: ContextoChamada): Promise<ClienteMcp> {
    const k = chave(conectorId, contexto);
    const existente = clientes.get(k);
    const vence = validade.get(k);
    if (existente && (vence === undefined || vence > opcoes.agora())) return existente;
    if (existente) await descartarChave(k);
    const cfg = await opcoes.carregar(conectorId, contexto);
    if (!cfg) throw new ErroTransporteMcp("conector_indisponivel", "conector não carregado");
    const env = cfg.transporte === "http" ? { ...(cfg.env ?? {}) } : { ...montarAmbiente("servidor", opcoes.ambiente ?? process.env), ...(cfg.env ?? {}) };
    const c = criarClienteMcp({ nome: cfg.nome, transporte: cfg.transporte, comando: cfg.comando ?? null, args: cfg.args ?? [], url: cfg.url ?? null, env, timeoutMs: timeout, fetchImpl: opcoes.fetchImpl });
    clientes.set(k, c);
    if (cfg.expiraEm !== undefined) validade.set(k, cfg.expiraEm);
    return c;
  }

  async function descartarChave(k: string): Promise<void> {
    const c = clientes.get(k);
    clientes.delete(k);
    validade.delete(k);
    if (c) await c.fechar().catch(() => undefined);
  }

  async function descartar(conectorId: string): Promise<void> {
    for (const k of [...clientes.keys()]) if (k.startsWith(`${conectorId}|`)) await descartarChave(k);
  }

  return {
    async chamar(conectorId, tool, args, contexto = { rotina: false }) {
      const c = await clienteDe(conectorId, contexto);
      try {
        return await c.chamar(tool, args);
      } catch (e) {
        log("aviso", "conector_chamada_falhou", { conector_id: conectorId, ferramenta: tool, motivo: e instanceof ErroTransporteMcp ? e.motivo : "falha_tecnica" });
        await descartarChave(chave(conectorId, contexto));
        throw e;
      }
    },

    async sondar(conector: Conector): Promise<ResultadoSonda> {
      // A sonda usa o env DECIFRADO via carregar; o `conector` recebido só traz placeholders (ConectorGuardado).
      await descartar(conector.id);
      if (conector.comando === COMANDO_GITHUB_NATIVO) return (await opcoes.sondarNativo?.(conector)) ?? { ok: false, motivo: "conector_indisponivel" };
      const cfg = (await opcoes.carregar(conector.id, { rotina: false })) ?? { nome: conector.slug, transporte: conector.transporte, comando: conector.comando, args: conector.args, url: conector.url, env: {} };
      return sondarConector(cfg, { ambiente: opcoes.ambiente, fetchImpl: opcoes.fetchImpl });
    },

    async fechar() {
      for (const k of [...clientes.keys()]) await descartarChave(k);
    },

    vivos() {
      return clientes.size;
    },
  };
}
