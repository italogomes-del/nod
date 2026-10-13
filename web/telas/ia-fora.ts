import type { IdHarness } from "../../src/contracts/harness.ts";
import type { CausaSemIa, Inventario } from "../../src/contracts/inventario.ts";
import type { Mensagem } from "../../src/contracts/mensagem.ts";
import type { ContasNoLimite } from "../../src/contracts/contas-ia.ts";
import type { Estado } from "../estado/reducer.ts";
import { avisoDeEstado } from "../lib/aviso-estado.ts";
import { formatoData } from "../lib/formato-data.ts";
import { botao, esc, hora, paragrafos } from "../lib/render.ts";
import { LOGOS_IA } from "./onboarding-logos.ts";
import { estadoNaTela, type UiIas } from "./cartao-ia.ts";
import type { IaDaPessoa } from "../../src/contracts/inteligencia.ts";

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

export type IdIa = Extract<IdHarness, "claude-cli" | "codex-cli">;
/** Como a tela chama cada IA (o mesmo do onboarding): o provedor, o CLI e o logo. */
export const PROVEDOR_DA_IA: Record<IdIa, { nome: string; cli: string; logo: keyof typeof LOGOS_IA }> = {
  "claude-cli": { nome: "Claude", cli: "Claude Code", logo: "claude" },
  "codex-cli": { nome: "ChatGPT", cli: "Codex", logo: "chatgpt" },
};
const OUTRA: Record<IdIa, IdIa> = { "claude-cli": "codex-cli", "codex-cli": "claude-cli" };

export const ehIa = (v: unknown): v is IdIa => v === "claude-cli" || v === "codex-cli";

const logo = (ia: IdIa): string => `<span class="ia-logo" aria-hidden="true">${LOGOS_IA[PROVEDOR_DA_IA[ia].logo]}</span>`;

/**
 * NOD-213/NOD-220: a sonda prova que a IA voltou só se for "pronto" e MAIS NOVA que a negação. Os dois horários são epoch
 * ms do relógio do SERVIDOR (o anúncio do Mac é carimbado na chegada, em lerAnuncio; a negação, no `agora` do servidor):
 * fuso e relógio do Mac não entram. Sonda ausente, horário ausente/não numérico ou igual ao da negação: não voltou.
 */
export function prontaDepois(inv: Inventario | null | undefined, negadaEm: number): boolean {
  return inv?.estado === "pronto" && typeof inv.em === "number" && Number.isFinite(inv.em) && typeof negadaEm === "number" && Number.isFinite(negadaEm) && inv.em > negadaEm;
}

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
 * NOD-220: também o bot no Automático cuja IA do turno (payload `ia`) recusou. Sem estado que explique (sonda "pronto" de
 * antes da negação, sonda lenta, sem catálogo), o aviso nomeia a IA e manda conferir a Conexão. Quem chama só o usa com a
 * IA ainda fora (prontaDepois falso).
 */
export function avisoHarnessFora(m: Mensagem, estado: Pick<Estado, "executor">, p: { nomeDoBot: string | null; agenteId: string | null; ia: IdIa; noApp: boolean }): string {
  const inv = inventarioDaIa(estado, p.ia);
  const { nome, cli } = PROVEDOR_DA_IA[p.ia];
  const bot = p.nomeDoBot ?? "O bot";
  const botNoMeio = p.nomeDoBot ?? "o bot";
  const dados = { ia: p.ia };
  const antigo = desatualizado(inv);
  const conectar = botao("secao-espaco", "Conectar IA", { classe: "pri sm", dados: { secao: "conexao" } });
  // NOD-220: a IA segue fora sem estado que o catálogo explique (sonda "pronto" anterior à negação, sonda lenta ou servidor
  // sem catálogo): o aviso ainda nomeia a IA e diz o que conferir — nunca "sua conta de IA" sem dizer qual.
  const semEstado = !inv || inv.estado === "pronto" || inv.causa === "sonda_lenta";
  const [titulo, situacao, resolve] = semEstado
    ? ["Nenhum trabalho começou.", `${bot} não pôde começar: o ${cli} (${nome}) estava indisponível. Confira em Conexão se o ${cli} está instalado e com a conta conectada.`, conectar]
    : antigo
    ? [`${bot} não começou: o ${cli} deste Mac está desatualizado.`, `${bot} usa o ${nome} (${cli}). A versão instalada é a ${antigo.versao}, e o nod precisa da ${versaoLegivel(antigo.minima)} ou mais nova.`, p.noApp ? botao("ia-atualizar", `Atualizar o ${cli}`, { classe: "pri sm", dados }) : ""]
    // NOD-213: no limite da assinatura a IA está logada; "falta entrar" seria falso. Resolve trocando de IA (ou esperando).
    : inv.estado === "nao_autenticado" && inv.causa === "limite"
      ? [`${bot} não começou: a conta do ${nome} chegou ao limite da assinatura.`, `${bot} usa o ${nome} (${cli}), e a conta conectada está no limite de uso.`, ""]
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

/**
 * Tela 4 do plano das IAs (protótipo SemOutra, aprovado em 2026-10-09; antes NOD-171 era um cartão âmbar grande): o turno
 * parou no limite da assinatura e NÃO havia outra IA pronta para assumir. Uma linha centralizada, com acento âmbar
 * discreto, que diz até quando e traz o passo que resolve, pelo estado da OUTRA IA: "Continuar pelo ChatGPT" (instalada,
 * falta entrar), "Instalar o ChatGPT", o código do login enquanto ela entra. A linha acompanha o login ela mesma
 * (`data-fica`); o Claude, que pede o código colado, termina em Provedores de IA. Passado o limite (ou uma hora sem prazo),
 * vira um registro sem cor. null quando a mensagem não é desse aviso.
 */
export function linhaLimiteSemOutra(m: Mensagem, p: { nomeDoBot: string | null; agenteId: string | null; agora: number; ui: UiIas; ias: readonly IaDaPessoa[] | null; fixa: boolean }): string | null {
  const l = m.payload;
  if (l?.kind !== "limite_do_plano") return null;
  const ia = ehIa(l.harness) ? l.harness : null;
  const nome = ia ? PROVEDOR_DA_IA[ia].nome : "Sua IA";
  const vigente = l.voltaEm !== null ? l.voltaEm > p.agora : p.agora - m.criadoEm < 60 * 60_000;
  if (!vigente) {
    const quando = l.voltaEm !== null ? `até ${hora(l.voltaEm)}` : `às ${hora(m.criadoEm)}`;
    return `<div class="linha-centro-wrap linha-limite-passou"><span class="linha-centro estatica"><span class="linha-ic" aria-hidden="true">${ICONE_RELOGIO}</span><span>${esc(nome)} esteve no limite ${esc(quando)}</span></span></div>`;
  }
  // ADR-102: a conta da lista (servidor) bateu no limite — a frase do servidor e um passo por saída.
  if (l.contas && (l.contas.livres.length > 0 || l.contas.voltaEm !== null)) return linhaContasNoLimite(m, l.contas, p.agora);
  if (l.conta?.tipo === "perguntar" && ia) return linhaSeguirComConta(ia, l.conta, m.texto, p);
  // ADR-101: todas as contas da IA no limite — a frase do servidor diz quando a primeira volta; o passo segue o de sempre.
  const limite = l.conta?.tipo === "todas_no_limite" ? m.texto : l.voltaEm !== null ? `${nome} no limite até ${quandoVolta(l.voltaEm, p.agora).replace(/^às /, "")}` : `${nome} chegou ao limite`;
  const acao = ia ? acaoSemOutra(ia, p) : null;
  const corpo = acao?.substitui ? acao.html : `<span>${esc(limite)}</span>${acao ? `<span aria-hidden="true">·</span>${acao.html}` : ""}`;
  return `<div class="linha-centro-wrap linha-espera" role="status" data-fica><span class="linha-centro estatica"><span class="linha-ic" aria-hidden="true">${ICONE_RELOGIO}</span>${corpo}</span></div>`;
}

/**
 * ADR-101 (2026-10-12, NOD-211): a conta em uso bateu no limite e há outra livre, em "Perguntar antes de trocar" (o
 * padrão). A frase do servidor ("Conta 1 do Claude Code no limite até 14:00. Seguir com a conta 2 ou 3?") e um botão por
 * conta livre. No app do Mac o clique troca a conta (nodDesktop.contas); a pessoa manda a mensagem de novo. Fora do app,
 * a escolha é no Mac (o servidor não sabe das contas). Escolhida, a linha diz com qual seguiu.
 */
function linhaSeguirComConta(
  ia: IdIa,
  conta: { livres: readonly number[]; foraDaTroca: readonly number[]; voltaEm: number | null },
  frase: string,
  p: { nomeDoBot: string | null; agenteId: string | null; agora: number; ui: UiIas; ias: readonly IaDaPessoa[] | null },
): string {
  const { livres } = conta;
  const { ui } = p;
  const emUso = ui.contas[ia]?.contas.find((c) => c.emUso)?.posicao;
  const escolhida = emUso !== undefined && livres.includes(emUso) ? emUso : null;
  const sep = '<span aria-hidden="true">·</span>';
  // QA do NOD-211 (2026-10-12, protótipo, tela "só sobrou a corporativa"): em Trocar sozinho com as livres todas fora da
  // troca, a pergunta também oferece a outra IA e a espera — antes só havia os botões das contas. Só o passo que age
  // (a outra IA pronta, a entrar ou a instalar); o que só informa ("também no limite") fica de fora.
  const outra = conta.foraDaTroca.length > 0 ? acaoSemOutra(ia, { ...p, fixa: true }) : null;
  const extras = [
    ...(outra && !outra.substitui ? [outra.html] : []),
    ...(conta.voltaEm !== null ? [`<span>ou esperar a conta voltar ${esc(quandoVolta(conta.voltaEm, p.agora))}</span>`] : []),
  ];
  const fim = escolhida !== null
    ? `<span>Seguindo com a conta ${escolhida} · mande a mensagem de novo</span>`
    : [
      ui.noApp && ui.contas[ia]
        ? livres.map((n) => `<button type="button" class="linha-link" data-act="conta-usar" data-ia="${ia}" data-posicao="${n}">Seguir com a conta ${n}</button>`).join(sep)
        : "<span>Escolha a conta no app do nod no Mac</span>",
      ...extras,
    ].join(sep);
  return `<div class="linha-centro-wrap linha-espera" role="status" data-fica><span class="linha-centro estatica"><span class="linha-ic" aria-hidden="true">${ICONE_RELOGIO}</span><span>${esc(frase)}</span><span aria-hidden="true">·</span>${fim}</span></div>`;
}

/**
 * ADR-102 (2026-10-13, protótipo CMD-1): a conta bateu no limite e há outra livre do mesmo provedor ("Perguntar antes"),
 * ou só noutra máquina. A frase do servidor ("Claude · Pessoal no limite na vm-bots até 14:00. Seguir com …?") e um passo
 * por saída: "Seguir com <conta>" (logada na máquina do turno; o turno é refeito nela), "Rodar no <máquina> desta vez"
 * (a conta livre só noutra máquina), "Entrar com <conta> na <máquina>" (o login abre em Provedores de IA) e a espera.
 */
function linhaContasNoLimite(m: Mensagem, c: ContasNoLimite, agora: number): string {
  const sep = '<span aria-hidden="true">·</span>';
  const conversa = esc(m.conversaId);
  const passos: string[] = [];
  for (const l of c.livres) {
    const nome = `${PROVEDOR_DA_IA[l.ia].nome} · ${l.apelido}`;
    if (l.naMaquina) passos.push(`<button type="button" class="linha-link forte" data-act="cl-seguir" data-id="${esc(l.id)}" data-conversa="${conversa}">Seguir com ${esc(nome)}</button>`);
    else if (l.outraMaquina) {
      passos.push(`<button type="button" class="linha-link" data-act="rodar-desta-vez" data-conversa="${conversa}" data-maquina="${esc(l.outraMaquina.id)}">Rodar no ${esc(l.outraMaquina.nome)} desta vez</button>`);
      if (c.maquina) passos.push(`<button type="button" class="linha-link" data-act="cl-entrar-chat" data-id="${esc(l.id)}" data-ia="${l.ia}" data-apelido="${esc(l.apelido)}" data-maquina="${esc(c.maquina.id)}">Entrar com ${esc(nome)} na ${esc(c.maquina.nome)}</button>`);
    }
  }
  if (c.voltaEm !== null) passos.push(`<span>ou esperar ${esc(quandoVolta(c.voltaEm, agora).replace(/^às /, "até "))}</span>`);
  return `<div class="linha-centro-wrap linha-espera" role="status" data-fica><span class="linha-centro estatica"><span class="linha-ic" aria-hidden="true">${ICONE_RELOGIO}</span><span>${esc(m.texto)}</span>${passos.length ? `${sep}${passos.join(sep)}` : ""}</span></div>`;
}

/** ADR-102: o turno seguiu noutra conta sozinho ("Trocar sozinho" ou outra IA), ou na conta que a pessoa escolheu. */
export function linhaContaSeguiu(m: Mensagem): string | null {
  if (m.payload?.kind !== "conta_seguiu" && m.payload?.kind !== "conta_escolhida") return null;
  return `<div class="linha-centro-wrap linha-ia"><span class="linha-centro estatica"><span class="linha-ic" aria-hidden="true">↻</span><span>${esc(m.texto)}</span></span></div>`;
}

/**
 * ADR-101: em "Trocar sozinho", o nod seguiu com a próxima conta da mesma IA e repetiu o turno. Uma linha discreta, só
 * com posições ("Conta 1 do Claude Code no limite até 14:00. Seguindo com a conta 3."); o apelido fica no Mac.
 */
export function linhaContaTrocada(m: Mensagem): string | null {
  if (m.payload?.kind !== "conta_trocada") return null;
  return `<div class="linha-centro-wrap linha-ia"><span class="linha-centro estatica"><span class="linha-ic" aria-hidden="true">↻</span><span>${esc(m.texto)}</span></span></div>`;
}

const ICONE_RELOGIO = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/></svg>';
const GIRA_LINHA = '<span class="ob-gira" aria-hidden="true"></span>';

/** O passo da linha do limite, pelo estado da outra IA (no app, o do Mac; fora dele, o do servidor). */
function acaoSemOutra(ia: IdIa, p: { agenteId: string | null; agora: number; ui: UiIas; ias: readonly IaDaPessoa[] | null; fixa: boolean; nomeDoBot: string | null }): { html: string; substitui?: true } | null {
  const outra = OUTRA[ia];
  const { nome, cli } = PROVEDOR_DA_IA[outra];
  const e = estadoNaTela(outra, p.ias?.find((x) => x.id === outra), p.ui, p.agora);
  const link = (act: string, rotulo: string, dados = "") => `<button type="button" class="linha-link" data-act="${act}" data-ia="${outra}"${dados}>${esc(rotulo)}</button>`;
  const provedores = (rotulo: string) => `<button type="button" class="linha-link" data-act="secao-espaco" data-secao="conexao">${esc(rotulo)}</button>`;
  const noApp = p.ui.noApp;
  switch (e.estado) {
    case "pronta":
      if (p.fixa && p.agenteId) return { html: `<button type="button" class="linha-link" data-act="inteligencia" data-id="${esc(p.agenteId)}">Usar o ${esc(nome)}</button>` };
      return { html: `<span>${esc(nome)} conectado · mande a mensagem de novo</span>`, substitui: true };
    case "falta_entrar":
    case "sem_acesso":
      return { html: noApp ? link("ia-entrar", `Continuar pelo ${nome}`) : provedores(`Conectar o ${nome}`) };
    case "nao_instalada":
    case "sem_node":
    case "desatualizada":
      return { html: noApp ? link("ia-instalar", `Instalar o ${nome}`) : provedores(`Conectar o ${nome}`) };
    case "instalando":
      return { html: `<span>Instalando o ${esc(cli)}…</span>${GIRA_LINHA}`, substitui: true };
    case "entrando": {
      const login = e.mac?.login;
      if (outra === "codex-cli" && login?.codigoDoDispositivo) {
        return { html: `<span>Digite</span><code class="linha-codigo">${esc(login.codigoDoDispositivo)}</code><span>na página da OpenAI</span><span aria-hidden="true">·</span>${link("ia-abrir-link", "Abrir")}${GIRA_LINHA}`, substitui: true };
      }
      return { html: `<span>Entre no ${esc(nome)}</span><span aria-hidden="true">·</span>${provedores("Terminar em Provedores de IA")}`, substitui: true };
    }
    case "testando":
      return { html: `<span>${esc(nome)} conectado · testando</span>${GIRA_LINHA}`, substitui: true };
    case "no_limite":
      return { html: `<span>${esc(nome)} também está no limite</span>`, substitui: true };
    case "procurando":
    case "lenta":
    case "config_invalida":
      return { html: provedores("Ver Provedores de IA") };
  }
}

/** "às 17:00" no mesmo dia; "em 09/10 às 17:00" noutro — na hora LOCAL de quem lê (o texto gravado é de São Paulo). */
function quandoVolta(voltaEm: number, agora: number): string {
  const dia = (t: number) => formatoData("pt-BR", { day: "2-digit", month: "2-digit" }).format(new Date(t));
  return dia(voltaEm) === dia(agora) ? `às ${hora(voltaEm)}` : `em ${dia(voltaEm)} às ${hora(voltaEm)}`;
}

/** NOD-171: o comando que atualiza a IA, com "Copiar"; no app do Mac, "Atualizar" abre a página oficial. */
export function linhaAtualizarIa(ia: IdIa, noApp: boolean): string {
  const comando = COMANDO_ATUALIZAR_IA[ia];
  const abrir = noApp ? botao("ia-atualizar", `Atualizar o ${PROVEDOR_DA_IA[ia].cli}`, { classe: "pri sm", dados: { ia } }) : "";
  return `<div class="ia-atualizar"><p>No Terminal deste Mac, rode:</p><div class="ia-comando"><code>${esc(comando)}</code>${botao("copiar-texto", "Copiar", { classe: "sm", dados: { texto: comando } })}</div><p class="mudo">O nod percebe sozinho quando a versão nova estiver instalada.</p>${abrir}</div>`;
}

/**
 * Tela 3 do plano das IAs (protótipo Troca, aprovado em 2026-10-09): o bot em automático passou a responder por outra IA.
 * Uma linha centralizada e discreta — "O Claude chegou ao limite · respondendo pelo ChatGPT" —, dita uma vez por troca;
 * o porquê, até quando e "Ver em Provedores de IA" ficam atrás do clique. `modelo` = o modelo do bot na IA que assumiu.
 */
export function linhaIaTrocada(m: Mensagem, extra: { modelo?: string | null } = {}): string | null {
  const p = m.payload;
  if (p?.kind !== "ia_trocada" || !ehIa(p.de) || !ehIa(p.para)) return null;
  const de = PROVEDOR_DA_IA[p.de];
  const para = PROVEDOR_DA_IA[p.para];
  const comModelo = extra.modelo ? `o ${para.nome} (${extra.modelo})` : `o ${para.nome}`;
  const [motivo, detalhe] = p.causa === "limite"
    ? [`O ${de.nome} chegou ao limite`, `A assinatura do ${de.nome} chegou ao limite${p.renovaEm ? ` e renova ${quandoVolta(p.renovaEm, m.criadoEm)}` : ""}. Até lá, seus bots em automático usam ${comModelo}. Depois, voltam sozinhos para o ${de.nome}.`]
    : p.causa === "conta_sem_acesso"
      ? [`A conta do ${de.nome} está sem acesso`, `A conta do ${de.nome} deste Mac entrou, mas não tem acesso ao ${de.cli} pela assinatura. Seus bots em automático usam ${comModelo} até ela voltar.`]
      : [`O ${de.nome} não respondeu`, `O ${de.cli} deste Mac não respondeu. Seus bots em automático usam ${comModelo} até ele voltar.`];
  const ver = `<button type="button" class="linha-link" data-act="secao-espaco" data-secao="conexao">Ver em Provedores de IA</button>`;
  return `<div class="linha-centro-wrap linha-ia"><details class="linha-ia-troca" data-disclosure="ia-trocada-${esc(m.id)}"><summary class="linha-centro">${logo(p.para)}<span>${esc(motivo)} ·</span><b>respondendo pelo ${esc(para.nome)}</b></summary><p class="linha-ia-detalhe">${esc(detalhe)} ${ver}</p></details></div>`;
}
