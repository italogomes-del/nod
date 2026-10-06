import type { Preferencias, RaioXConversa, RaioXTurno } from "../contracts/raio-x.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { resumoDoRaioX } from "../domain/raio-x.ts";
import type { CasoDeUso } from "./tipos.ts";

/** Turnos que a faixa dev cobre numa conversa: os mais recentes, o bastante para a tela aberta. */
export const TURNOS_NO_RAIO_X_DA_CONVERSA = 300;

export const lerPreferencias: CasoDeUso<Record<string, never>, Preferencias> = async (deps) => ({ data: await deps.repos.preferencias.buscar() });

export const gravarPreferencias: CasoDeUso<{ modoDev: unknown }, Preferencias> = async (deps, input) => {
  if (typeof input.modoDev !== "boolean") throw new ErroDeDominio("entrada_invalida", { cause: "modoDev" });
  return { data: await deps.repos.preferencias.gravar({ modoDev: input.modoDev }) };
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
  const [turnos, desde] = await Promise.all([
    deps.repos.raioX.daConversa(input.conversaId, TURNOS_NO_RAIO_X_DA_CONVERSA),
    deps.repos.raioX.totalDesde(input.conversaId, input.desde),
  ]);
  return {
    data: {
      turnos: turnos.filter((t) => t.execucao !== null || t.custoUsd !== null).map((t) => resumoDoRaioX(t.turnoId, t.custoUsd, t.execucao)),
      desde,
    },
  };
};
