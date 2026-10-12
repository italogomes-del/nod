import type { ModoTurno } from "../contracts/plano-turno.ts";
import type { OrigemTurno } from "../contracts/turno.ts";

/**
 * A triagem na entrada (definido em 2026-10-12, ADR-099 itens 1, 1a e 8, issue I7 revista; decisão 9 do plano): o pedido
 * de um colega (`pedir_a_bot`) e o de uma rotina ("rodar <rotina>") entram como um turno CURTO do dono — a conversa do bot,
 * na faixa dela, sem trabalho —, depois das falas da pessoa na ordem do `reivindicar`. Nesse turno o dono decide: responde
 * já, abre frentes (`abrir_frentes`, o lote fica ligado ao turno), junta a uma frente que já mexe na mesma coisa
 * (`mandar_para_frente`) ou espera uma dependência. Regras puras; quem lê o banco e grava são os casos de uso.
 */

type TurnoDaFaixa = { origem: OrigemTurno; trabalhoId?: string | null };

/**
 * O turno que atende um pedido de colega na triagem do dono: origem `delegacao`, fora de trabalho. É o critério da I3 para
 * saber que um lote é de colega (pelo `aberto_por_turno_id`); quem pediu sai do `peer_pedido` ligado à raiz
 * (`pedidoDeColegaDoTurno`, src/use-cases/pedido-de-colega.ts), o mesmo que `entregarRespostaPeer` usa. O pedido de antes
 * (uma task de colega, ADR-083) tem trabalho e não é triagem.
 */
export function ehTriagemDeColega(t: TurnoDaFaixa): boolean {
  return t.origem === "delegacao" && !t.trabalhoId;
}

/**
 * O turno está na triagem (o prompt ganha as linhas dela): pedido de colega ou de rotina, fora de trabalho, com
 * `abrir_frentes` no catálogo. A retomada de um deles conta igual (ela continua o mesmo pedido, no mesmo modo).
 */
export function emTriagem(p: { modo: ModoTurno; trabalho: unknown; abreFrentes: boolean }): boolean {
  return (p.modo === "delegacao" || p.modo === "rotina") && (p.trabalho === null || p.trabalho === undefined) && p.abreFrentes;
}

/**
 * A pessoa está esperando o pedido? (ADR-085, revisão do #209): ele nasceu num turno dela — conversa, sala ou ligação,
 * fora de task. As frentes que o dono abre para esse pedido não são seguradas pelo Mac apertado; as de um pedido que
 * nasceu numa task, numa rotina ou noutro pedido de colega seguem a regra do segundo plano.
 */
export function pessoaEsperaOPedido(deQuemPediu: TurnoDaFaixa | null): boolean {
  return deQuemPediu !== null && !deQuemPediu.trabalhoId && ["conversa", "sala", "ligacao"].includes(deQuemPediu.origem);
}

/** Um pedido de colega ainda sem resposta: `de` pediu a `para`. */
export type PedidoAberto = { de: string; para: string };

/**
 * Espera circular (ADR-099 item 8): o pedido novo `remetente → alvo` fecha um ciclo se, pelos pedidos abertos, o alvo já
 * espera o remetente — direto (o alvo pediu ao remetente) ou em qualquer profundidade (o alvo pediu a X, que pediu ao
 * remetente). Busca em largura do alvo até o remetente. Devolve o caminho `[alvo, …, remetente]` ou null.
 */
export function cicloDoPedido(abertos: readonly PedidoAberto[], remetente: string, alvo: string): string[] | null {
  const saidas = new Map<string, string[]>();
  for (const p of abertos) saidas.set(p.de, [...(saidas.get(p.de) ?? []), p.para]);
  const veio = new Map<string, string | null>([[alvo, null]]);
  const fila = [alvo];
  while (fila.length > 0) {
    const atual = fila.shift() as string;
    if (atual === remetente) {
      const caminho: string[] = [];
      for (let p: string | null = atual; p !== null; p = veio.get(p) ?? null) caminho.unshift(p);
      return caminho;
    }
    for (const proximo of saidas.get(atual) ?? []) {
      if (veio.has(proximo)) continue;
      veio.set(proximo, atual);
      fila.push(proximo);
    }
  }
  return null;
}

function emLista(nomes: readonly string[]): string {
  return nomes.length <= 1 ? (nomes[0] ?? "") : `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

/**
 * O que o bot lê quando o pedido é recusado por espera circular. `caminho` são os nomes de `[alvo, …, remetente]`: o
 * último é quem está pedindo agora ("você"). O que fazer: não pedir, responder com o que tem e dizer o que falta.
 */
export function instrucaoEsperaCircular(caminho: readonly string[]): string {
  const alvo = caminho[0] ?? "o colega";
  const meio = caminho.slice(1, -1);
  const como = meio.length === 0 ? `${alvo} pediu algo a você e ainda espera a sua resposta` : `${alvo} pediu algo a ${meio.join(", que pediu a ")}, que pediu a você, e essa corrente ainda espera a sua resposta`;
  return `Espera circular: ${como}. Se você pedir a ${alvo} agora, um fica esperando o outro. Não peça: termine o que der com o que você já tem e, na sua resposta, diga o que falta e o que precisa de ${alvo} — a pergunta vai junto com a resposta.`;
}

/**
 * A resposta imediata a quem pediu (ADR-099 item 8): o pedido entrou na triagem do dono do outro bot, que decide se
 * responde já, abre uma frente ou espera algo de que depende; e, se houver, os colegas livres agora (sem turno vivo nem
 * frente rodando), para quem tem pressa.
 */
export function instrucaoPedidoRecebido(alvoNome: string, livres: readonly string[]): string {
  const base = `Pedido entregue a ${alvoNome}: entrou na triagem dele, que decide se responde já, se abre uma frente para o pedido ou se ele espera algo de que depende. A resposta chega a você num novo turno; diga em uma frase o que pediu e encerre, sem repetir o pedido.`;
  return livres.length > 0 ? `${base} Livres agora: ${emLista(livres)} — se for urgente e ${alvoNome} estiver ocupado, um deles pode ajudar.` : base;
}

/**
 * A linha do prompt na triagem (definido em 2026-10-12, ADR-099 item 1a, I7 revista), no lugar da linha "Frentes:" do
 * dono: o turno é curto e decide — responder já, abrir frentes, juntar a uma frente que já mexe na mesma coisa ou
 * esperar. No pedido de colega o resultado das frentes vai direto a quem pediu (decisão 7); na rotina, volta ao dono.
 */
export function linhaDaTriagem(modo: "delegacao" | "rotina", remetente: string | null): string {
  const quem = remetente ?? "quem pediu";
  return modo === "delegacao"
    ? `Triagem: este turno é a entrada de um pedido de ${quem} na sua fila, e é curto — decida e encerre; a conversa com a pessoa espera ele acabar. Olhe os Trabalhos em andamento e escolha: responda já, se for rápido; abra frentes para o pedido (abrir_frentes, numa chamada só), e o resultado delas vai direto a ${quem}; se uma frente aberta já mexe na mesma coisa, junte com mandar_para_frente em vez de abrir outra; se o pedido depende de algo que ainda não acabou, marque a volta (me_chame_as). Ao juntar ou esperar, diga a ${quem} em uma frase de que depende e quando volta; marque a volta se ${quem} precisa do resultado. Trabalho longo não se faz aqui.`
    : "Triagem: esta execução da rotina é um pedido na sua fila, e o turno é curto. Olhe os Trabalhos em andamento: o que é rápido você faz aqui mesmo; trabalho longo vai para frentes (abrir_frentes, numa chamada só), e o resultado delas volta a você para fechar a execução; se uma frente aberta já mexe na mesma coisa, junte com mandar_para_frente em vez de abrir outra; se depende de algo que ainda não acabou, marque a volta (me_chame_as).";
}
