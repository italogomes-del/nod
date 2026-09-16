import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { PlanoTurno } from "../contracts/plano-turno.ts";
import type { IdentidadeDeTurno, ServicesNod } from "../contracts/servicos.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { PLANO_VALIDADE_MS } from "../domain/plano-turno.ts";
import type { Relogio } from "../shared/types.ts";

/**
 * Token de turno (ADR-024, core-features §credencial): randomBytes(24), só em MEMÓRIA do servidor
 * (Map turnoId → {hash sha256, epoch, expira, identidade}); `autorizar` compara em tempo constante
 * e devolve a IDENTIDADE (tenant, pessoa, agente, turno) — o remetente nunca vem do texto. Cunhar de
 * novo para o mesmo turno avança o epoch e invalida o token anterior ("lança se a geração do turno
 * não for a ativa" vira: o token antigo simplesmente deixa de autorizar). O plano emitido fica
 * guardado junto do token: GET /api/interno/plano devolve `planoDe(turnoId)` (rotas/interno.ts).
 * SEM BANCO (EMENDA 3): reinício do servidor perde os tokens — o turno em curso cai em plano_ausente
 * e o varredor de lease assenta (ADR-010), nunca reenvia.
 */
export type IdentidadeSemTurno = Omit<IdentidadeDeTurno, "turnoId">;

export type TokenTurno = ServicesNod<unknown>["tokenTurno"] & {
  /** Assinatura CONCRETA: a identidade entra no cunhar (o contrato genérico só leva turnoId; ver PENDENCIA-CONTRATO.md). */
  cunhar(turnoId: string, identidade?: IdentidadeSemTurno): string;
  guardarPlano(plano: PlanoTurno): void;
  planoDe(turnoId: string): PlanoTurno | null;
  /** Quantos tokens vivos (métrica/testes). */
  ativos(): number;
};

export type OpcoesTokenTurno = {
  agora: Relogio;
  /** definido em 2026-09-16: mesma validade do plano (PLANO_VALIDADE_MS = 1 h); token sem plano válido não serve para nada. */
  validadeMs?: number;
  /** Resolve a identidade quando cunhar() vier só com o turnoId (composição da L9); sem isto e sem identidade, cunhar lança estado_invalido. */
  identidadeDe?: (turnoId: string) => IdentidadeSemTurno | null;
};

type Entrada = { hash: Buffer; epoch: number; expira: number; identidade: IdentidadeSemTurno; plano: PlanoTurno | null };

const hashDe = (token: string): Buffer => createHash("sha256").update(token).digest();

export function criarTokenTurno(opcoes: OpcoesTokenTurno): TokenTurno {
  const validade = opcoes.validadeMs ?? PLANO_VALIDADE_MS;
  const porTurno = new Map<string, Entrada>();
  const porHash = new Map<string, string>();

  function apagar(turnoId: string): void {
    const e = porTurno.get(turnoId);
    if (!e) return;
    porHash.delete(e.hash.toString("hex"));
    porTurno.delete(turnoId);
  }

  return {
    cunhar(turnoId: string, identidade?: IdentidadeSemTurno): string {
      const id = identidade ?? opcoes.identidadeDe?.(turnoId) ?? null;
      if (!id || !id.tenantId || !id.pessoaId || !id.agenteId) throw new ErroDeDominio("estado_invalido", { cause: "cunhar sem identidade do turno" });
      const anterior = porTurno.get(turnoId);
      apagar(turnoId);
      const token = randomBytes(24).toString("base64url");
      const hash = hashDe(token);
      porTurno.set(turnoId, { hash, epoch: (anterior?.epoch ?? 0) + 1, expira: opcoes.agora() + validade, identidade: id, plano: anterior?.plano ?? null });
      porHash.set(hash.toString("hex"), turnoId);
      return token;
    },

    autorizar(token) {
      if (typeof token !== "string" || token === "") return null;
      const hash = hashDe(token);
      const turnoId = porHash.get(hash.toString("hex"));
      if (!turnoId) return null;
      const e = porTurno.get(turnoId);
      if (!e || e.hash.length !== hash.length || !timingSafeEqual(e.hash, hash)) return null;
      if (e.expira <= opcoes.agora()) {
        apagar(turnoId);
        return null;
      }
      return { turnoId, ...e.identidade };
    },

    revogar(turnoId) {
      apagar(turnoId);
    },

    guardarPlano(plano) {
      const e = porTurno.get(plano.turnoId);
      if (!e) throw new ErroDeDominio("estado_invalido", { cause: "plano sem token cunhado" });
      e.plano = plano;
    },

    planoDe(turnoId) {
      return porTurno.get(turnoId)?.plano ?? null;
    },

    ativos() {
      return porTurno.size;
    },
  };
}
