import type { IdHarness } from "../../src/contracts/harness.ts";
import type { CausaSemIa, Inventario } from "../../src/contracts/inventario.ts";
import type { Mensagem } from "../../src/contracts/mensagem.ts";
import type { Estado } from "../estado/reducer.ts";
import { avisoDeEstado } from "../lib/aviso-estado.ts";
import { botao, esc, paragrafos } from "../lib/render.ts";
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

/** A IA não está no Mac: o botão instala. NOD-178: o CLI que só demorou ("ausente" por sonda lenta) não pede instalação. */
export function pedeInstalar(inv: Inventario | null): boolean {
  return inv?.estado === "ausente" && inv.causa !== "sonda_lenta";
}

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
  const conectarOutra = botao("ia-conectar", `${logo(outra)}${pedeInstalar(invOutra) ? `Instalar o ${PROVEDOR_DA_IA[outra].cli}` : `Conectar o ${PROVEDOR_DA_IA[outra].nome}`}`, { classe: "sm com-logo", dados: { ia: outra } });
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

/** A linha "Respondendo pelo ChatGPT…": dita uma vez, quando o bot em automático troca de IA. */
export function linhaIaTrocada(m: Mensagem): string | null {
  const p = m.payload;
  if (p?.kind !== "ia_trocada" || !ehIa(p.de) || !ehIa(p.para)) return null;
  const de = PROVEDOR_DA_IA[p.de];
  const para = PROVEDOR_DA_IA[p.para];
  const motivo = p.causa === "conta_sem_acesso" ? `A conta do ${de.nome} deste Mac está sem acesso ao ${de.cli}.` : `O ${de.cli} deste Mac não respondeu.`;
  return `<div class="aviso-estado tom-info aviso-compacto aviso-ia-trocada">${logo(p.para)}<div class="aviso-estado-txt">Respondendo pelo ${esc(para.nome)}. ${esc(motivo)}</div>${botao("secao-espaco", "Ver opções", { classe: "sm", dados: { secao: "conexao" } })}</div>`;
}
