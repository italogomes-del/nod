import type { BloqueioRotina, ExecucaoRotina, ParadaDaRotina } from "../../src/contracts/rotina.ts";
import { botao, esc } from "./render.ts";
import { desdeQuando, listaDeJanelas } from "./relogio.ts";

/**
 * definido em 2026-09-24 (ADR-045): quem parou a execução interrompida, em palavras — o Mac da pessoa
 * ou o servidor. Motivo sem tradução sai como está (dado técnico visível, nunca um buraco).
 */
const MOTIVO_HUMANO: Readonly<Record<string, string>> = {
  maquina_sem_contato: "seu Mac parou de responder",
  reinicio_servidor: "o servidor reiniciou",
  // definido em 2026-09-24: o pedido da execução foi dispensado ainda aberto (dispensar-decisao.ts).
  pedido_dispensado: "o pedido foi dispensado sem resposta",
  // definido em 2026-09-24 (fio da pergunta): a pergunta da execução venceu sem resposta (varredor-expiracao.ts).
  pergunta_sem_resposta: "ninguém respondeu a pergunta",
  // definido em 2026-10-01 (item 7 da ADR-066): a rotina só acorda com pendência e não havia nenhuma — sem turno.
  sem_pendencia: "sem pendência aberta, nenhum turno rodou",
};

/** definido em 2026-10-01 (item 7 da ADR-066): a rotina que só acorda com pendência, na lista de rotinas. */
export const TAG_SO_COM_PENDENCIA = '<span class="tag tag-cinza" title="sem pendência aberta do bot, a janela passa sem turno e sem custo; Testar agora roda sempre">só com pendência</span>';

/**
 * definido em 2026-09-24 (emenda da ADR-044): por que a janela ficou 'bloqueada' — o rótulo do histórico
 * é "parada (sem acesso)". Record sobre as chaves de MOTIVOS_BLOQUEIO_ROTINA (a web não importa valores de
 * src/): motivo novo sem rótulo não compila.
 */
const MOTIVO_DA_PARADA: Record<BloqueioRotina["motivo"] | "aguardando_resposta", string> = {
  sem_acesso: "sem acesso",
  sem_conexao: "sem conexão",
  aguardando_resposta: "aguardando resposta",
};

export function motivoDaExecucao(e: Pick<ExecucaoRotina, "motivo">): string | null {
  return e.motivo === null ? null : (MOTIVO_HUMANO[e.motivo] ?? e.motivo);
}

/**
 * "interrompida · seu Mac parou de responder", "parada (sem acesso)", "sem novidade · sem pendência aberta, nenhum turno
 * rodou" (a janela que o servidor passou sem turno, item 7 da ADR-066); os outros desfechos seguem só com o nome.
 */
export function rotuloExecucao(e: Pick<ExecucaoRotina, "desfecho" | "motivo">): string {
  if (e.desfecho === "bloqueada") {
    const motivo = e.motivo !== null && Object.hasOwn(MOTIVO_DA_PARADA, e.motivo) ? MOTIVO_DA_PARADA[e.motivo as keyof typeof MOTIVO_DA_PARADA] : e.motivo;
    return motivo ? `parada (${motivo})` : "parada";
  }
  const base = e.desfecho.replaceAll("_", " ");
  const motivo = e.desfecho === "interrompida" || e.motivo === "sem_pendencia" ? motivoDaExecucao(e) : null;
  return motivo ? `${base} · ${motivo}` : base;
}

/**
 * A rotina parada na lista e no painel (definido em 2026-09-24, emenda da ADR-044): a tag âmbar diz qual
 * app falta, e o MESMO botão de um clique do card ("Permitir e rodar agora") — ou "Conectar", quando o
 * card ainda é o de conexão e não há o que permitir. O card é um por agente e app: se ele é de OUTRA rotina
 * do agente, permitir não roda esta na hora, e o botão diz só "Permitir acesso".
 */
export function tagDaParada(b: BloqueioRotina): string {
  const falta = b.motivo === "sem_conexao" ? `falta conectar o ${b.app}` : `falta acesso ao ${b.app}`;
  return `<span class="tag tag-ambar" title="a rotina não roda até você liberar; nenhuma janela parada gastou crédito">parada · ${esc(falta)}</span>`;
}

export function botaoDaParada(b: BloqueioRotina, classe = "pri"): string {
  if (!b.decisaoId) return botao("abrir-conexao", "Conectar", { classe, id: b.slug });
  return b.rodaNaHora
    ? botao("decidir-proposta", "Permitir e rodar agora", { classe, id: b.decisaoId })
    : botao("decidir-proposta", "Permitir acesso", { classe, id: b.decisaoId, titulo: "o pedido é de outra rotina deste bot; esta roda na próxima janela" });
}

/** "desde ontem 13:00" ao lado da tag do card (a primeira janela que não rodou). */
export function desdeDaParada(p: ParadaDaRotina, agora: number): string {
  return desdeQuando(p.desde, agora, p.fusoIana);
}

/** "Não rodaram: ontem 13:00, ontem 18:00 e hoje 08:00. Nenhuma tentativa gastou crédito." — vazio sem janela parada. */
export function linhaNaoRodaram(p: ParadaDaRotina | null, agora: number): string {
  if (!p || p.naoRodaram.length === 0) return "";
  const verbo = p.naoRodaram.length === 1 ? "Não rodou" : "Não rodaram";
  return `<p class="dec-nao-rodaram">${esc(`${verbo}: ${listaDeJanelas(p.naoRodaram, agora, p.fusoIana)}. Nenhuma tentativa gastou crédito.`)}</p>`;
}
