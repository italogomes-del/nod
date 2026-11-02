import type { ComentarioDto } from "../../src/contracts/quadro.ts";
import { esc } from "../lib/escape.ts";
import type { AgenteDoQuadro } from "./quadro-real.ts";
import { anel } from "./quadro.ts";

/**
 * Os comentários da tarefa aberta (NOD-417): uma conversa curta embaixo da descrição, com cara de mensagem e sem cartão
 * colorido. O da pessoa aciona o bot responsável; @Nome aciona outro bot sem trocar o responsável. Quem foi acionado
 * aparece numa linha fina embaixo do comentário.
 */

export const LIMITE_COMENTARIO = 4000;
export type CargaDosComentarios = "carregando" | "ok" | "erro";

function autorDe(c: ComentarioDto, agente: AgenteDoQuadro): { avatar: string; nome: string } {
  if (c.autor.tipo === "pessoa") return { avatar: anel("V", "Você", true), nome: "Você" };
  const a = agente(c.autor.agenteId);
  return a ?? { avatar: anel((c.autorNome ?? "?").slice(0, 1), c.autorNome ?? "Bot", false), nome: c.autorNome ?? "Bot" };
}

export function comentariosDaTarefa(o: { tarefaId: string; lista: readonly ComentarioDto[]; carga: CargaDosComentarios; agente: AgenteDoQuadro; hora: (em: number) => string }): string {
  const itens = o.lista.map((c) => {
    const a = autorDe(c, o.agente);
    const acionou = c.acionados.length ? `<p class="qd-com-acao">acionou ${esc(c.acionados.join(", "))}</p>` : "";
    return `<li class="qd-com"><span class="qd-com-av" aria-hidden="true">${a.avatar}</span><div class="qd-com-corpo">` +
      `<p class="qd-com-cab"><span class="qd-com-nome">${esc(a.nome)}</span><time>${esc(o.hora(c.criadoEm))}</time></p>` +
      `<p class="qd-com-txt">${esc(c.texto)}</p>${acionou}</div></li>`;
  }).join("");
  const estado = o.carga === "carregando" && !o.lista.length ? `<p class="qd-com-vazio">Carregando…</p>`
    : o.carga === "erro" ? `<p class="qd-com-vazio">Não consegui ler os comentários.</p>`
    : !o.lista.length ? `<p class="qd-com-vazio">Nenhum comentário ainda.</p>` : "";
  const id = `qd-com-${esc(o.tarefaId)}`;
  return `<section class="qd-coms" aria-labelledby="qd-coms-tit"><h2 class="qd-t-sec" id="qd-coms-tit">Comentários</h2>${estado}` +
    (itens ? `<ol class="qd-com-lista">${itens}</ol>` : "") +
    `<form class="qd-com-form" data-form="comentar-tarefa" data-id="${esc(o.tarefaId)}"><label class="qd-sr" for="${id}">Comentar</label>` +
    `<textarea id="${id}" class="qd-com-in" name="texto" rows="1" maxlength="${LIMITE_COMENTARIO}" required placeholder="Comentar… @nome chama outro bot"></textarea>` +
    `<button type="submit" class="qd-com-bt">Enviar</button></form></section>`;
}
