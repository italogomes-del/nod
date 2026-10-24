import type { MaquinaDto } from "../../src/contracts/maquina.ts";
import type { Agente } from "../../src/contracts/agente.ts";
import type { ConectarMaquina, Estado } from "../estado/reducer.ts";
import { ICONE } from "../lib/icones.ts";
import { botao, esc, hora, iconeAgente } from "../lib/render.ts";
import { maquinasDe, memoriaLegivel, seguradoPeloMac } from "../lib/trabalhos.ts";
import { discoLegivel, NOME_FILA, NOME_MEMORIA, NOME_PROCESSADOR, tempoAteAcabar } from "./este-mac.ts";
import { renderContasNaMaquina, resumoDasContasNaMaquina, type ContextoContas } from "./contas-lista.ts";
import { linhaEmSegundoPlano, renderInstalarSsh } from "./instalar-ssh.ts";
import { acoesDaFalha, avisoDaConta, criandoDaConta, fraseDaCriacao, motivoLegivel, nomeDaZona, nuvemLigada, OPCOES_SONO, REGIOES_CRIAR, rotuloEstadoNuvem, rotuloSono, TAMANHOS_CRIAR, temLinhaDeFalha, urlConsoleGoogle } from "../lib/maquina-nuvem.ts";
import type { MaquinaCriandoDto } from "../../src/contracts/provedor-nuvem.ts";

/**
 * Seu espaço › Máquinas (ADR-090; protótipo "Nod — Motor na VM", pranchas 1 e 2): as máquinas da pessoa (o Mac e as VMs
 * em que o motor roda), o que cada uma anunciou, onde cada bot trabalha e o "Conectar uma máquina" por código. A janela
 * continua no Mac ou no navegador; a máquina escolhida roda o Claude Code ou o Codex do bot.
 */

const NOME_IA: Record<string, string> = { "claude-cli": "Claude Code", "codex-cli": "Codex" };

function nomePlataforma(m: MaquinaDto): string {
  if (!m.conectada) return "não conectada agora";
  return `${m.plataforma === "linux" ? "Linux" : "Mac"}${soComputador(m) ? " · só computador" : ""}`;
}

/** NOD-94: a máquina "só computador" hospeda o computador dos bots e não pega trabalho (não entra nos seletores). */
export const soComputador = (m: Pick<MaquinaDto, "papel">): boolean => m.papel === "computador";
/** As máquinas onde um bot pode trabalhar (sem as só-computador). */
export const maquinasDeTrabalho = <T extends Pick<MaquinaDto, "papel">>(lista: readonly T[]): T[] => lista.filter((m) => !soComputador(m));

/** NOD-94: tirar o computador de uma só-computador (o nod não guarda o acesso SSH: a pessoa roda lá). */
export const COMANDO_DESLIGAR_COMPUTADOR = "sudo systemctl disable --now nod-motor";

/**
 * A máquina de um bot: a dele, senão o padrão da pessoa; null = qualquer uma (com o servidor no Mac, ADR-092: este Mac).
 * Só conta chave que ainda existe.
 */
export function maquinaDoBot(estado: Estado, bot: Pick<Agente, "maquinaId">): MaquinaDto | null {
  const lista = maquinasDeTrabalho(estado.maquinas?.maquinas ?? []);
  return lista.find((m) => m.id === bot.maquinaId) ?? lista.find((m) => m.id === estado.maquinas?.padraoId) ?? null;
}

/** Os bots da pessoa (só a dona escolhe onde o bot trabalha), sem os excluídos. */
export function botsDaPessoa(estado: Estado): Agente[] {
  return (estado.frota?.agentes ?? []).filter((a) => a.ownerId === estado.sessao?.pessoaId && !a.excluidoEm);
}

function chipsDasIas(m: MaquinaDto): string {
  const ias = Object.entries(m.ias).map(([id, est]) => `<span class="maq-ia${est === "pronto" ? "" : " nao"}"><i aria-hidden="true"></i>${esc(NOME_IA[id] ?? id)} ${est === "pronto" ? "pronto" : est === "nao_autenticado" ? "sem login" : "ausente"}</span>`);
  if (m.gh) ias.push(`<span class="maq-ia"><i aria-hidden="true"></i>GitHub</span>`);
  return ias.length ? `<div class="maq-ias">${ias.join("")}</div>` : "";
}

/**
 * A leitura da máquina no cartão (definido em 2026-10-09, a tela fala por máquina): o status curto à vista — se ela
 * segura trabalho novo agora e quantos esperam — e os números atrás do clique (memória `marlon-design-limpo-info-escondida`).
 * Sem leitura dela (motor anterior, ou sem contato), nada.
 */
export function leituraNoCartao(estado: Pick<Estado, "trabalhos">, id: string): string {
  const l = maquinasDe(estado.trabalhos)?.find((x) => x.id === id);
  if (!l) return "";
  const esperam = (estado.trabalhos?.trabalhos ?? []).filter((t) => seguradoPeloMac(t, false) && t.maquina?.id === id).length;
  const oQue = l.motivoEspera === "disco" ? "espaço no disco" : l.motivoEspera === "memoria" ? "ela liberar memória" : "ela aliviar";
  // ADR-096 §6: o disco que acaba em menos de 24 h aparece antes de os bots pararem.
  const acaba = typeof l.disco?.acabaEmMs === "number" ? l.disco.acabaEmMs : null;
  const curto = l.motivoEspera === null ? (acaba !== null ? `Disco acaba em ${tempoAteAcabar(acaba)} no ritmo atual` : "Trabalho novo começa na hora")
    : `${l.motivoEspera === "disco" ? "Pouco espaço no disco" : l.motivoEspera === "memoria" ? "Pouca memória" : "Ocupada"} · ${esperam > 0 ? `${esperam} ${esperam === 1 ? "trabalho espera" : "trabalhos esperam"}` : "trabalho novo espera"} ${oQue}`;
  const nivel = l.motivoEspera === null ? (acaba !== null ? "amarela" : "verde") : l.seguraTudoNovo || l.pressao === "vermelha" ? "vermelha" : "amarela";
  const numeros = [
    `Memória ${NOME_MEMORIA[l.pressao]}`,
    l.processador ? `processador ${NOME_PROCESSADOR[l.processador]}${l.usoProcessador !== null ? ` (${Math.round(l.usoProcessador * 100)}% do tempo ocupado)` : ""}` : "processador sem leitura",
    l.fila && l.fila !== "verde" && l.cargaProcessador !== null ? `fila ${NOME_FILA[l.fila]} (${l.cargaProcessador.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} processos por núcleo)` : "",
    l.disco ? `disco com ${discoLegivel(l.disco.livreMb)} livres de ${discoLegivel(l.disco.totalMb)}${acaba !== null ? ` (no ritmo atual, acaba em ${tempoAteAcabar(acaba)}; o Nod limpa o que dá)` : ""}` : "disco sem leitura",
    l.memoriaBotsMb > 0 ? `os bots usam ${memoriaLegivel(l.memoriaBotsMb)}` : "",
  ].filter(Boolean).join(" · ");
  const porque = l.motivoEspera === null ? ""
    : l.seguraTudoNovo ? " Com o disco quase sem espaço, nenhuma task nova começa nela; as que já rodam continuam."
      : " Rotinas e pedidos entre bots que ainda não começaram esperam; o que você pede começa.";
  return `<details class="maq-leitura" data-disclosure="maq-leitura-${esc(id)}"><summary><span class="maq-nivel nivel-${nivel}" aria-hidden="true"></span><span>${esc(curto)}</span></summary><p class="mac-det-txt">${esc(numeros)}.${esc(porque)} O quanto os bots podem usar (Este Mac) vale para todas as máquinas.</p></details>`;
}

/** ADR-102 (G2-M3): o ⋯ da máquina — renomear, as contas dela e desconectar. */
function menuDaMaquina(estado: Estado, m: MaquinaDto): string {
  const aberto = estado.contasUi.maquinaMenu === m.id;
  const bots = botsDaPessoa(estado).filter((b) => maquinaDoBot(estado, b)?.id === m.id).map((b) => b.nome);
  const itens = aberto
    ? `<div class="cl-menu" aria-label="${esc(m.nome)}">
        <span class="cl-menu-tit">${esc(m.nome)}</span>
        <button type="button" data-act="maq-renomear" data-maquina="${esc(m.id)}">${ICONE.lapis}<span>Renomear máquina</span></button>
        ${estado.contasIa?.disponivel && !soComputador(m) ? `<button type="button" data-act="cl-gerenciar" data-maquina="${esc(m.id)}">${ICONE.info}<span>Gerenciar contas<small>abre Provedores de IA filtrado</small></span></button>` : ""}
        ${soComputador(m) ? "" : `<button type="button" data-act="maq-bots" data-maquina="${esc(m.id)}">${ICONE.agentes}<span>Bots desta máquina<small>${esc(bots.length === 0 ? "nenhum bot trabalha só aqui" : `${bots.length} ${bots.length === 1 ? "bot" : "bots"}: ${bots.join(", ")}`)}</small></span></button>`}
        ${podeDormirPeloGoogle(estado, m) ? `<button type="button" data-act="nuvem-conectar-abrir" data-maquina="${esc(m.id)}">${ICONE.servidor}<span>Dormir e acordar pelo Google<small>ela dorme parada e acorda quando chega trabalho</small></span></button>` : ""}
        <hr>${m.nuvem?.criadaPeloNod ? `<button type="button" class="perigo" data-act="nuvem-excluir" data-id="${esc(m.id)}" data-nome="${esc(m.nome)}">${ICONE.lixo}<span>Excluir máquina<small>apaga a VM na sua conta Google</small></span></button>` : ""}<button type="button" class="perigo" data-act="maq-desconectar" data-maquina="${esc(m.id)}">${ICONE.sair}<span>Desconectar máquina</span></button>
      </div>`
    : "";
  return `<div class="cl-mais"><button type="button" class="cl-mais-bt" data-act="maq-menu" data-maquina="${esc(m.id)}" aria-expanded="${aberto}" aria-label="Mais ações de ${esc(m.nome)}">${ICONE.pontos}</button>${itens}</div>`;
}

/**
 * ADR-121 (NOD-92): o ⋯ da VM sem `nuvem` oferece "Dormir e acordar pelo Google" — só com a flag ligada (a conta da nuvem
 * respondeu, ou alguma máquina já tem `nuvem`) e nunca no Mac.
 */
function podeDormirPeloGoogle(estado: Estado, m: MaquinaDto): boolean {
  return !m.nuvem && m.plataforma !== "darwin" && nuvemLigada(estado.nuvem, estado.maquinas?.maquinas ?? []);
}

/** O nome da instância do Google tem de começar por letra minúscula (o form vem com o nome da máquina quando serve). */
const NOME_INSTANCIA = /^[a-z](?:[-a-z0-9]{0,61}[a-z0-9])?$/;

/** ADR-121 (NOD-92): o formulário do "Dormir e acordar pelo Google" no cartão; o envio leva ao Google (POST nuvem/google). */
function formConectarNuvem(estado: Estado, m: MaquinaDto): string {
  const c = estado.nuvem.conectar;
  if (!c || c.maquinaId !== m.id) return "";
  const campo = (nome: "projeto" | "zona" | "nome", rotulo: string, valor: string, dica: string, foco = false) =>
    `<label class="nv-campo"><span>${esc(rotulo)}</span><input name="${nome}" type="text" value="${esc(valor)}" autocomplete="off" spellcheck="false" maxlength="63" placeholder="${esc(dica)}" data-nuvem-campo="${nome}" data-manter-foco="nuvem-${nome}"${foco ? " data-cl-autofoco" : ""} required></label>`;
  return `<form class="nv-conectar" data-form="nuvem-conectar" data-maquina="${esc(m.id)}" aria-label="Dormir e acordar pelo Google">
      <p class="cx-nota">Onde a ${esc(m.nome)} está no Google Cloud. O Google vai pedir permissão; o nod só liga e desliga esta máquina, nunca a apaga.</p>
      ${campo("projeto", "Projeto", c.projeto, "meu-projeto", true)}
      ${campo("zona", "Zona", c.zona, "southamerica-east1-a")}
      ${campo("nome", "Nome da instância", c.nome, "minha-vm")}
      ${c.erro ? `<p class="cx-erro" role="alert">${esc(c.erro)}</p>` : ""}
      <div class="cx-rodape"><button type="button" class="bt link" data-act="nuvem-conectar-fechar">Cancelar</button><button type="submit" class="bt pri">Entrar com o Google</button></div>
    </form>`;
}

/** O valor inicial do campo "Nome da instância": o nome da máquina, quando é um nome válido no Google. */
export function nomeDeInstanciaSugerido(m: Pick<MaquinaDto, "nome">): string {
  return NOME_INSTANCIA.test(m.nome) ? m.nome : "";
}

/** O estado da máquina na nuvem no lugar do "conectada / sem contato". Dormindo é normal: cinza, não erro. */
export function estadoNuvemNoCartao(m: MaquinaDto): string {
  const n = m.nuvem;
  if (!n) return "";
  const fora = n.estado !== "acordada";
  const desde = n.estado === "dormindo" ? ` desde ${hora(n.estadoDesde)}` : "";
  return `<span class="maq-estado${fora ? " fora" : ""}"><span class="maq-ponto${fora ? " fora" : ""}" aria-hidden="true"></span>${esc(rotuloEstadoNuvem(n.estado))}${esc(desde)}</span>`;
}

/**
 * ADR-121 (NOD-92): o que a nuvem põe no cartão — a linha de falha com o motivo e a ação, a recusa do último "Dormir
 * agora" e a linha do sono (Dorme depois de N · Dormir agora). Sem `nuvem`, nada.
 */
export function nuvemNoCartao(estado: Estado, m: MaquinaDto): string {
  const n = m.nuvem;
  if (!n) return "";
  const id = esc(m.id);
  const projeto = projetoDaConta(estado);
  const falha = temLinhaDeFalha(n)
    ? `<div class="nv-falha" role="status"><p>${esc(motivoLegivel(n.motivo, m.nome, n.zona))}</p><div class="nv-acoes">${acoesDaFalha(n.motivo).map((a) =>
      a.tipo === "console" ? `<a class="bt link" href="${esc(urlConsoleGoogle(projeto))}" target="_blank" rel="noopener noreferrer">${esc(a.rotulo)}</a>`
        : a.tipo === "reconectar" ? `<button type="button" class="bt link" data-act="nuvem-reconectar">${esc(a.rotulo)}</button>`
          : `<button type="button" class="bt link" data-act="nuvem-acordar" data-maquina="${id}">${esc(a.rotulo)}</button>`).join("")}</div></div>`
    : "";
  const recusa = estado.nuvem.recusa?.maquinaId === m.id ? `<p class="cx-erro" role="alert">${esc(estado.nuvem.recusa.texto)}</p>` : "";
  // A linha do sono some enquanto a permissão não volta (protótipo, "O mesmo motivo no cartão").
  if (n.motivo === "credencial_nuvem" || n.estado === "excluida" || n.estado === "criando") return `<div class="nv-sono">${falha}${recusa}</div>`;
  const aberto = estado.nuvem.sonoMenu === m.id;
  const menu = aberto
    ? `<div class="cl-menu" role="menu" aria-label="Dorme depois de">${OPCOES_SONO.map((o) => {
      const marcado = o.minutos === n.dormirAposMin;
      return `<button type="button" role="menuitemradio" aria-checked="${marcado}" data-act="nuvem-dormir-apos" data-maquina="${id}" data-minutos="${o.minutos ?? ""}"><span>${esc(o.rotulo)}</span></button>`;
    }).join("")}</div>`
    : "";
  const ajuste = `<span class="nv-ajuste-wrap"><button type="button" class="bt sm" data-act="nuvem-sono-menu" data-maquina="${id}" aria-haspopup="menu" aria-expanded="${aberto}">${esc(n.dormirAposMin === null ? "Nunca dormir" : rotuloSono(n.dormirAposMin))} ▾</button>${menu}</span>`;
  const frase = n.dormirAposMin === null ? `<span>Não dorme sozinha</span>${ajuste}` : `<span>Dorme depois de</span>${ajuste}<span>sem trabalho</span>`;
  const agir = n.estado === "acordada" ? `<button type="button" class="bt sm" data-act="nuvem-dormir" data-maquina="${id}">Dormir agora</button>`
    : n.estado === "dormindo" ? `<button type="button" class="bt sm" data-act="nuvem-acordar" data-maquina="${id}">Acordar agora</button>` : "";
  const nota = n.estado === "dormindo" ? `<p class="mac-det-txt">Acorda sozinha quando um bot precisar.</p>` : n.estado === "acordando" && n.motivo === null ? `<p class="mac-det-txt">Acordando: costuma levar 1 a 2 min.</p>` : "";
  return `<div class="nv-sono">${falha}<div class="nv-sono-linha">${frase}${agir}</div>${nota}${recusa}</div>`;
}

function projetoDaConta(estado: Pick<Estado, "nuvem">): string | null {
  const c = estado.nuvem.conta;
  return c && c !== "desligada" ? c.projeto : null;
}

/** ADR-121 (NOD-92): o aviso do topo depois da volta do Google (`?nuvem=preparando|recusado`). */
export function avisoDaNuvem(estado: Estado): string {
  const a = avisoDaConta(estado.nuvem);
  if (!a) return "";
  const reconectar = a.motivo === "credencial_nuvem" ? `<button type="button" class="bt link" data-act="nuvem-reconectar">Reconectar o Google</button>` : "";
  const noConsole = a.motivo === "cota_ou_cobranca" ? `<a class="bt link" href="${esc(urlConsoleGoogle(projetoDaConta(estado)))}" target="_blank" rel="noopener noreferrer">Abrir o console do Google ↗</a>` : "";
  const fechar = a.tom === "espera" ? "" : `<button type="button" class="bt link" data-act="nuvem-aviso-fechar">Fechar</button>`;
  return `<div class="espaco-cartao nv-aviso nv-${a.tom}" role="status">${a.tom === "espera" ? `<span class="ob-gira" aria-hidden="true"></span>` : ""}<span>${esc(a.texto)}</span><span class="nv-acoes">${noConsole}${reconectar}${fechar}</span></div>`;
}

/** ADR-102 (G2-M5): "Desconectar" com "Sair também das contas de IA" (marcada quando há contas lá). */
function dialogoDesconectar(estado: Estado): string {
  const q = estado.contasUi.desconectar;
  const m = q ? estado.maquinas?.maquinas.find((x) => x.id === q.maquinaId) : null;
  if (!q || !m) return "";
  const n = (estado.contasIa?.contas ?? []).filter((c) => c.maquinas.some((v) => v.maquinaId === m.id && v.estado === "pronta")).length;
  const bots = botsDaPessoa(estado).filter((b) => maquinaDoBot(estado, b)?.id === m.id).map((b) => b.nome);
  const pareceMac = m.plataforma === "darwin";
  const volta = bots.length ? ` ${bots.join(", ")} ${bots.length === 1 ? "volta" : "voltam"} para ${estado.maquinas?.servidorNoMac ? "este Mac" : "outra máquina"} no próximo trabalho; o que está rodando agora termina lá.` : "";
  const caixa = n > 0 ? `<label class="cl-caixa cl-check"><input type="checkbox" data-maq-sair-contas${q.sair ? " checked" : ""}><span>Sair também ${n === 1 ? "da conta" : `das ${n} contas`} de IA ${pareceMac ? "no" : "na"} ${esc(m.nome)}<small>Recomendado se a máquina vai ser apagada ou passar para outra pessoa. Nas outras máquinas as contas continuam.</small></span></label>` : "";
  const corpo = soComputador(m)
    ? `<p>A chave dela é cancelada e o computador dos seus bots volta para as máquinas de trabalho.</p><div class="ssh-manual"><p>O nod não guarda o acesso à ${esc(m.nome)}. Para tirar o computador de lá, rode no servidor:</p><div class="cx-cmd"><code>${esc(COMANDO_DESLIGAR_COMPUTADOR)}</code>${botao("copiar-texto", "Copiar", { classe: "sm", dados: { texto: COMANDO_DESLIGAR_COMPUTADOR } })}</div></div>`
    : `<p>A chave dela é cancelada e ela para de pegar trabalho.${esc(volta)}</p>${caixa}`;
  return `<div class="cl-fundo" data-act="maq-desconectar-fechar"></div><div class="cl-dialogo" role="dialog" aria-modal="true" aria-labelledby="maq-desc-tit"><h3 id="maq-desc-tit">Desconectar ${pareceMac ? "o" : "a"} ${esc(m.nome)}?</h3>${corpo}<div class="cl-dialogo-acoes"><button type="button" class="bt" data-act="maq-desconectar-fechar" data-cl-autofoco>Cancelar</button><button type="button" class="bt perigo" data-act="maq-desconectar-confirmar">Desconectar ${esc(m.nome)}</button></div></div>`;
}

function cartao(estado: Estado, m: MaquinaDto): string {
  const aqui = botsDaPessoa(estado).filter((b) => maquinaDoBot(estado, b)?.id === m.id);
  const quem = aqui.length === 0 ? "Nenhum bot trabalha só aqui" : aqui.length === 1 ? `${aqui[0]!.nome} trabalha aqui` : `${aqui.length} bots trabalham aqui: ${aqui.map((b) => b.nome).join(", ")}`;
  const estadoTxt = m.nuvem ? estadoNuvemNoCartao(m) : m.conectada
    ? `<span class="maq-estado"><span class="maq-ponto" aria-hidden="true"></span>conectada</span>`
    : `<span class="maq-estado fora"><span class="maq-ponto fora" aria-hidden="true"></span>sem contato${m.ultimoUsoEm ? ` desde ${esc(hora(m.ultimoUsoEm))}` : ""}</span>`;
  return `<div class="espaco-cartao maq-cartao">
    <div class="maq-cab">
      <span class="maq-ic" aria-hidden="true">${m.plataforma === "darwin" ? ICONE.laptop : ICONE.servidor}</span>
      ${estado.contasUi.maquinaRenomear === m.id
        ? `<form class="cl-renomear maq-renomear" data-form="maq-renomear" data-maquina="${esc(m.id)}"><input name="nome" maxlength="60" value="${esc(m.nome)}" aria-label="Nome da máquina" data-cl-autofoco data-manter-foco="maq-renomear"><button type="submit" class="bt pri sm">Salvar</button><button type="button" class="bt sm" data-act="maq-renomear-fechar">Cancelar</button></form>`
        : `<span class="maq-id"><b>${esc(m.nome)}</b><small>${esc(m.nuvem ? `Google Cloud · ${nomeDaZona(m.nuvem.zona)}` : nomePlataforma(m))} · chave …${esc(m.prefixo)}</small></span>`}
      ${estadoTxt}
      ${menuDaMaquina(estado, m)}
    </div>
    ${soComputador(m) ? `<div class="maq-quem"><span>Hospeda o computador dos seus bots e não pega trabalho</span></div>` : `${estado.contasIa?.disponivel ? resumoDasContasNaMaquina(estado.contasIa, m) : chipsDasIas(m)}
    ${m.conectada ? leituraNoCartao(estado, m.id) : ""}
    ${nuvemNoCartao(estado, m)}
    ${formConectarNuvem(estado, m)}
    <div class="maq-quem"><span class="maq-avatares">${aqui.slice(0, 6).map((b) => iconeAgente(b, "sm")).join("")}</span><span>${esc(quem)}</span></div>`}
  </div>`;
}

function seletor(rotulo: string, act: string, dados: Record<string, string>, atual: string | null, maquinas: MaquinaDto[], noMac: boolean): string {
  // ADR-092: com o servidor no Mac, a opção sem máquina é o próprio Mac — a VM só pega os bots escolhidos para ela.
  const opcoes = [{ id: "", nome: noMac ? "Este Mac" : "Qualquer uma" }, ...maquinas.map((m) => ({ id: m.id, nome: m.nome }))];
  return `<div class="segmentado maq" role="group" aria-label="${esc(rotulo)}">${opcoes.map((o) => {
    const ativo = (atual ?? "") === o.id;
    return `<button type="button" class="seg${ativo ? " ativo" : ""}" aria-pressed="${ativo}" data-act="${esc(act)}" data-maquina="${esc(o.id)}"${Object.entries(dados).map(([k, v]) => ` data-${k}="${esc(v)}"`).join("")}>${esc(o.nome)}</button>`;
  }).join("")}</div>`;
}

/** PR 2 (protótipo da NOD-92): "Criar minha máquina na nuvem" — provedor, região e tamanho; o Google pede a permissão. */
function painelCriar(estado: Estado): string {
  const c = estado.nuvem.criar;
  if (!c) return "";
  const conta = estado.nuvem.conta;
  const conectada = !!conta && conta !== "desligada" && conta.conectada;
  const provedores = `<div class="nv-provedores" role="radiogroup" aria-label="Provedor"><label class="nv-opcao"><input type="radio" name="provedor" value="gcp" checked><span><b>Google Cloud</b><small>a VM fica na sua conta Google</small></span></label><label class="nv-opcao desligada"><input type="radio" name="provedor" value="aws" disabled><span><b>AWS</b><small>Em breve</small></span></label><label class="nv-opcao desligada"><input type="radio" name="provedor" value="azure" disabled><span><b>Azure</b><small>Em breve</small></span></label></div>`;
  const regioes = REGIOES_CRIAR.map((r) => `<label class="nv-opcao"><input type="radio" name="regiao" value="${esc(r.regiao)}"${c.regiao === r.regiao ? " checked data-cl-autofoco" : ""} data-nuvem-criar="regiao"><span><b>${esc(r.nome)}</b>${r.nota ? `<small>${esc(r.nota)}</small>` : ""}</span></label>`).join("");
  const tamanhos = TAMANHOS_CRIAR.map((t) => `<label class="nv-opcao"><input type="radio" name="tamanho" value="${esc(t.tamanho)}"${c.tamanho === t.tamanho ? " checked" : ""} data-nuvem-criar="tamanho"><span><b>${esc(t.nome)}</b><small>${esc(t.nota)}</small></span></label>`).join("");
  const erro = c.erro ? `<p class="nv-erro" role="alert">${esc(c.erro)}</p>` : "";
  const enviar = conectada ? "Criar máquina" : "Entrar com o Google e criar";
  const nota = conectada ? "O nod cria a VM na sua conta Google, instala o motor e conecta sozinho. Você paga o Google pelo uso; ela dorme quando fica parada." : "O Google pede para você permitir que o nod crie e ligue máquinas na sua conta. Depois o nod instala o motor e conecta sozinho.";
  return `<form class="espaco-cartao nv-criar" data-form="nuvem-criar" aria-labelledby="nv-criar-tit">
    <div class="nv-criar-cab"><h3 id="nv-criar-tit">Criar minha máquina na nuvem</h3><button type="button" class="bt link" data-act="nuvem-criar-fechar">Cancelar</button></div>
    <fieldset><legend>Onde</legend>${provedores}</fieldset>
    <fieldset><legend>Região</legend><div class="nv-opcoes">${regioes}</div></fieldset>
    <fieldset><legend>Tamanho</legend><div class="nv-opcoes">${tamanhos}</div></fieldset>
    <p class="mac-det-txt">${esc(nota)}</p>${erro}
    <div class="nv-criar-acoes"><button type="submit" class="bt pri"${c.enviando ? " disabled" : ""}>${c.enviando ? "Enviando…" : esc(enviar)}</button></div>
  </form>`;
}

/** As VMs que o nod está criando (ainda sem chave): o que acontece agora e, se falhou, excluir ou criar de novo. */
function listaCriando(estado: Estado): string {
  const lista = criandoDaConta(estado.nuvem);
  if (lista.length === 0) return "";
  return lista.map((c: MaquinaCriandoDto) => {
    const falhou = c.estado !== "criando";
    const acoes = falhou ? `<span class="nv-acoes"><button type="button" class="bt sm" data-act="nuvem-excluir" data-id="${esc(c.id)}" data-nome="${esc(c.nome)}">Excluir</button><button type="button" class="bt sm pri" data-act="nuvem-criar-abrir" data-id="${esc(c.id)}">Criar de novo</button></span>` : "";
    return `<div class="espaco-cartao maq-cartao nv-criando${falhou ? " nv-falha" : ""}" role="status"><div class="maq-cab"><span class="maq-ic" aria-hidden="true">${ICONE.servidor}</span><span class="maq-id"><b>${esc(c.nome)}</b><small>Google Cloud · ${esc(nomeDaZona(c.zona))}</small></span><span class="maq-estado${falhou ? " fora" : ""}">${falhou ? "não deu certo" : `<span class="ob-gira" aria-hidden="true"></span>criando`}</span></div><p class="mac-det-txt">${esc(fraseDaCriacao(c))}</p>${acoes}</div>`;
  }).join("");
}

/** "Excluir a <nome>?": só a VM criada pelo nod; apaga a VM na conta Google da pessoa e cancela a chave. */
function dialogoExcluir(estado: Estado): string {
  const q = estado.nuvem.excluir;
  if (!q) return "";
  const erro = q.erro ? `<p class="nv-erro" role="alert">${esc(q.erro)}</p>` : "";
  return `<div class="cl-fundo" data-act="nuvem-excluir-fechar"></div><div class="cl-dialogo" role="dialog" aria-modal="true" aria-labelledby="nv-exc-tit"><h3 id="nv-exc-tit">Excluir a ${esc(q.nome)}?</h3><p>O nod apaga a VM na sua conta Google, com o disco e os arquivos dos bots que estão nela, e cancela a chave. Não dá para desfazer.</p>${erro}<div class="cl-dialogo-acoes"><button type="button" class="bt" data-act="nuvem-excluir-fechar" data-cl-autofoco>Cancelar</button><button type="button" class="bt perigo" data-act="nuvem-excluir-confirmar">Excluir ${esc(q.nome)}</button></div></div>`;
}

/** O topo: com a nuvem ligada, "Criar minha máquina na nuvem" é o principal e "Conectar uma máquina" vira secundário. */
function botoesDoTopo(estado: Estado, maquinas: MaquinaDto[]): string {
  const conectar = estado.conectarMaquina ? "" : botao("conectar-maquina", `${ICONE.mais}Conectar uma máquina`, { classe: nuvemLigada(estado.nuvem, maquinas) ? "" : "pri" });
  const criar = nuvemLigada(estado.nuvem, maquinas) && !estado.nuvem.criar ? botao("nuvem-criar-abrir", `${ICONE.mais}Criar minha máquina na nuvem`, { classe: "pri" }) : "";
  return criar || conectar ? `<span class="maq-topo-acoes">${criar}${conectar}</span>` : "";
}

export function renderMaquinas(estado: Estado): string {
  const dados = estado.maquinas;
  const todas = dados?.maquinas ?? [];
  const maquinas = maquinasDeTrabalho(todas);
  const temComputador = todas.some(soComputador);
  const bots = botsDaPessoa(estado);
  const noMac = !!dados?.servidorNoMac;
  // NOD-94: o atalho só no modo compartilhado (no local o Mac já é o computador) e fora do Conectar.
  const atalho = dados && !noMac && !estado.conectarMaquina && !estado.instalarSsh
    ? `<p class="ssh-atalho"><span>Quer só um lugar para o computador do bot, sem terminal?</span>${botao("ssh-abrir", "Usar uma máquina só para o computador", { classe: "link" })}</p>`
    : "";
  const conectar = estado.conectarMaquina ? renderConectar(estado, estado.conectarMaquina) : "";
  const lista = !dados ? `<p class="intro">Carregando…</p>`
    : todas.length === 0 ? `<div class="espaco-cartao maq-vazio"><p>${noMac ? "Nenhuma máquina conectada ainda. Os bots rodam neste Mac; conecte uma VM Linux para mandar bots para ela." : "Nenhuma máquina conectada ainda. Conecte o app do Mac ou uma VM Linux para os bots trabalharem nela."}</p></div>`
    : todas.map((m) => cartao(estado, m)).join("");
  const linhasBots = bots.map((b) => `<div class="bot-maq">${iconeAgente(b, "sm")}<span class="bot-maq-txt"><b>${esc(b.nome)}</b><span>${esc(b.titulo)}</span></span>${seletor(`Onde ${b.nome} trabalha`, "maquina-do-bot", { id: b.id }, b.maquinaId ?? null, maquinas, noMac)}</div>`).join("");
  return `<section class="espaco-secao maquinas">
    <h2>Máquinas</h2>
    <div class="maq-topo"><p class="intro">Onde seus bots trabalham. A janela do Nod continua no Mac ou no navegador; cada bot roda o Claude Code ou o Codex na máquina escolhida para ele.</p>${botoesDoTopo(estado, todas)}</div>
    ${atalho}
    ${avisoDaNuvem(estado)}
    ${painelCriar(estado)}
    ${conectar}
    ${linhaEmSegundoPlano(estado)}
    <div class="maq-lista">${listaCriando(estado)}${lista}</div>
    ${dialogoDesconectar(estado)}
    ${dialogoExcluir(estado)}
    ${renderInstalarSsh(estado)}
    ${maquinas.length > 0 && bots.length > 0 ? `<h3 class="espaco-subtitulo" id="bots-das-maquinas" tabindex="-1">Onde cada bot trabalha</h3><div class="espaco-cartao bots-cartao">${linhasBots}</div>
    <h3 class="espaco-subtitulo">Bot sem escolha (e bot novo) trabalha em</h3>${seletor("Onde trabalha o bot sem escolha", "maquina-padrao", {}, dados?.padraoId ?? null, maquinas, noMac)}` : ""}
    <ul class="regras-maq">
      ${noMac ? `<li>"Este Mac": o bot roda aqui, onde o Nod está aberto. Uma VM só pega o trabalho dos bots escolhidos para ela.</li>
      <li>Se a máquina de um bot ficar sem contato, a conversa espera por ela. Para o bot voltar a rodar aqui, escolha "Este Mac" para ele.</li>`
    : `<li>"Qualquer uma": o primeiro computador conectado que estiver livre pega o trabalho.</li>
      <li>Se a máquina de um bot ficar sem contato, a conversa espera por ela; na mensagem você pode rodar em outra máquina só daquela vez.</li>`}
      <li>Rotinas não mudam de máquina sozinhas. Os arquivos de cada bot ficam na máquina onde ele trabalha.</li>
      ${temComputador ? `<li>Uma máquina só computador não aparece aqui: nenhum bot trabalha nela, ela só hospeda o computador do bot.</li>` : ""}
    </ul>
  </section>`;
}

function haQuantoPediu(s: number): string {
  if (s < 60) return "agora há pouco";
  const min = Math.round(s / 60);
  return min === 1 ? "há 1 minuto" : `há ${min} minutos`;
}

/** A máquina que apareceu depois do "Conectar" (a chave nova), quando o motor já trocou o código pela chave. */
export function maquinaNova(estado: Estado, c: ConectarMaquina): MaquinaDto | null {
  return (estado.maquinas?.maquinas ?? []).find((m) => !c.chavesAntes.includes(m.id) && !soComputador(m)) ?? null;
}

/** ADR-102: o contexto da lista de contas para o passo "Contas" do Conectar (só VM: o Mac entra pelo app dele). */
function contextoDasContas(estado: Estado): ContextoContas | null {
  if (!estado.contasIa?.disponivel) return null;
  return {
    contas: estado.contasIa, maquinas: estado.maquinas?.maquinas ?? [], detalhes: estado.detalhesContas, ui: estado.contasUi, agora: estado.agora,
    noApp: estado.detalhesContas !== null, botsNaMaquina: () => [], cartaoDoMac: () => "",
  };
}

function renderConectar(estado: Estado, c: ConectarMaquina): string {
  // ADR-102 (CMJ): com o convite, a tela vê a máquina chegar — sem o passo de digitar o código.
  const comConvite = Boolean(c.convite);
  const passos = comConvite
    ? ([["comando", "Instalar"], ["confirmar", "Confirmar"], ["ias", "Contas"], ["bots", "Escolher os bots"]] as const)
    : ([
      ["comando", "Instalar"],
      ["codigo", "Digitar o código"],
      ["confirmar", "Confirmar"],
      ["ias", "Entrar nas IAs"],
      ["bots", "Escolher os bots"],
    ] as const);
  const indice = (passos as readonly (readonly [string, string])[]).findIndex(([id]) => id === (comConvite && c.passo === "codigo" ? "comando" : c.passo));
  const trilha = `<ol class="cx-trilha">${passos.map(([id, nome], i) => `<li class="${i < indice ? "feito" : i === indice ? "agora" : ""}"${id === c.passo ? ' aria-current="step"' : ""}><span>${i < indice ? "✓" : i + 1}</span>${esc(nome)}</li>`).join("")}</ol>`;
  const erro = c.erro ? `<p class="cx-erro" role="alert">${esc(c.erro)}</p>` : "";
  const fechar = botao("fechar-conectar-maquina", "Fechar", { classe: "link" });
  const nova = maquinaNova(estado, c);
  let corpo = "";
  if (c.passo === "comando" && comConvite) {
    const origem = (globalThis as { location?: { origin?: string } }).location?.origin ?? "";
    const cmd = `curl -fsSL "${origem}/motor?convite=${c.convite}" | sh`;
    corpo = `<h3>Rode este comando na sua máquina Linux</h3>
      <p>Debian ou Ubuntu, em qualquer provedor (2 vCPU e 4 GB para começar; 4 vCPU e 8 GB com vários bots). Ele instala o motor com o Claude Code e o Codex. A máquina não precisa de porta aberta: é ela que procura trabalho no Nod.</p>
      <div class="cx-cmd"><code>${esc(cmd)}</code>${botao("copiar-texto", "Copiar", { classe: "sm", dados: { texto: cmd } })}</div>
      <div class="cx-espera" role="status"><span class="ob-gira" aria-hidden="true"></span><span>Esperando a máquina aparecer…</span><small>o convite vale ${c.conviteAte ? `até ${esc(hora(c.conviteAte))}` : "por 30 min"} e uma vez</small></div>
      ${erro}
      <div class="cx-rodape">${fechar}<span class="cx-segue">Esta tela segue sozinha · ${botao("passo-conectar-maquina", "apareceu um código?", { classe: "link", dados: { passo: "codigo" } })}</span></div>`;
  } else if (c.passo === "comando") {
    // O endereço deste Nod (a página é servida por ele); os testes de render rodam sem DOM.
    const origem = (globalThis as { location?: { origin?: string } }).location?.origin ?? "";
    // ADR-092: com o servidor no Mac, a VM chega à API deste Mac por um túnel SSH aberto daqui (nada fica exposto na
    // internet); o motor guarda o endereço da API, então o túnel e o comando usam a porta dela, não a desta página.
    const noMac = estado.maquinas?.servidorNoMac ?? null;
    const cmd = noMac ? `curl -fsSL ${noMac.api}/api/motor/instalar | sh` : `curl -fsSL ${origem}/motor | sh`;
    const porta = noMac ? (/:(\d+)$/.exec(noMac.api)?.[1] ?? "8888") : "";
    const tunel = `ssh -N -R ${porta}:127.0.0.1:${porta} voce@sua-vm`;
    corpo = `<h3>Rode este comando na sua máquina Linux</h3>
      <p>Debian ou Ubuntu, em qualquer provedor. Para começar, 2 vCPU e 4 GB; com vários bots rodando testes e builds, 4 vCPU e 8 GB. Ela não precisa de porta aberta: é a máquina que procura trabalho no Nod. Use a máquina só para o Nod.</p>
      ${noMac ? `<p>Este Nod roda no seu Mac. Antes, abra no Mac um túnel SSH para a VM e deixe-o aberto: com ele a VM enxerga o Nod em ${esc(noMac.api)}, só ela e sem porta aberta na internet.</p>
      <div class="cx-cmd"><code>${esc(tunel)}</code>${botao("copiar-texto", "Copiar", { classe: "sm", dados: { texto: tunel } })}</div>
      <p>Depois, no terminal da VM:</p>` : ""}
      <div class="cx-cmd"><code>${esc(cmd)}</code>${botao("copiar-texto", "Copiar", { classe: "sm", dados: { texto: cmd } })}</div>
      <p class="cx-nota">Ele instala o motor, cria o usuário nod e, no fim, mostra um código.</p>
      <div class="cx-rodape">${fechar}${botao("passo-conectar-maquina", "Apareceu um código", { classe: "pri", dados: { passo: "codigo" } })}</div>`;
  } else if (c.passo === "codigo") {
    corpo = `<h3>Digite o código da máquina</h3>
      <p>Ele aparece no fim da instalação e vale por alguns minutos.</p>
      <label class="cx-codigo" for="codigo-maquina"><span>Código</span><input id="codigo-maquina" type="text" value="${esc(c.codigo)}" autocomplete="off" spellcheck="false" maxlength="12" placeholder="K7QM-4F2X"></label>
      ${erro}
      <div class="cx-rodape">${botao("passo-conectar-maquina", "Voltar", { classe: "link", dados: { passo: "comando" } })}${botao("ver-codigo-maquina", "Continuar", { classe: "pri" })}</div>`;
  } else if (c.passo === "confirmar" && c.pedido) {
    corpo = `<h3>Conectar ${esc(c.pedido.nome)}?</h3>
      <div class="cx-confirma"><span class="maq-ic" aria-hidden="true">${ICONE.servidor}</span><div><b>${esc(c.pedido.nome)}</b><small>${c.pedido.plataforma === "linux" ? "Linux" : "Mac"} · código ${esc(c.codigo.toUpperCase())} · pediu ${esc(haQuantoPediu(c.pedido.pedidoHaS))}</small></div></div>
      <p class="cx-nota">Confira se o terminal da máquina mostra o código <b>${esc(c.codigo.toUpperCase())}</b>. Conecte só se foi você quem rodou o comando nessa máquina agora. Quem conecta uma máquina passa a receber o trabalho dos bots que você mover para ela.</p>
      ${erro}
      <div class="cx-rodape">${botao("passo-conectar-maquina", "Voltar", { classe: "link", dados: { passo: comConvite ? "comando" : "codigo" } })}${botao("aprovar-maquina", `Conectar ${esc(c.pedido.nome)}`, { classe: "pri" })}</div>`;
  } else if (c.passo === "ias" && contextoDasContas(estado)) {
    const nome = nova?.nome ?? c.pedido?.nome ?? "a máquina";
    const ctx = contextoDasContas(estado)!;
    corpo = `<h3>Entre nas suas contas de IA na ${esc(nome)}</h3>
      <p>O login abre aqui na tela: você entra na página da Anthropic ou da OpenAI e a ${esc(nome)} fica com a conta. O Nod não vê sua senha, e o código que você cola vai cifrado direto para a máquina.</p>
      ${nova ? renderContasNaMaquina(ctx, nova.id) : `<div class="cx-espera" role="status"><span class="ob-gira" aria-hidden="true"></span><span>Esperando a ${esc(nome)} terminar de conectar…</span></div>`}
      <p class="cx-nota">GitHub (opcional), no terminal da máquina: <code>nod-motor entrar github</code></p>
      <div class="cx-rodape">${fechar}${botao("passo-conectar-maquina", "Continuar", { classe: "pri", dados: { passo: "bots" }, desabilitado: !nova })}</div>`;
  } else if (c.passo === "ias") {
    const nome = nova?.nome ?? c.pedido?.nome ?? "a máquina";
    const claude = nova?.ias["claude-cli"];
    const estadoClaude = !nova ? "esperando a máquina terminar de conectar…" : claude === "pronto" ? "pronto" : "aguardando o login";
    corpo = `<h3>Entre nas suas IAs na ${esc(nome)}</h3>
      <p>Rode cada comando no terminal da máquina. O login é seu, direto com a Anthropic, a OpenAI e o GitHub: o Nod não vê sua senha nem sua chave. Esta tela percebe sozinha quando ficar pronto.</p>
      <div class="espaco-cartao">
        <div class="cx-ia"><span class="cx-ia-txt"><b>Claude Code</b><code>nod-motor entrar claude</code></span><span class="cx-st${claude === "pronto" ? " ok" : ""}"><i aria-hidden="true"></i>${esc(estadoClaude)}</span></div>
        <div class="cx-ia"><span class="cx-ia-txt"><b>Codex</b><code>nod-motor entrar codex</code></span><span class="cx-st">opcional (instale com NOD_COM_CODEX=1)</span></div>
        <div class="cx-ia"><span class="cx-ia-txt"><b>GitHub</b><code>nod-motor entrar github</code></span><span class="cx-st">opcional</span></div>
      </div>
      <div class="cx-rodape">${fechar}${botao("passo-conectar-maquina", "Continuar", { classe: "pri", dados: { passo: "bots" }, desabilitado: !nova })}</div>`;
  } else if (c.passo === "bots") {
    const bots = botsDaPessoa(estado);
    const n = c.marcados.length;
    const linhas = bots.map((b) => {
      const marcado = c.marcados.includes(b.id);
      return `<button type="button" class="cx-bot" role="checkbox" aria-checked="${marcado}" data-act="marcar-bot-maquina" data-id="${esc(b.id)}"><span class="cx-check" aria-hidden="true">${marcado ? "✓" : ""}</span>${iconeAgente(b, "sm")}<span>${esc(b.nome)}</span><small>${esc(b.titulo)}</small></button>`;
    }).join("");
    corpo = `<h3>Quem passa a trabalhar na ${esc(nova?.nome ?? "máquina")}?</h3>
      <p>Eles saem do seu Mac a partir do próximo trabalho. O que está rodando agora termina onde começou.${estado.maquinas?.servidorNoMac ? " Os outros, e bot novo, continuam neste Mac." : " Bot novo também passa a trabalhar nela."}</p>
      <div class="espaco-cartao cx-bots"><div class="cx-bots-cab"><span>${n} de ${bots.length} bots</span>${botao("marcar-bots-maquina", "Marcar todos", { classe: "link", dados: { todos: "1" }, desabilitado: n === bots.length })}${botao("marcar-bots-maquina", "Nenhum", { classe: "link", dados: { todos: "0" }, desabilitado: n === 0 })}</div>${linhas}</div>
      ${erro}
      <div class="cx-rodape">${botao("fechar-conectar-maquina", "Agora não", { classe: "link" })}${botao("mover-bots-maquina", n === 0 ? "Concluir" : n === 1 ? "Mover 1 bot" : `Mover ${n} bots`, { classe: "pri" })}</div>`;
  }
  return `<div class="espaco-cartao cx-painel" aria-label="Conectar uma máquina">${trilha}<div class="cx-corpo">${corpo}</div></div>`;
}
