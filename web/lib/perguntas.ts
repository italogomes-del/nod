import type { SuaVezDto } from "../../src/contracts/api.ts";
import type { TipoDecisao } from "../../src/contracts/decisao.ts";
import type { Mensagem } from "../../src/contracts/mensagem.ts";
import type { TIPOS_PEDIDO_A_PESSOA } from "../../src/contracts/pedido.ts";
import type { Estado } from "../estado/reducer.ts";

/**
 * Perguntas viram conversa (emenda da ADR-045, definido em 2026-09-24): a pergunta de pedir_a_pessoa
 * é a fala do agente na conversa, e a próxima mensagem da pessoa responde. Aqui mora o que é DERIVADO
 * do estado — que perguntas estão abertas, onde cada uma está, o que o campo faz — e o envio; o HTML
 * fica em web/telas/pergunta.ts. Nada lê o DOM, então tudo é testável sem navegador.
 */
export type ItemPergunta = SuaVezDto["itens"][number];

/**
 * Espelho EXATO de TIPOS_PEDIDO_A_PESSOA (src/contracts/pedido.ts) — a web só importa tipos de src/.
 * As chaves do Record são as do contrato: faltar ou sobrar um tipo não compila.
 */
const PERGUNTAS: Record<(typeof TIPOS_PEDIDO_A_PESSOA)[number], true> = { pergunta: true, falta_de_dado: true, permissao: true };

/** Os três tipos de pedir_a_pessoa: se respondem na conversa, nunca por card com caixa de texto. */
export function ehPergunta(tipo: TipoDecisao): boolean {
  return Object.hasOwn(PERGUNTAS, tipo);
}

/** Aberta NA FILA: pendente ou reaberta com prazo por vir (a coluna da fila já diz isso). */
function aberta(item: ItemPergunta): boolean {
  return item.estadoColuna !== "vencido";
}

/** Perguntas ABERTAS desta conversa na fila da pessoa, da mais antiga para a mais nova. */
export function perguntasAbertas(estado: Estado, conversaId: string): ItemPergunta[] {
  return (estado.suaVez?.itens ?? [])
    .filter((i) => i.decisao.conversaId === conversaId && aberta(i) && ehPergunta(i.decisao.tipo))
    .sort((a, b) => Date.parse(a.decisao.criadoEm) - Date.parse(b.decisao.criadoEm));
}

/** Conversas com pergunta aberta: o que o reducer usa para esquecer a escolha do campo que perdeu o assunto. */
export function conversasComPergunta(suaVez: SuaVezDto): Set<string> {
  return new Set(suaVez.itens.filter((i) => aberta(i) && ehPergunta(i.decisao.tipo)).map((i) => i.decisao.conversaId));
}

/** A fala do agente que É a pergunta (payload pedido_a_pessoa), se estiver na conversa carregada. */
export function mensagemDaPergunta(mensagens: readonly Mensagem[], decisaoId: string): Mensagem | undefined {
  return mensagens.find((m) => m.payload?.kind === "pedido_a_pessoa" && m.payload.decisaoId === decisaoId);
}

/** A mensagem da pessoa que respondeu (payload resposta_a_pedido). */
export function respostaDaPergunta(mensagens: readonly Mensagem[], decisaoId: string): Mensagem | undefined {
  return mensagens.find((m) => m.payload?.kind === "resposta_a_pedido" && m.payload.decisaoId === decisaoId);
}

export type EstadoPergunta =
  | { tipo: "aberta"; item: ItemPergunta }
  | { tipo: "respondida"; resposta: Mensagem }
  | { tipo: "vencida"; item: ItemPergunta }
  | { tipo: "encerrada" };

/**
 * Onde a pergunta está, sem campo novo: a resposta ligada a ela na conversa é a prova de que foi
 * respondida; senão "Sua vez" diz se está aberta ou vencida. Fora das duas, foi deixada pra lá, é de
 * outra decisora ou saiu da janela de vencidas (ADR-007) — o balão fica, sem linha de estado.
 */
export function estadoDaPergunta(estado: Estado, mensagens: readonly Mensagem[], decisaoId: string): EstadoPergunta {
  const resposta = respostaDaPergunta(mensagens, decisaoId);
  if (resposta) return { tipo: "respondida", resposta };
  const item = estado.suaVez?.itens.find((i) => i.decisao.id === decisaoId);
  if (!item) return { tipo: "encerrada" };
  return aberta(item) ? { tipo: "aberta", item } : { tipo: "vencida", item };
}

/**
 * O que a próxima mensagem do campo faz. Sem pergunta aberta, nada muda. Com pergunta, o padrão é
 * RESPONDER a mais antiga (ou a que a pessoa escolheu, `alvoId`); "Outro assunto" manda mensagem comum
 * e deixa a pergunta aberta. `indice` é a posição da citada ("1 de 2").
 */
export type ModoComposer =
  | { tipo: "normal" }
  | { tipo: "outro"; perguntas: ItemPergunta[] }
  | { tipo: "resposta"; perguntas: ItemPergunta[]; alvo: ItemPergunta; indice: number };

export function modoDoComposer(estado: Estado, conversaId: string): ModoComposer {
  const perguntas = perguntasAbertas(estado, conversaId);
  const maisAntiga = perguntas[0];
  if (!maisAntiga) return { tipo: "normal" };
  const escolha = estado.composer[conversaId];
  if (escolha?.outroAssunto) return { tipo: "outro", perguntas };
  const indice = Math.max(0, perguntas.findIndex((p) => p.decisao.id === escolha?.alvoId));
  return { tipo: "resposta", perguntas, alvo: perguntas[indice] ?? maisAntiga, indice };
}

export type DestinoEnvio = { tipo: "resposta"; decisaoId: string } | { tipo: "mensagem" };

export function destinoDoEnvio(modo: ModoComposer): DestinoEnvio {
  return modo.tipo === "resposta" ? { tipo: "resposta", decisaoId: modo.alvo.decisao.id } : { tipo: "mensagem" };
}

/** O que o envio precisa da Api (estrutural: web/lib/api.ts satisfaz, e o teste passa um espião). */
export type ApiDeEnvio = {
  enviar(conversaId: string, texto: string, anexos?: readonly string[]): Promise<unknown>;
  responder(decisaoId: string, texto: string): Promise<unknown>;
  postarNaSala(salaId: string, texto: string): Promise<unknown>;
};

/** Por que o clipe fica desligado em modo resposta: POST decisoes/:id/responder só leva texto. */
export const MOTIVO_SEM_ANEXO = "Na resposta à pergunta vão só palavras. Para mandar arquivos, escolha “Outro assunto”.";

export type ResultadoEnvio = { enviado: "resposta" | "mensagem" } | { recusado: "anexo_na_resposta" };

/**
 * Envio do campo. Em modo resposta o texto vai por POST decisoes/:id/responder — a rota que já existe,
 * que fecha a pergunta e cria a retomada; EMENDA 16 intacta: a resposta é o texto da pessoa — e NÃO
 * vira mensagem comum. A rota não leva arquivo: com anexo pronto, recusa por escrito em vez de mandar
 * a resposta e perder o arquivo em silêncio.
 */
export async function enviarPeloComposer(api: ApiDeEnvio, alvo: { conversaId: string; salaId: string | null }, destino: DestinoEnvio, texto: string, anexos: readonly string[] = []): Promise<ResultadoEnvio> {
  if (destino.tipo === "resposta") {
    if (anexos.length > 0) return { recusado: "anexo_na_resposta" };
    await api.responder(destino.decisaoId, texto);
    return { enviado: "resposta" };
  }
  if (alvo.salaId) await api.postarNaSala(alvo.salaId, texto);
  else await api.enviar(alvo.conversaId, texto, anexos);
  return { enviado: "mensagem" };
}

/** definido em 2026-09-24: o começo da pergunta na citação do campo — cabe numa linha ao lado de "1 de 2". */
export const CITACAO_MAX = 48;

/** "Posso arquivar o PR 7 e avisar o…": corta na palavra; o texto inteiro fica no balão. */
export function inicioDaPergunta(texto: string, max = CITACAO_MAX): string {
  const limpo = texto.replace(/\s+/g, " ").trim();
  const letras = [...limpo];
  if (letras.length <= max) return limpo;
  const corte = letras.slice(0, max).join("");
  const espaco = corte.lastIndexOf(" ");
  return `${(espaco > max / 2 ? corte.slice(0, espaco) : corte).replace(/[\s,.;:!?-]+$/u, "")}…`;
}

/** Balão de fala (24×24, traço 1,6, como os outros ícones): o sinal de PERGUNTA, azul, separado do ⚑ âmbar. */
export function iconeBalao(tamanho: number): string {
  return `<svg class="ic-balao" aria-hidden="true" viewBox="0 0 24 24" width="${tamanho}" height="${tamanho}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>`;
}
