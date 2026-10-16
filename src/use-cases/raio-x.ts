import { USOS_DO_MAC, type Preferencias, type RaioXConversa, type RaioXTurno, type UsoDoMac } from "../contracts/raio-x.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { lerOrdemDaPessoa } from "../domain/inteligencia.ts";
import { resumoDoRaioX } from "../domain/raio-x.ts";
import type { CasoDeUso } from "./tipos.ts";

/** Turnos que a faixa dev cobre numa conversa: os mais recentes, o bastante para a tela aberta. */
export const TURNOS_NO_RAIO_X_DA_CONVERSA = 300;

export const lerPreferencias: CasoDeUso<Record<string, never>, Preferencias> = async (deps) => ({ data: await deps.repos.preferencias.buscar() });

/**
 * PUT preferencias: o que vier muda, o resto fica. revisto em 2026-10-12 (ADR-099, I10): `faixaTrabalhosRecolhida`
 * (ADR-083) saiu — a web não a mandava desde 09/10; vinda, é ignorada como qualquer chave desconhecida. revisto em 2026-10-08 (ADR-085): `usoDoMac` ('pouco' | 'equilibrado' | 'livre'), de Seu
 * espaço › Este Mac. revisto em 2026-10-10 (0068, emenda da ADR-036): `ordemIas`, a ordem do Automático arrastada em
 * Provedores de IA (lista das IAs integradas, completada no fim com as que faltarem; null = a padrão). Corpo sem nenhum
 * dos três, ou com valor fora do tipo, é entrada inválida.
 */
export const gravarPreferencias: CasoDeUso<{ modoDev?: unknown; usoDoMac?: unknown; ordemIas?: unknown }, Preferencias> = async (deps, input) => {
  const ok = (v: unknown) => v === undefined || typeof v === "boolean";
  const usoOk = input.usoDoMac === undefined || (typeof input.usoDoMac === "string" && (USOS_DO_MAC as readonly string[]).includes(input.usoDoMac));
  const nenhum = input.modoDev === undefined && input.usoDoMac === undefined && input.ordemIas === undefined;
  if (!ok(input.modoDev) || !usoOk || nenhum) throw new ErroDeDominio("entrada_invalida", { cause: "preferencias" });
  const ordemIas = input.ordemIas === undefined ? undefined : lerOrdemDaPessoa(input.ordemIas);
  return {
    data: await deps.repos.preferencias.gravar({
      ...(ordemIas !== undefined ? { ordemIas } : {}),
      ...(typeof input.modoDev === "boolean" ? { modoDev: input.modoDev } : {}),
      ...(input.usoDoMac !== undefined ? { usoDoMac: input.usoDoMac as UsoDoMac } : {}),
    }),
  };
};

/**
 * Chave de aviso da tela (0059): tipo e variante separados por ":", em minúsculas — "modo:total". Curta e fechada,
 * porque vira linha de banco de quem clica; o teto de 50 chaves da 0059 é guardado aqui antes (erro de entrada, não 500).
 */
const CHAVE_AVISO = /^[a-z][a-z0-9_-]{0,30}(:[a-z0-9_-]{1,30})?$/;
export const AVISOS_FECHADOS_MAX = 50;

export const fecharAviso: CasoDeUso<{ chave: unknown }, Preferencias> = async (deps, input) => {
  if (typeof input.chave !== "string" || !CHAVE_AVISO.test(input.chave)) throw new ErroDeDominio("entrada_invalida", { cause: "chave" });
  const atual = await deps.repos.preferencias.buscar();
  if (atual.avisosFechados.includes(input.chave)) return { data: atual };
  if (atual.avisosFechados.length >= AVISOS_FECHADOS_MAX) throw new ErroDeDominio("entrada_invalida", { cause: "avisos_fechados cheio" });
  return { data: await deps.repos.preferencias.fecharAviso(input.chave) };
};

/** O Raio-X inteiro de um turno (a gaveta). Turno que a pessoa não vê é nao_encontrado, como em GET turnos/:id. */
export const raioXDoTurno: CasoDeUso<{ turnoId: string }, RaioXTurno> = async (deps, input) => {
  const t = await deps.repos.raioX.doTurno(input.turnoId);
  if (!t) throw new ErroDeDominio("nao_encontrado", { cause: "turno" });
  return { data: t };
};

/** A faixa dev de cada resposta da conversa e o total desde `desde` (a meia-noite de quem pergunta). */
export const raioXDaConversa: CasoDeUso<{ conversaId: string; desde: number }, RaioXConversa> = async (deps, input) => {
  const [turnos, total, parcial] = await Promise.all([
    deps.repos.raioX.daConversa(input.conversaId, TURNOS_NO_RAIO_X_DA_CONVERSA),
    deps.repos.raioX.totalDesde(input.conversaId, input.desde),
    deps.repos.gastos.algumSemCusto({ desde: input.desde, ate: deps.agora(), conversaId: input.conversaId }),
  ]);
  const desde = parcial ? { ...total, parcial: true } : total;
  return {
    data: {
      turnos: turnos.filter((t) => t.execucao !== null || t.custoUsd !== null).map((t) => resumoDoRaioX(t.turnoId, t.custoUsd, t.execucao)),
      desde,
    },
  };
};
