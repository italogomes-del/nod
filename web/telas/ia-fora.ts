import type { IdHarness } from "../../src/contracts/harness.ts";
import type { CausaSemIa, Inventario } from "../../src/contracts/inventario.ts";
import type { Mensagem } from "../../src/contracts/mensagem.ts";
import type { Estado } from "../estado/reducer.ts";
import { avisoDeEstado } from "../lib/aviso-estado.ts";
import { formatoData } from "../lib/formato-data.ts";
import { botao, esc, hora, paragrafos } from "../lib/render.ts";
import { LOGOS_IA } from "./onboarding-logos.ts";

/**
 * A conversa quando a conta da IA não serve (definido em 2026-10-05; protótipo "Nod — primeira sessão sem tropeços",
 * jornada 3). Medido em produção nesse dia: a recusa do Claude Code aparecia em inglês como se fosse fala do bot,
 * seguida de "Turno interrompido: erro_execucao". Agora:
 * - bot em automático com outra IA pronta: o pedido é repetido nela (assentar-turno.ts) e a conversa ganha UMA linha
 *   dizendo por quem o bot passou a responder (`linhaIaTrocada`);
 * - sem outra IA: um aviso que diz o que houve e traz o botão que resolve (`avisoContaSemAcesso`). A fala fica
 *   guardada: quando uma IA fica pronta, o servidor a repete sozinho (repetir-barrados-por-ia.ts).
 * Funções puras de desenho; os cliques (`ia-entrar`, `ia-conectar`) são tratados em web/main.ts.
 */

type IdIa = Extract<IdHarness, "claude-cli" | "codex-cli">;
/** Como a tela chama cada IA (o mesmo do onboarding): o provedor, o CLI e o logo. */
export const PROVEDOR_DA_IA: Record<IdIa, { nome: string; cli: string; logo: keyof typeof LOGOS_IA }> = {
  "claude-cli": { nome: "Claude", cli: "Claude Code", logo: "claude" },
  "codex-cli": { nome: "ChatGPT", cli: "Codex", logo: "chatgpt" },
};
const OUTRA: Record<IdIa, IdIa> = { "claude-cli": "codex-cli", "codex-cli": "claude-cli" };

export const ehIa = (v: unknown): v is IdIa => v === "claude-cli" || v === "codex-cli";

const logo = (ia: IdIa): string => `<span class="ia-logo" aria-hidden="true">${LOGOS_IA[PROVEDOR_DA_IA[ia].logo]}</span>`;

/** O inventário de uma IA no catálogo que a tela já tem (GET executor); null quando ainda não chegou. */
export function inventarioDaIa(estado: Pick<Estado, "executor">, ia: IdIa): Inventario | null {
  return estado.executor?.harnesses?.opcoes.find((o) => o.id === ia)?.inventario ?? null;
}

/**
 * A IA não está no Mac: o botão instala. NOD-178: o CLI que só demorou ("ausente" por sonda lenta) não pede instalação.
 * NOD-171: nem o CLI abaixo do piso (`cli_antigo`): ele está instalado, e o botão diz "Atualizar".
 */
export function pedeInstalar(inv: Inventario | null): boolean {
  return inv?.estado === "ausente" && inv.causa !== "sonda_lenta" && inv.causa !== "cli_antigo";
}

/** NOD-171: o CLI está no Mac, mas abaixo do piso testado (`PISO_CLI`); null quando não é o caso. */
export function desatualizado(inv: { estado: string; causa?: string; versao?: string; minima?: string } | null | undefined): { versao: string; minima: string } | null {
  return inv?.estado === "ausente" && inv.causa === "cli_antigo" && inv.versao && inv.minima ? { versao: inv.versao, minima: inv.minima } : null;
}

/** A mínima como a pessoa lê: "0.159.0" vira "0.159" (protótipo do Gil, NOD-171); "2.1.290" fica como está. */
export const versaoLegivel = (v: string): string => v.replace(/^(\d+\.\d+)\.0$/, "$1");

/** "Seu Codex está na versão 0.147.0. O nod precisa da 0.159 ou mais nova." — a mesma frase no rodapé e no menu. */
export function fraseDesatualizado(ia: IdIa, d: { versao: string; minima: string }): string {
  return `Seu ${PROVEDOR_DA_IA[ia].cli} está na versão ${d.versao}. O nod precisa da ${versaoLegivel(d.minima)} ou mais nova.`;
}

/**
 * O comando que atualiza cada CLI, mostrado com "Copiar" (NOD-171). O nod não roda nada: `iaInstalar` abre a página
 * oficial e a pessoa atualiza no Terminal; a sonda percebe sozinha a versão nova.
 */
export const COMANDO_ATUALIZAR_IA: Record<IdIa, string> = {
  "claude-cli": "claude update",
  "codex-cli": "npm install -g @openai/codex@latest",
};

const FRASE_DA_CAUSA:Record<CausaSemIa, (cli: string) => string> = {
  conta_sem_acesso: (cli) => `a conta do ${cli} deste Mac está sem acesso (a organização dela desativou o uso por assinatura)`,
  teste_falhou: (cli) => `a conta do ${cli} deste Mac entrou, mas não respondeu`,
};

/**
 * O aviso no lugar da fala: o que houve, e os botões que resolvem. `noApp` = a página roda dentro do app do Mac (só
 * ele sabe abrir o login de uma IA); fora dele o botão leva à seção Conexão, que explica o que fazer no Terminal.
 */
export function avisoContaSemAcesso(m: Mensagem, estado: Pick<Estado, "executor">, p: { nomeDoBot: string; ia: IdIa; causa: CausaSemIa; aindaFora: boolean; noApp: boolean }): string {
  const { cli } = PROVEDOR_DA_IA[p.ia];
  const outra = OUTRA[p.ia];
  const invOutra = inventarioDaIa(estado, outra);
  const detalhes = `<details class="aviso-estado-detalhes" data-disclosure="negacao-${esc(m.id)}"><summary>Detalhes técnicos</summary>${paragrafos(m.texto)}</details>`;
  if (!p.aindaFora) {
    return avisoDeEstado({
      tom: "info",
      titulo: `${p.nomeDoBot} não conseguiu começar.`,
      texto: `Na hora, ${FRASE_DA_CAUSA[p.causa](cli)}. Já há uma IA pronta: se a resposta não chegou, mande a mensagem de novo.`,
      extra: detalhes,
    });
  }
  const entrar = botao("ia-entrar", `${logo(p.ia)}Entrar com outra conta`, { classe: "pri sm com-logo", dados: { ia: p.ia } });
  // NOD-171 (QA): a outra IA desatualizada pede "Atualizar"; "Conectar" abriria o login de um CLI que o nod não usa.
  const conectarOutra = desatualizado(invOutra)
    ? botao("ia-atualizar", `${logo(outra)}Atualizar o ${PROVEDOR_DA_IA[outra].cli}`, { classe: "sm com-logo", dados: { ia: outra } })
    : botao("ia-conectar", `${logo(outra)}${pedeInstalar(invOutra) ? `Instalar o ${PROVEDOR_DA_IA[outra].cli}` : `Conectar o ${PROVEDOR_DA_IA[outra].nome}`}`, { classe: "sm com-logo", dados: { ia: outra } });
  const acao = p.noApp ? `<span class="aviso-estado-acoes">${entrar}${conectarOutra}</span>` : botao("secao-espaco", "Conectar IA", { classe: "pri sm", dados: { secao: "conexao" } });
  return avisoDeEstado({
    tom: "alerta",
    titulo: `${p.nomeDoBot} não conseguiu começar.`,
    texto: `Nenhum trabalho começou: ${FRASE_DA_CAUSA[p.causa](cli)}. Sua mensagem fica guardada: quando uma IA estiver pronta, ${p.nomeDoBot} responde sozinho.`,
    extra: detalhes,
    acao,
    classe: "aviso-ia-fora",
  });
}

/**
 * NOD-171 (protótipo do Gil, estado 2): o bot fixado numa IA que não está pronta. O aviso diz QUAL IA e em que pé ela
 * está — desatualizada (com a versão e a mínima), sem login ou fora do Mac — e traz o botão que resolve e "Trocar a IA".
 * null quando a IA já voltou, só demorou ou o catálogo ainda não chegou: aí vale o aviso genérico.
 */
export function avisoHarnessFora(m: Mensagem, estado: Pick<Estado, "executor">, p: { nomeDoBot: string | null; agenteId: string | null; ia: IdIa; noApp: boolean }): string | null {
  const inv = inventarioDaIa(estado, p.ia);
  if (!inv || inv.estado === "pronto" || inv.causa === "sonda_lenta") return null;
  const { nome, cli } = PROVEDOR_DA_IA[p.ia];
  const bot = p.nomeDoBot ?? "O bot";
  const botNoMeio = p.nomeDoBot ?? "o bot";
  const dados = { ia: p.ia };
  const antigo = desatualizado(inv);
  const conectar = botao("secao-espaco", "Conectar IA", { classe: "pri sm", dados: { secao: "conexao" } });
  const [titulo, situacao, resolve] = antigo
    ? [`${bot} não começou: o ${cli} deste Mac está desatualizado.`, `${bot} usa o ${nome} (${cli}). A versão instalada é a ${antigo.versao}, e o nod precisa da ${versaoLegivel(antigo.minima)} ou mais nova.`, p.noApp ? botao("ia-atualizar", `Atualizar o ${cli}`, { classe: "pri sm", dados }) : ""]
    : inv.estado === "nao_autenticado"
      ? [`${bot} não começou: falta entrar no ${cli}.`, `${bot} usa o ${nome} (${cli}). Ele está instalado neste Mac, mas sem conta conectada.`, p.noApp ? botao("ia-entrar", `${logo(p.ia)}Entrar no ${nome}`, { classe: "pri sm com-logo", dados }) : conectar]
      : [`${bot} não começou: o ${cli} não está neste Mac.`, `${bot} usa o ${nome} (${cli}), que não foi encontrado neste Mac.`, p.noApp ? botao("ia-conectar", `${logo(p.ia)}Instalar o ${cli}`, { classe: "pri sm com-logo", dados }) : conectar];
  const trocar = p.agenteId ? botao("inteligencia", p.nomeDoBot ? `Trocar a IA de ${esc(p.nomeDoBot)}` : "Trocar a IA", { classe: "sm", id: p.agenteId }) : "";
  const detalhes = `<details class="aviso-estado-detalhes" data-disclosure="negacao-${esc(m.id)}"><summary>Detalhes técnicos</summary>${paragrafos(m.texto)}</details>`;
  // O comando vai no próprio aviso: fora do app, a Conexão só mostra o da IA em uso, que pode não ser esta.
  return avisoDeEstado({
    tom: "erro",
    titulo,
    texto: `${situacao} Sua mensagem fica guardada: quando o ${cli} estiver pronto, ${botNoMeio} responde sozinho.`,
    extra: `${antigo ? linhaAtualizarIa(p.ia, false) : ""}${detalhes}`,
    acao: `<span class="aviso-estado-acoes">${resolve}${trocar}</span>`,
    classe: "aviso-ia-fora",
  });
}

/**
 * NOD-171: a IA do bot está pronta, mas não aceita o modelo escolhido no agente (payload `modelo` da negação). Trocar a
 * IA não resolve e esperar também não: o aviso pede outro modelo e a mensagem de novo, nunca "a IA já voltou".
 */
export function avisoModeloRecusado(m: Mensagem, p: { nomeDoBot: string | null; agenteId: string | null; ia: IdIa; modelo: string }): string {
  const { cli } = PROVEDOR_DA_IA[p.ia];
  const bot = p.nomeDoBot ?? "O bot";
  const trocar = p.agenteId ? botao("inteligencia", p.nomeDoBot ? `Trocar o modelo de ${esc(p.nomeDoBot)}` : "Trocar o modelo", { classe: "pri sm", id: p.agenteId }) : undefined;
  const detalhes = `<details class="aviso-estado-detalhes" data-disclosure="negacao-${esc(m.id)}"><summary>Detalhes técnicos</summary>${paragrafos(m.texto)}</details>`;
  return avisoDeEstado({
    tom: "erro",
    titulo: `${bot} não começou: o ${cli} não aceita o modelo ${p.modelo}.`,
    texto: `Escolha outro modelo para ${p.nomeDoBot ?? "o bot"} e mande a mensagem de novo.`,
    extra: detalhes,
    acao: trocar,
    classe: "aviso-ia-fora",
  });
}

/** "às 17:00" no mesmo dia; "em 09/10 às 17:00" noutro — na hora LOCAL de quem lê (o texto gravado é de São Paulo). */
function quandoVolta(voltaEm: number, agora: number): string {
  const dia = (t: number) => formatoData("pt-BR", { day: "2-digit", month: "2-digit" }).format(new Date(t));
  return dia(voltaEm) === dia(agora) ? `às ${hora(voltaEm)}` : `em ${dia(voltaEm)} às ${hora(voltaEm)}`;
}

/**
 * NOD-171 (protótipo do Gil, estado 3): o turno parou no limite do plano. No Claude Code o protocolo diz quando volta;
 * no Codex só o texto do erro, então o card "parece" e manda conferir o plano no ChatGPT. O nod não tenta de novo
 * sozinho; "Trocar a IA" leva à Inteligência do bot. null quando a mensagem não é desse aviso.
 */
export function avisoLimiteDoPlano(m: Mensagem, p: { nomeDoBot: string | null; agenteId: string | null; agora: number }): string | null {
  const l = m.payload;
  if (l?.kind !== "limite_do_plano") return null;
  const bot = p.nomeDoBot ?? "O bot";
  const codex = l.harness === "codex-cli";
  const provedor = ehIa(l.harness) ? PROVEDOR_DA_IA[l.harness].nome : null;
  const titulo = codex ? "Seu plano do ChatGPT parece ter atingido o limite de uso." : `Seu plano ${provedor ? `do ${provedor}` : "da sua IA"} atingiu o limite de uso.`;
  const quando = l.voltaEm !== null && l.voltaEm > p.agora ? `Volta a funcionar ${quandoVolta(l.voltaEm, p.agora)}.` : codex ? "O Codex recusou o pedido. Confira o uso do seu plano no ChatGPT e tente de novo quando ele liberar." : "Espere o uso renovar e tente de novo.";
  const trocar = p.agenteId ? botao("inteligencia", p.nomeDoBot ? `Trocar a IA de ${esc(p.nomeDoBot)}` : "Trocar a IA", { classe: "sm", id: p.agenteId }) : undefined;
  const detalhes = `<details class="aviso-estado-detalhes" data-disclosure="limite-${esc(m.id)}"><summary>Detalhes técnicos</summary>${paragrafos(m.texto)}</details>`;
  return avisoDeEstado({
    tom: "alerta",
    titulo,
    texto: `${quando} ${bot} parou no meio, e o que já fez está acima. O nod não tenta de novo sozinho.`,
    extra: detalhes,
    acao: trocar,
    classe: "aviso-limite-plano",
  });
}

/** NOD-171: o comando que atualiza a IA, com "Copiar"; no app do Mac, "Atualizar" abre a página oficial. */
export function linhaAtualizarIa(ia: IdIa, noApp: boolean): string {
  const comando = COMANDO_ATUALIZAR_IA[ia];
  const abrir = noApp ? botao("ia-atualizar", `Atualizar o ${PROVEDOR_DA_IA[ia].cli}`, { classe: "pri sm", dados: { ia } }) : "";
  return `<div class="ia-atualizar"><p>No Terminal deste Mac, rode:</p><div class="ia-comando"><code>${esc(comando)}</code>${botao("copiar-texto", "Copiar", { classe: "sm", dados: { texto: comando } })}</div><p class="mudo">O nod percebe sozinho quando a versão nova estiver instalada.</p>${abrir}</div>`;
}

/** A linha "Respondendo pelo ChatGPT…": dita uma vez, quando o bot em automático troca de IA. */
export function linhaIaTrocada(m: Mensagem): string | null {
  const p = m.payload;
  if (p?.kind !== "ia_trocada" || !ehIa(p.de) || !ehIa(p.para)) return null;
  const de = PROVEDOR_DA_IA[p.de];
  const para = PROVEDOR_DA_IA[p.para];
  // revisto em 2026-10-10 (emenda da ADR-036): a troca pelo limite da assinatura; a linha discreta da tela nova é o PR da web.
  const motivo = p.causa === "limite" ? `O ${de.nome} chegou ao limite da assinatura.` : p.causa === "conta_sem_acesso" ? `A conta do ${de.nome} deste Mac está sem acesso ao ${de.cli}.` : `O ${de.cli} deste Mac não respondeu.`;
  return `<div class="aviso-estado tom-info aviso-compacto aviso-ia-trocada">${logo(p.para)}<div class="aviso-estado-txt">Respondendo pelo ${esc(para.nome)}. ${esc(motivo)}</div>${botao("secao-espaco", "Ver opções", { classe: "sm", dados: { secao: "conexao" } })}</div>`;
}
