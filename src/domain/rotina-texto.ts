import { assertFusoIana, parseCron5, proximaJanela, RotinaInvalida } from "./rotina-janela.ts";

/**
 * Regra 9: NENHUM parser de intenção sobrevive aqui. interpretarRotinaTexto/textoTemRecorrencia
 * foram apagados em 2026-09-16 — a rotina chega TIPADA pela ferramenta criar_rotina (o modelo
 * interpreta; o domínio valida e normaliza). Ficam o resumo humano e o validador.
 */
export type RotinaNormalizada = {
  cron: string;
  fusoIana: string;
  instrucao: string;
  fonte: string;
  entregavel: string;
  limitesAprovacao: string;
  politicaSemDado: string;
  /** Gate SEMPRE ligado: não sai do texto (E7.3). */
  exigeAprovacao: true;
  /** definido em 2026-10-01 (item 7 da ADR-066): só acorda com pendência visível; ausente na entrada = false. */
  soComPendencia: boolean;
  proximaExecucao: number;
  resumo: string;
};

const NOMES_DIA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"] as const;
const NOMES_MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"] as const;

function hhmm(hora: number, minuto: number): string {
  return `${String(hora).padStart(2, "0")}:${String(minuto).padStart(2, "0")}`;
}

/** Resumo em português do cron, com fuso nomeado: "dias úteis às 08:00 (America/Sao_Paulo)". */
export function resumoCron(cron: string, fusoIana: string): string {
  const c = parseCron5(cron);
  const [minuto, hora] = cron.trim().split(/\s+/);
  let horario: string;
  if (hora === "*" && (minuto === "*" || minuto?.startsWith("*/"))) horario = `a cada ${minuto === "*" ? 1 : Number(minuto?.slice(2))} min`;
  else if (hora?.startsWith("*/") && c.minuto.length === 1) horario = `a cada ${Number(hora.slice(2))} horas, no minuto ${c.minuto[0]}`;
  else if (hora === "*" && c.minuto.length === 1) horario = `a cada hora, no minuto ${c.minuto[0]}`;
  else horario = `às ${c.hora.flatMap((h) => c.minuto.map((m) => hhmm(h, m))).join(", ")}`;
  const partes: string[] = [];
  if (c.diasSemana === "uteis") partes.push("dias úteis");
  else if (c.diasSemana !== "*") partes.push(`toda ${c.diasSemana.map((d) => NOMES_DIA[d] ?? String(d)).join(", ")}`);
  if (c.diasMes !== "*") partes.push(`dia ${c.diasMes.join(", ")}`);
  if (c.mes !== "*") partes.push(`de ${c.mes.map((m) => NOMES_MES[m - 1] ?? String(m)).join(", ")}`);
  const quando = partes.length === 0 ? "todo dia" : partes.join(" ");
  return `${quando} ${horario} (${fusoIana})`;
}

function textoObrigatorio(valor: unknown, campo: string): string {
  if (typeof valor !== "string" || valor.trim() === "") throw new RotinaInvalida("entrada_invalida", `${campo} vazio`);
  return valor.trim();
}

/**
 * O flag `so_com_pendencia` (definido em 2026-10-01, item 7 da ADR-066): ausente = false; presente tem de ser
 * boolean de verdade. "true" em texto ou 1 é recusado em vez de lido como intenção — o schema da ferramenta já
 * diz boolean, e o domínio não adivinha (Regra 9).
 */
function flagOpcional(valor: unknown, campo: string): boolean {
  if (valor === undefined) return false;
  if (typeof valor !== "boolean") throw new RotinaInvalida("entrada_invalida", `${campo} não é boolean`);
  return valor;
}

/**
 * Valida a rotina TIPADA vinda de criar_rotina e devolve a forma persistível com próxima execução.
 * Lança fuso_invalido / cron_sem_futuro / entrada_invalida; nunca lê intenção de texto.
 */
export function validarRotinaNormalizada(entrada: {
  cron: string;
  fusoIana: string;
  instrucao: string;
  fonte: string;
  entregavel: string;
  limitesAprovacao: string;
  politicaSemDado: string;
  soComPendencia?: boolean;
  agora: number;
}): RotinaNormalizada {
  assertFusoIana(entrada.fusoIana);
  const cron = textoObrigatorio(entrada.cron, "cron");
  parseCron5(cron);
  const proximaExecucao = proximaJanela({ cron, fusoIana: entrada.fusoIana, agora: entrada.agora });
  return {
    cron,
    fusoIana: entrada.fusoIana,
    instrucao: textoObrigatorio(entrada.instrucao, "instrucao"),
    fonte: textoObrigatorio(entrada.fonte, "fonte"),
    entregavel: textoObrigatorio(entrada.entregavel, "entregavel"),
    limitesAprovacao: textoObrigatorio(entrada.limitesAprovacao, "limitesAprovacao"),
    politicaSemDado: textoObrigatorio(entrada.politicaSemDado, "politicaSemDado"),
    exigeAprovacao: true,
    soComPendencia: flagOpcional(entrada.soComPendencia, "soComPendencia"),
    proximaExecucao,
    resumo: resumoCron(cron, entrada.fusoIana),
  };
}

/** Os campos que atualizar_rotina pode mudar; ausente = fica como está. */
export type CamposRotinaAtualizaveis = Partial<Pick<RotinaNormalizada, "cron" | "fusoIana" | "instrucao" | "fonte" | "entregavel" | "limitesAprovacao" | "politicaSemDado" | "soComPendencia">>;

/**
 * Atualização PARCIAL: funde o pedido sobre a rotina atual e revalida o conjunto INTEIRO pelo
 * mesmo validarRotinaNormalizada. Assim um cron novo com o fuso antigo (ou o contrário) é checado
 * junto, e não há um segundo caminho de validação para divergir do primeiro.
 * `mudou` lista os campos que de fato mudam — pedido que não muda nada é `entrada_invalida`,
 * porque virar proposta vazia só gastaria a confirmação da pessoa. `mudaAcessos` (definido em
 * 2026-09-24, "rotina nasce com o acesso"): a mudança que só declara acessos novos também é mudança.
 * `soComPendencia` (definido em 2026-10-01, item 7 da ADR-066): trocar só o flag é mudança; ausente no `atual`
 * (chamada anterior à 0045) conta como false.
 */
export function validarAtualizacaoRotina(entrada: {
  atual: Pick<RotinaNormalizada, "cron" | "fusoIana" | "instrucao" | "fonte" | "entregavel" | "limitesAprovacao" | "politicaSemDado"> & { soComPendencia?: boolean };
  pedido: CamposRotinaAtualizaveis;
  agora: number;
  mudaAcessos?: boolean;
}): { normalizada: RotinaNormalizada; mudou: (keyof CamposRotinaAtualizaveis)[] } {
  const chaves = ["cron", "fusoIana", "instrucao", "fonte", "entregavel", "limitesAprovacao", "politicaSemDado"] as const;
  const { soComPendencia: flagAtual, ...textos } = entrada.atual;
  const fundido = { ...textos, soComPendencia: flagAtual ?? false };
  const mudou: (keyof CamposRotinaAtualizaveis)[] = [];
  for (const k of chaves) {
    const v = entrada.pedido[k];
    if (v === undefined) continue;
    const limpo = textoObrigatorio(v, k);
    if (limpo === entrada.atual[k]) continue;
    fundido[k] = limpo;
    mudou.push(k);
  }
  if (entrada.pedido.soComPendencia !== undefined) {
    const flag = flagOpcional(entrada.pedido.soComPendencia, "soComPendencia");
    if (flag !== fundido.soComPendencia) {
      fundido.soComPendencia = flag;
      mudou.push("soComPendencia");
    }
  }
  if (mudou.length === 0 && entrada.mudaAcessos !== true) throw new RotinaInvalida("entrada_invalida", "nenhum campo muda");
  return { normalizada: validarRotinaNormalizada({ ...fundido, agora: entrada.agora }), mudou };
}
