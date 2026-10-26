import { qualCredencial, soLeCredencial } from "./comando.ts";

/**
 * O que o modo rodou sem a pessoa, dito a ela (definido em 2026-10-19, plano dos modos de aprovação, PR 6; telas Y1 a Y3
 * do protótipo aprovado). A fonte é `acoes_pelo_modo` (0093): no "Ignorar todas as aprovações", cada ação que o manual
 * pediria (veredito nulo); no Automático com o revisor, o que ele liberou (veredito `libera`). As frases são do servidor,
 * como as da Atividade (ADR-029): a web só as mostra.
 */
export type AcaoDoModoParaTexto = {
  modo: "automatico" | "total";
  tipo: "comando" | "arquivo" | "leitura_credencial" | "app" | "mcp";
  gatilho: "arriscado" | "envio_apos_fora" | "credencial" | "fora_da_pasta" | "comum";
  /** O texto da ação, já redigido (`resumoDeTexto`): o comando, `Ler …`/`Gravar …` ou o pedido do MCP. */
  resumo: string;
  /** A frase fixa de `comandoArriscado` ("reescreve ou apaga no remoto"), quando é o arriscado. */
  risco: string | null;
  veredito: "libera" | "pede" | "falhou" | "nao_revisado" | null;
};

/** Rodou sem a pessoa: tudo o que o total registrou e o que o revisor do Automático liberou (o filtro "Sem aprovação"). */
export function rodouSemAprovacao(a: Pick<AcaoDoModoParaTexto, "modo" | "veredito">): boolean {
  return a.modo === "total" || a.veredito === "libera";
}

/**
 * Entra na linha discreta embaixo da fala (plano, decisão 8): no total, só a credencial e o arriscado — o resto (gravar
 * fora da pasta, o comando comum) fica só na Atividade. A linha do revisor (Automático) entra com o PR 4.
 */
export function entraNaFala<A extends Pick<AcaoDoModoParaTexto, "modo" | "gatilho">>(a: A): a is A & { gatilho: "credencial" | "arriscado" } {
  return a.modo === "total" && (a.gatilho === "credencial" || a.gatilho === "arriscado");
}

/** O alvo do item sem o verbo que o servidor pôs na frente (`Ler `, `Gravar `). */
export function semVerbo(resumo: string): string {
  return resumo.replace(/^(Ler|Gravar) /, "");
}

/**
 * A casa da pessoa vira `~` no detalhe da Atividade (QA do PR 6, tela Y3: "~/.docker/config.json"): o hook manda o caminho
 * absoluto (`/Users/marlon/.aws/config`; na VM, `/home/nod/…`), e o nome da conta só alonga a linha.
 */
export function comCasaAbreviada(texto: string): string {
  return texto.replace(/(^|[\s"'=:])\/(?:Users|home)\/[^/\s"']+(?=\/|$|[\s"'])/g, "$1~");
}

/**
 * "Leu", "Mudou" ou "Usou", pelo que a ação fez com a credencial. O comando que só a lê (`cat ~/.aws/config`) também
 * "Leu", como nas telas Y2 e Y3 (QA do PR 6); o que a usa para outra coisa (`gh auth token | docker login`), "Usou".
 */
function verboDaCredencial(a: Pick<AcaoDoModoParaTexto, "tipo" | "resumo">): string {
  if (a.tipo === "leitura_credencial" || (a.tipo === "comando" && soLeCredencial(a.resumo))) return "Leu";
  return a.tipo === "arquivo" ? "Mudou" : "Usou";
}

/**
 * A frase da linha embaixo da fala: "Usou o token do GitHub do seu Mac" (Y1), "Leu as credenciais da AWS do seu Mac"
 * (Y2); no arriscado, "Rodou um comando que reescreve ou apaga no remoto". `naMaquina` = o turno rodou numa máquina
 * Linux (ADR-090): a credencial é "desta máquina", não "do seu Mac".
 */
export function fraseNaFala(a: Pick<AcaoDoModoParaTexto, "tipo" | "gatilho" | "resumo" | "risco">, naMaquina = false): string {
  if (a.gatilho === "credencial") return `${verboDaCredencial(a)} ${qualCredencial(a.resumo) ?? "uma credencial"} ${naMaquina ? "desta máquina" : "do seu Mac"}`;
  if (a.gatilho === "arriscado") return a.risco ? `Rodou um comando que ${a.risco}` : "Rodou um comando arriscado";
  return tituloNaAtividade(a);
}

/**
 * O título do item na Atividade (Y3): "Leu as credenciais da AWS", "Comando arriscado", "Usou o token do GitHub",
 * "Gravou fora da pasta do bot" (o protótipo diz "do Ze"; sem o nome, porque o artigo muda com ele — "da Clarice"). O
 * detalhe é o resumo (o comando ou o caminho), sem o verbo.
 */
export function tituloNaAtividade(a: Pick<AcaoDoModoParaTexto, "tipo" | "gatilho" | "resumo"> & { veredito?: AcaoDoModoParaTexto["veredito"]; modo?: AcaoDoModoParaTexto["modo"] }): string {
  if (a.modo === "automatico" && a.veredito === "libera") return "Revisor liberou";
  if (a.gatilho === "credencial") return `${verboDaCredencial(a)} ${qualCredencial(a.resumo) ?? "uma credencial"}`;
  if (a.gatilho === "arriscado") return "Comando arriscado";
  if (a.gatilho === "fora_da_pasta") return "Gravou fora da pasta do bot";
  if (a.tipo === "mcp") return "Usou um app seu sem perguntar";
  return "Rodou sem perguntar";
}
