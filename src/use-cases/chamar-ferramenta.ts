import type { RuntimeEvent } from "../contracts/evento.ts";
import { FERRAMENTAS_NOD, type ContratoFerramentaNod, type JsonSchema, type NomeFerramentaNod } from "../contracts/ferramentas-nod.ts";
import type { Confianca } from "../contracts/mensagem.ts";
import type { MotivoNegacao } from "../contracts/motivos.ts";
import type { Negacao } from "../contracts/negacao.ts";
import type { FerramentaPlano, PlanoTurno } from "../contracts/plano-turno.ts";
import { USE_CASE_POR_FERRAMENTA, type ContextoFerramenta, type SaidaCasoDeUso } from "../contracts/servicos.ts";
import { normalizarPedidoAPessoa } from "./pedir-a-pessoa.ts";
import { nomeParaTrilha, registrarNegacao } from "./registrar-negacao.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

/** Corpo devolvido por POST /api/interno/ferramentas/:nome (o proxy consome; src/adapters/executor/cliente-nod.ts espelha). */
export type ResultadoChamada =
  | { ok: true; conteudo: string; confianca: Confianca; isError?: boolean; imagem?: { mimeType: "image/png"; data: string }; audio?: { mimeType: "audio/wav"; data: string } }
  | { ok: false; negacao: Negacao }
  | { aguardar: string };

export type EntradaChamarFerramenta = {
  /** Identidade derivada do TOKEN (rota interna), nunca do corpo (ADR-024). */
  turnoId: string;
  agenteId: string;
  nome: string;
  argumentos: unknown;
  /** Plano do turno guardado junto do token (services/token-turno.ts); null = plano ausente. */
  plano: PlanoTurno | null;
};

export const REGRA_CHAMADA = "regra:chamar_ferramenta" as const;
export const VERSAO_REGRA_CHAMADA = 1 as const;

// ---------------------------------------------------------------------------------------------
// Validação de argumentos pelo subconjunto JSON Schema de src/contracts/ferramentas-nod.ts.

function tipoDe(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

export function errosDoSchema(schema: JsonSchema, valor: unknown, caminho = "$"): string[] {
  const erros: string[] = [];
  if (schema.anyOf && !schema.anyOf.some((s) => errosDoSchema(s, valor, caminho).length === 0)) return [`${caminho}: nenhuma alternativa válida`];
  if (schema.oneOf && schema.oneOf.filter((s) => errosDoSchema(s, valor, caminho).length === 0).length !== 1) return [`${caminho}: esperado uma alternativa válida`];
  const t = tipoDe(valor);
  const esperado = schema.type === "integer" ? "number" : schema.type;
  if (schema.type && t !== esperado) return [`${caminho}: esperado ${schema.type}, veio ${t}`];
  if (schema.type === "integer" && !Number.isInteger(valor)) erros.push(`${caminho}: esperado inteiro`);
  if (schema.type === "string") {
    const s = valor as string;
    if (schema.minLength !== undefined && s.length < schema.minLength) erros.push(`${caminho}: mínimo ${schema.minLength} caracteres`);
    if (schema.maxLength !== undefined && s.length > schema.maxLength) erros.push(`${caminho}: máximo ${schema.maxLength} caracteres`);
    if (schema.enum && !schema.enum.includes(s)) erros.push(`${caminho}: valor fora de [${schema.enum.join(", ")}]`);
  }
  if (schema.type === "array") {
    const a = valor as unknown[];
    if (schema.minItems !== undefined && a.length < schema.minItems) erros.push(`${caminho}: mínimo ${schema.minItems} itens`);
    if (schema.maxItems !== undefined && a.length > schema.maxItems) erros.push(`${caminho}: máximo ${schema.maxItems} itens`);
    if (schema.items) a.forEach((item, i) => erros.push(...errosDoSchema(schema.items as JsonSchema, item, `${caminho}[${i}]`)));
  }
  if (schema.type === "object") {
    const o = valor as Record<string, unknown>;
    for (const r of schema.required ?? []) if (!(r in o)) erros.push(`${caminho}.${r}: obrigatório`);
    for (const [k, v] of Object.entries(o)) {
      const sub = schema.properties?.[k];
      if (sub) erros.push(...errosDoSchema(sub, v, `${caminho}.${k}`));
      else if (schema.additionalProperties === false) erros.push(`${caminho}.${k}: propriedade não prevista`);
    }
  }
  return erros;
}

/**
 * Parse validado: devolve os args TIPADOS da ferramenta nod ou a lista de erros. O único `as` deste
 * arquivo vive aqui, depois de o schema ter sido conferido — é a fronteira entre JSON e contrato.
 */
export function validarArgsNod<N extends NomeFerramentaNod>(nome: N, args: unknown): { ok: true; args: ContratoFerramentaNod[N]["args"] } | { ok: false; erros: string[] } {
  const erros = errosDoSchema(FERRAMENTAS_NOD[nome], args);
  if (erros.length > 0) return { ok: false, erros };
  return { ok: true, args: args as ContratoFerramentaNod[N]["args"] };
}

// ---------------------------------------------------------------------------------------------
// Despacho por tabela (EMENDA 5): cada nome tem o seu caso em UseCasesNod — a lista é FECHADA e
// tests/conformidade/capabilities-consumidas.test.ts prova que os nove nomes aparecem aqui.

type Despacho = { [N in NomeFerramentaNod]: (deps: Deps, ctx: ContextoFerramenta, args: ContratoFerramentaNod[N]["args"]) => Promise<SaidaCasoDeUso<ContratoFerramentaNod[N]["resultado"]>> };

const DESPACHO: Despacho = {
  lembrar: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.lembrar](deps, { ...ctx, ...args }),
  atualizar_perfil: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.atualizar_perfil](deps, { ...ctx, ...args }),
  pedir_acesso: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.pedir_acesso](deps, { ...ctx, ...args }),
  criar_rotina: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.criar_rotina](deps, { ...ctx, ...args }),
  listar_rotinas: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.listar_rotinas](deps, { ...ctx, ...args }),
  pausar_rotina: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.pausar_rotina](deps, { ...ctx, ...args }),
  reativar_rotina: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.reativar_rotina](deps, { ...ctx, ...args }),
  atualizar_rotina: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.atualizar_rotina](deps, { ...ctx, ...args }),
  excluir_rotina: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.excluir_rotina](deps, { ...ctx, ...args }),
  pedir_aprovacao: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.pedir_aprovacao](deps, { ...ctx, ...args }),
  pedir_a_pessoa: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.pedir_a_pessoa](deps, { ...ctx, ...args }),
  passar: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.passar](deps, { ...ctx, ...args }),
  encaminhar: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.encaminhar](deps, { ...ctx, ...args }),
  sem_novidade: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.sem_novidade](deps, { ...ctx, ...args }),
  perguntar_a_bot: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.perguntar_a_bot](deps, { ...ctx, ...args }),
};

function ehNomeNod(nome: string): nome is NomeFerramentaNod {
  return Object.prototype.hasOwnProperty.call(FERRAMENTAS_NOD, nome);
}

/** Valida pelo schema do nome e chama o caso correlato da tabela (união correlata: sem cast). */
async function rodarValidado<N extends NomeFerramentaNod>(deps: Deps, ctx: ContextoFerramenta, nome: N, args: unknown): Promise<SaidaCasoDeUso<ContratoFerramentaNod[N]["resultado"]> | { erros: string[] }> {
  const v = validarArgsNod(nome, args);
  if (!v.ok) return { erros: v.erros };
  return DESPACHO[nome](deps, ctx, v.args);
}

async function despacharNod(deps: Deps, ctx: ContextoFerramenta, nome: NomeFerramentaNod, args: unknown): Promise<{ resultado: ResultadoChamada; events: RuntimeEvent[] } | { erros: string[] }> {
  // EMENDA 16: pedir_a_pessoa nunca é recusada por args — malformado vira pergunta (julgamento humano).
  if (nome === "pedir_a_pessoa") {
    const saida = await DESPACHO.pedir_a_pessoa(deps, ctx, normalizarPedidoAPessoa(args));
    return { resultado: { ok: true, conteudo: JSON.stringify(saida.data), confianca: "confiavel" }, events: saida.events ?? [] };
  }
  const saida = await rodarValidado(deps, ctx, nome, args);
  if ("erros" in saida) return saida;
  const data: unknown = saida.data;
  if (nome === "pedir_aprovacao" && typeof data === "object" && data !== null && (data as { estado?: unknown }).estado === "pendente") {
    return { resultado: { aguardar: String((data as { decisao_id: string }).decisao_id) }, events: saida.events ?? [] };
  }
  return { resultado: { ok: true, conteudo: JSON.stringify(data), confianca: "confiavel" }, events: saida.events ?? [] };
}

// ---------------------------------------------------------------------------------------------

/**
 * Ponto de decisão do servidor para tools/call (ADR-013): gate de PARADA (consulta falhou = parada,
 * EMENDA 10) → plano válido e nome no catálogo → nod: valida args pelo schema e DESPACHA para
 * deps.useCases (EMENDA 5) → conector: exige conector habilitado e concessão ATIVA do agente (lida
 * agora, não no enfileirar — E6.4), aplica EMENDA 15 (rotina com gate: só readOnly fora de item
 * aprovado), chama services.conectores e marca o conteúdo como não confiável (ADR-026). Toda
 * chamada e toda negação deixam linha na trilha com a regra (E8.4).
 */
export const chamarFerramenta: CasoDeUso<EntradaChamarFerramenta, ResultadoChamada> = async (deps, input) => {
  const agora = deps.agora();
  const events: RuntimeEvent[] = [];
  const plano = input.plano;

  const negar = async (motivo: MotivoNegacao, classe: Negacao["classe"], conectorId: string | null = null, viaGateDeRotina = false): Promise<{ data: ResultadoChamada; events: RuntimeEvent[] }> => {
    const n = await registrarNegacao(deps, {
      turnoId: input.turnoId,
      agenteId: input.agenteId,
      conversaId: plano?.conversaId ?? null,
      nome: input.nome,
      motivo,
      classe,
      conectorId,
      viaGateDeRotina,
      autoria: plano?.autoria,
    });
    return { data: { ok: false, negacao: n.data }, events: [...events, ...(n.events ?? [])] };
  };

  if (!plano || plano.turnoId !== input.turnoId) return negar("plano_ausente", "plano_ausente");
  if (await deps.repos.agentes.execucaoBloqueada(input.turnoId)) return negar("parada_ativa", "ferramenta_negada");
  if (!(plano.expiraEm > agora)) return negar("plano_expirado", "plano_ausente");

  // Gate de parada: boolean | null — null (consulta falhou) É parada (fail-closed no caso de uso, EMENDA 10).
  const parada = await deps.repos.paradas.ativa(deps.escopo.pessoaId, plano.conversaId);
  if (parada !== false) return negar("parada_ativa", "ferramenta_negada");

  const ferramenta: FerramentaPlano | undefined = plano.catalogo.ferramentas.find((f) => f.nome === input.nome);
  if (!ferramenta) return negar("fora_do_catalogo", "ferramenta_negada");

  // O plano viaja no contexto para a regra do ADR-042 ser avaliada LOCALMENTE em pedir_aprovacao,
  // a partir do que já foi puxado — nunca por consulta na hora da chamada (ADR-013).
  const ctx: ContextoFerramenta = { turnoId: input.turnoId, agenteId: input.agenteId, conversaId: plano.conversaId, plano };
  const registrarChamada = (conectorId: string | null) =>
    deps.repos.trilha.registrar({ agenteId: input.agenteId, turnoId: input.turnoId, conectorId, ferramenta: nomeParaTrilha(input.nome), kind: "tool_call", regra: REGRA_CHAMADA, regraVersao: VERSAO_REGRA_CHAMADA, em: agora });

  if (ferramenta.origem === "nod") {
    if (!ehNomeNod(ferramenta.nome)) return negar("fora_do_catalogo", "ferramenta_negada");
    const r = await despacharNod(deps, ctx, ferramenta.nome, input.argumentos ?? {});
    if ("erros" in r) return negar("args_invalidos", "ferramenta_negada");
    await registrarChamada(null);
    if (plano.executor === "catcher") await deps.repos.catcher.registrar({ turnoId: input.turnoId, tipo: "tool_call", dados: { nome: input.nome, origem: "nod" } });
    return { data: r.resultado, events: [...events, ...r.events] };
  }

  // Conector: concessão ativa lida AGORA (E6.4) + conector habilitado + gate de rotina (EMENDA 15).
  const conectorId = ferramenta.conectorId;
  if (!conectorId) return negar("fora_do_catalogo", "ferramenta_negada");
  const conector = await deps.repos.conectores.buscar(conectorId);
  if (!conector || !conector.habilitado) return negar("capacidade_desligada", "ferramenta_negada", conectorId);
  const tool = ferramenta.nome.startsWith(`${conector.slug}__`) ? ferramenta.nome.slice(conector.slug.length + 2) : ferramenta.nome;
  const concessoes = await deps.repos.concessoes.doAgente(input.agenteId);
  if (!concessoes.some((c) => c.conectorId === conectorId && c.capacidade === tool)) return negar("capacidade_desligada", "ferramenta_negada", conectorId);
  if (plano.politicaExecucao.efeitoExternoSoPorAprovacao && !ferramenta.readOnlyHint) return negar("alcance_insuficiente", "ferramenta_negada", conectorId, true);
  const erros = errosDoSchema(ferramenta.schema, input.argumentos ?? {});
  if (erros.length > 0) return negar("args_invalidos", "ferramenta_negada", conectorId);

  await registrarChamada(conectorId);
  if (plano.executor === "catcher") await deps.repos.catcher.registrar({ turnoId: input.turnoId, tipo: "tool_call", dados: { nome: input.nome, origem: "conector", conector_id: conectorId } });
  try {
    const r = await deps.services.conectores.chamar(conectorId, tool, (input.argumentos ?? {}) as Record<string, unknown>);
    const conteudo = r.isError ? `erro do conector ${conector.slug}: ${r.conteudo}` : r.conteudo;
    return { data: { ok: true, conteudo, confianca: "nao_confiavel" }, events };
  } catch (e) {
    const motivo: MotivoNegacao = e instanceof Error && e.message === "timeout_transporte" ? "timeout_transporte" : "conector_indisponivel";
    await deps.repos.conectores.marcarFalha(conectorId, motivo, agora);
    return negar(motivo, "conector_indisponivel", conectorId);
  }
};
