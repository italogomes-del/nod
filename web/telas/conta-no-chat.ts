import type { CadastroDto, ContagemEspacoDto, EntrarDto, EsperaPareamentoDto, EstadoContaDto, EstadoPareamentoDto, ImportarDto, PareamentoAbertoDto, PedirPareamentoDto, SessaoContaDto, SessoesDto, TrocarSenhaDto, VerificarDto } from "../../src/contracts/conta.ts";
import { AppDesatualizado, ErroApi } from "../lib/erro-api.ts";
import { esc } from "../lib/render.ts";

/**
 * NOD-345 (ADR-124, protótipo aprovado do Gil): criar conta, entrar, levar o espaço, recuperar a senha, ver as sessões e
 * conectar outro computador são CARTÕES NA CONVERSA — um ativo por vez; o que se resolve vira uma linha curta no fim.
 *
 * Os valores dos campos (e-mail, senha, código) vivem só no DOM do cartão e na chamada: nada vai para o estado da web,
 * para o localStorage nem para o transcript (o bloco é "ao vivo", nunca uma mensagem). As linhas resolvidas também não
 * citam a senha — no máximo o e-mail, que a pessoa digitou ali mesmo.
 */
/** O pedaço de `contaApi` (web/lib/api.ts) que os cartões usam; escrito aqui para os testes não puxarem o XHR. */
export type ApiConta = {
  estado(): Promise<EstadoContaDto>;
  cadastrar(email: string, senha: string): Promise<CadastroDto>;
  reenviar(): Promise<CadastroDto>;
  verificar(codigo: string): Promise<VerificarDto>;
  entrar(email: string, senha: string): Promise<EntrarDto>;
  importar(): Promise<ImportarDto>;
  outra(): Promise<unknown>;
  cancelar(): Promise<unknown>;
  recuperar(email: string): Promise<unknown>;
  trocarSenha(atual: string, nova: string): Promise<TrocarSenhaDto>;
  sessoes(): Promise<SessoesDto>;
  sairDasOutras(): Promise<{ encerradas: number }>;
  gerarPareamento(): Promise<{ codigo: string; expiraEm: number }>;
  pareamento(): Promise<{ pareamento: PareamentoAbertoDto }>;
  decidirPareamento(confirmar: boolean): Promise<{ estado: EstadoPareamentoDto }>;
  pedirPareamento(codigo: string): Promise<PedirPareamentoDto>;
  esperarPareamento(): Promise<EsperaPareamentoDto>;
  google(app: boolean): Promise<{ url: string }>;
};
/** Sem DOM nos tipos: o módulo compila também no tsconfig dos testes (o HTMLElement e o form da página cabem aqui). */
type ElAcao = { dataset: { [k: string]: string | undefined } };
type Formulario = object;

export type Etapa =
  | { tipo: "inicio" }
  | { tipo: "cadastro"; erro: string | null }
  | { tipo: "codigo"; email: string; restantes: number | null; vencido: boolean; reenviado: boolean; erro?: string | null; naoEnviado?: boolean }
  | { tipo: "escolha"; email: string; espaco: ContagemEspacoDto | null; falhou: boolean; confirmado: boolean; incerto?: boolean; semSessao?: boolean }
  | { tipo: "entrar"; erro: string | null }
  | { tipo: "recuperar"; enviadoPara: string | null }
  | { tipo: "senha"; erro: string | null; salva: number | null }
  | { tipo: "sessoes"; dados: SessoesDto | null; confirmar: boolean }
  | { tipo: "parear-gerar"; codigo: string; expiraEm: number; pedido: { aparelho: string; simbolos: string[] } | null; vencido: boolean }
  | { tipo: "parear-entrar"; simbolos: string[] | null; erro: string | null }
  | { tipo: "google-app" };

export type VistaConta = { etapa: Etapa | null; ocupado: boolean; resolvidas: readonly string[]; google: boolean; agora: number };

const SELO = `<span class="cc-selo">Conta no nod</span>`;
const SIMBOLO: Record<string, string> = { sol: "☀️", lua: "🌙", estrela: "⭐", folha: "🍃", onda: "🌊", montanha: "⛰️", chave: "🔑", barco: "⛵", flor: "🌸", nuvem: "☁️", raio: "⚡", peixe: "🐟" };

const bt = (act: string, rotulo: string, o: { classe?: string; ocupado?: boolean; dados?: Record<string, string> } = {}) =>
  `<button type="button" class="bt ${o.classe ?? ""}" data-act="${act}"${Object.entries(o.dados ?? {}).map(([k, v]) => ` data-${k}="${esc(v)}"`).join("")}${o.ocupado ? " disabled" : ""}>${rotulo}</button>`;
const enviar = (rotulo: string, ocupado: boolean, conferindo = "Conferindo…") =>
  `<button type="submit" class="bt pri"${ocupado ? ' disabled aria-busy="true"' : ""}>${esc(ocupado ? conferindo : rotulo)}</button>`;
const erroDe = (texto: string | null) => (texto ? `<p class="cc-erro" role="alert">${esc(texto)}</p>` : "");
const campoEmail = (rotulo = "E-mail") => `<label class="cc-campo">${rotulo}<input name="email" type="email" autocomplete="email" required maxlength="254" spellcheck="false" autocapitalize="off"></label>`;
const campoSenha = (nome: string, rotulo: string, nova: boolean) =>
  `<label class="cc-campo">${rotulo}<span class="cc-senha"><input name="${nome}" type="password" autocomplete="${nova ? "new-password" : "current-password"}" required ${nova ? 'minlength="12" ' : ""}maxlength="128"><button type="button" class="cc-mostrar" data-act="conta-mostrar" aria-pressed="false">Mostrar</button></span></label>`;
const cartao = (titulo: string, corpo: string, rotulo = titulo) => `<div class="cc-cartao" role="group" aria-label="${esc(rotulo)}">${SELO}<h3 class="cc-titulo">${esc(titulo)}</h3>${corpo}</div>`;

/** "3 bots, 12 conversas e 2 rotinas" (só o que tem; sem nada, null). */
export function resumoDoEspaco(c: ContagemEspacoDto | null): string | null {
  if (!c) return null;
  const partes = ([["bots", "bot", "bots"], ["conversas", "conversa", "conversas"], ["rotinas", "rotina", "rotinas"], ["artefatos", "artefato", "artefatos"]] as const)
    .filter(([k]) => c[k] > 0)
    .map(([k, um, varios]) => `${c[k]} ${c[k] === 1 ? um : varios}`);
  return partes.length ? new Intl.ListFormat("pt-BR", { style: "long", type: "conjunction" }).format(partes) : null;
}

/** "Mac · app do nod · usada agora" para a lista de sessões. */
function linhaSessao(s: SessaoContaDto, atual: string, agora: number): string {
  const min = Math.round((agora - s.ultimoUsoEm) / 60_000);
  const quando = min < 2 ? "usada agora" : min < 60 ? `usada há ${min} min` : min < 60 * 24 ? `usada há ${Math.round(min / 60)} h` : `usada há ${Math.round(min / 1440)} dias`;
  return `<li${s.id === atual ? ' class="cc-atual"' : ""}><span>${esc(s.aparelho)}</span><span class="cc-meta">${s.id === atual ? "esta sessão" : quando}</span></li>`;
}

const simbolos = (lista: readonly string[]) => `<p class="cc-simbolos" aria-label="${esc(lista.join(", "))}">${lista.map((s) => `<span title="${esc(s)}">${SIMBOLO[s] ?? esc(s)}</span>`).join("")}</p>`;

/** O cartão ativo. Puro: a vista entra, o HTML sai (os testes leem isto). */
export function htmlEtapa(e: Etapa, v: { ocupado: boolean; google: boolean; agora: number }): string {
  const o = v.ocupado;
  switch (e.tipo) {
    case "inicio":
      return cartao(
        "Guarde seu espaço numa conta",
        `<p class="cc-texto">Hoje ele está só neste computador. Com uma conta, você entra de qualquer lugar e não perde nada.</p>
        <div class="cc-acoes cc-coluna">${v.google ? bt("conta-google", "Continuar com Google", { classe: "pri", ocupado: o }) : ""}${bt("conta-ir", "Usar e-mail", { classe: v.google ? "" : "pri", dados: { etapa: "cadastro" } })}${bt("conta-fechar", "Agora não", { classe: "cc-link" })}</div>
        <p class="cc-rodape">${bt("conta-ir", "Já tenho conta com e-mail", { classe: "cc-link", dados: { etapa: "entrar" } })}${bt("conta-ir", "Tenho um código", { classe: "cc-link", dados: { etapa: "parear-entrar" } })}</p>`,
        "Criar conta ou entrar",
      );
    case "cadastro":
      return cartao(
        "Criar conta com e-mail",
        `<form data-form="conta-cadastro" class="cc-form">${campoEmail()}${campoSenha("senha", "Senha", true)}<p class="cc-dica">Pelo menos 12 caracteres. Uma frase curta vale.</p>${erroDe(e.erro)}
        <div class="cc-acoes">${bt("conta-ir", "Voltar", { classe: "cc-link", dados: { etapa: "inicio" } })}${enviar("Criar conta", o, "Criando…")}</div></form>`,
      );
    case "codigo": {
      const aviso = e.erro
        ? erroDe(e.erro)
        : e.vencido
        ? `<p class="cc-erro" role="alert">Esse código venceu. Peça outro.</p>`
        : e.restantes !== null
          ? `<p class="cc-erro" role="alert">Código errado. Restam ${e.restantes}.</p>`
          : e.naoEnviado ? `<p class="cc-erro" role="alert">Não conseguimos mandar o e-mail agora. Tente mandar outro.</p>`
          : e.reenviado ? `<p class="cc-ok" role="status">Mandamos outro código.</p>` : "";
      const form = e.vencido
        ? `<div class="cc-acoes">${bt("conta-reenviar", "Mandar outro código", { classe: "pri", ocupado: o })}</div>`
        : `<form data-form="conta-codigo" class="cc-form"><label class="cc-campo">Código de 6 números<input name="codigo" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 \\-]{6,8}" maxlength="8" required class="cc-codigo"></label>${aviso}
          <div class="cc-acoes">${bt("conta-reenviar", "Mandar outro", { classe: "cc-link", ocupado: o })}${enviar("Confirmar", o)}</div></form>`;
      const topo = e.naoEnviado ? `<p class="cc-texto">O código para <b>${esc(e.email)}</b> ainda não saiu.</p>` : `<p class="cc-texto">Mandamos um código para <b>${esc(e.email)}</b>. Ele vale por 15 minutos.</p>`;
      return cartao("Confira seu e-mail", `${topo}${e.vencido ? aviso : ""}${form}`);
    }
    case "escolha": {
      const resumo = resumoDoEspaco(e.espaco);
      const topo = e.confirmado ? `<p class="cc-ok" role="status">E-mail confirmado.</p>` : "";
      if (e.semSessao) {
        // 401/403: esta aba já não tem sessão no espaço (a importação pode ter ido e a resposta se perdido). Não dá para
        // prometer "nada mudou": o caminho é entrar na conta e conferir lá.
        return cartao("Entre para conferir", `${topo}<p class="cc-texto">Não deu para confirmar daqui. Se o seu espaço foi levado, ele está em <b>${esc(e.email)}</b>: entre nessa conta para ver.</p>
          <div class="cc-acoes">${bt("conta-ir-entrar", "Entrar", { classe: "pri", ocupado: o })}</div>`);
      }
      if (e.incerto) {
        // A resposta não chegou: o servidor pode ter levado. "Nada mudou" seria promessa sem prova; tentar de novo é
        // seguro (a importação que já foi devolve a mesma resposta) e é a única saída oferecida.
        return cartao("Não deu para confirmar", `${topo}<p class="cc-texto">A conexão caiu antes da resposta. Tente de novo para saber se o seu espaço foi levado.</p>
          <div class="cc-acoes">${bt("conta-importar", o ? "Conferindo…" : "Tentar de novo", { classe: "pri", ocupado: o })}</div>`);
      }
      if (e.falhou) {
        return cartao("Não deu para levar", `${topo}<p class="cc-texto">Nada mudou: seu espaço continua neste computador, do jeito que estava.</p>
          <div class="cc-acoes">${bt("conta-cancelar", "Continuar sem conta", { classe: "cc-link", ocupado: o })}${bt("conta-importar", o ? "Levando…" : "Tentar de novo", { classe: "pri", ocupado: o })}</div>`);
      }
      return cartao(
        "Levar o que você fez para esta conta?",
        `${topo}<p class="cc-texto"><b>${esc(e.email)}</b> já tem um espaço. ${resumo ? `Neste computador você tem ${esc(resumo)}.` : "Este computador ainda não tem nada seu."} Levar junta os dois: nada se perde.</p>
        <div class="cc-acoes cc-coluna">${bt("conta-importar", o ? "Levando…" : "Levar para esta conta", { classe: "pri", ocupado: o })}${bt("conta-outra", "Usar outra conta", { ocupado: o })}${bt("conta-cancelar", "Agora não", { classe: "cc-link", ocupado: o })}</div>`,
      );
    }
    case "entrar":
      return cartao(
        "Entrar na sua conta",
        `<form data-form="conta-entrar" class="cc-form">${campoEmail()}${campoSenha("senha", "Senha", false)}${erroDe(e.erro)}
        <div class="cc-acoes">${bt("conta-ir", "Esqueci a senha", { classe: "cc-link", dados: { etapa: "recuperar" } })}${enviar("Entrar", o)}</div></form>
        <p class="cc-rodape">${bt("conta-ir", "Criar conta", { classe: "cc-link", dados: { etapa: "cadastro" } })}</p>`,
      );
    case "recuperar":
      return e.enviadoPara
        ? cartao("Confira seu e-mail", `<p class="cc-texto" role="status">Se existir uma conta com <b>${esc(e.enviadoPara)}</b>, mandamos um link para criar uma senha nova. Ele vale por 30 minutos e uma vez só.</p><div class="cc-acoes">${bt("conta-fechar", "Ok", { classe: "pri" })}</div>`)
        : cartao("Recuperar a senha", `<form data-form="conta-recuperar" class="cc-form">${campoEmail("E-mail da conta")}<div class="cc-acoes">${bt("conta-ir", "Voltar", { classe: "cc-link", dados: { etapa: "entrar" } })}${enviar("Mandar link", o, "Mandando…")}</div></form>`);
    case "senha":
      return e.salva !== null
        ? cartao("Senha nova salva", `<p class="cc-texto" role="status">${e.salva > 0 ? `Encerramos ${e.salva === 1 ? "a outra sessão" : `as outras ${e.salva} sessões`}; esta continua aberta.` : "Esta sessão continua aberta."}</p><div class="cc-acoes">${bt("conta-ir", "Ver sessões", { classe: "cc-link", dados: { etapa: "sessoes" } })}${bt("conta-fechar", "Ok", { classe: "pri" })}</div>`)
        : cartao(
          "Trocar a senha",
          `<form data-form="conta-senha" class="cc-form">${campoSenha("atual", "Senha atual", false)}${campoSenha("nova", "Senha nova", true)}${campoSenha("nova2", "Repita a senha nova", true)}<p class="cc-dica">Pelo menos 12 caracteres. As outras sessões saem; esta fica. Computadores conectados seguem até você removê-los em Computadores.</p>${erroDe(e.erro)}
          <div class="cc-acoes">${bt("conta-fechar", "Cancelar", { classe: "cc-link" })}${enviar("Salvar senha", o, "Salvando…")}</div></form>`,
        );
    case "sessoes": {
      if (!e.dados) return cartao("Sessões", `<p class="cc-texto">carregando…</p>`);
      const outras = e.dados.sessoes.filter((s) => s.id !== e.dados!.atual && s.revogadaEm === null).length;
      const lista = `<ul class="cc-sessoes">${e.dados.sessoes.filter((s) => s.revogadaEm === null).map((s) => linhaSessao(s, e.dados!.atual, v.agora)).join("")}</ul>`;
      if (outras === 0) return cartao("Sessões", `${lista}<p class="cc-texto">Só esta sessão está aberta.</p><div class="cc-acoes">${bt("conta-fechar", "Ok", { classe: "pri" })}</div>`);
      const n = outras === 1 ? "1 sessão" : `${outras} sessões`;
      return e.confirmar
        ? cartao("Sair das outras sessões?", `${lista}<p class="cc-texto">Quem estiver nelas precisa entrar de novo. Esta continua aberta. Computadores conectados saem em Computadores.</p><div class="cc-acoes">${bt("conta-sessoes-voltar", "Cancelar", { classe: "cc-link", ocupado: o })}${bt("conta-sair-outras", o ? "Saindo…" : `Sair de ${n}`, { classe: "danger", ocupado: o })}</div>`)
        : cartao("Sessões", `${lista}<div class="cc-acoes">${bt("conta-fechar", "Fechar", { classe: "cc-link" })}${bt("conta-sessoes-confirmar", "Sair das outras")}</div>`);
    }
    case "parear-gerar": {
      if (e.vencido) return cartao("O código venceu", `<p class="cc-texto">Ele vale por 5 minutos e uma vez só.</p><div class="cc-acoes">${bt("conta-fechar", "Fechar", { classe: "cc-link" })}${bt("conta-parear-gerar", "Gerar novo código", { classe: "pri", ocupado: o })}</div>`);
      if (e.pedido) {
        return cartao(
          "Conectar este computador?",
          `<p class="cc-texto"><b>${esc(e.pedido.aparelho)}</b> quer entrar na sua conta. Os símbolos abaixo são os mesmos que aparecem nele?</p>${simbolos(e.pedido.simbolos)}
          <div class="cc-acoes">${bt("conta-parear-decidir", "Não reconheço", { classe: "cc-link", ocupado: o, dados: { confirmar: "nao" } })}${bt("conta-parear-decidir", "Sim, conectar", { classe: "pri", ocupado: o, dados: { confirmar: "sim" } })}</div>`,
        );
      }
      const seg = Math.max(0, Math.round((e.expiraEm - v.agora) / 1000));
      return cartao(
        "Conectar outro computador",
        `<p class="cc-texto">No outro computador, abra o nod e toque em <b>Tenho um código</b>. Digite:</p><p class="cc-codigo-grande" aria-label="${esc(e.codigo.split("").join(" "))}">${esc(e.codigo.slice(0, 3))} ${esc(e.codigo.slice(3))}</p><p class="cc-dica">Vale por 5 minutos (${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, "0")}) e uma vez só. Gerar outro invalida este.</p>
        <div class="cc-acoes">${bt("conta-fechar", "Cancelar", { classe: "cc-link" })}</div>`,
      );
    }
    case "parear-entrar":
      return e.simbolos
        ? cartao("Confirme no outro computador", `<p class="cc-texto">Lá vai aparecer um pedido com estes símbolos. Confira e toque em <b>Sim, conectar</b>.</p>${simbolos(e.simbolos)}<p class="cc-dica" role="status">Esperando a confirmação…</p><div class="cc-acoes">${bt("conta-fechar", "Cancelar", { classe: "cc-link" })}</div>`)
        : cartao(
          "Entrar com código",
          `<form data-form="conta-parear-pedir" class="cc-form"><label class="cc-campo">Código do outro computador<input name="codigo" inputmode="numeric" autocomplete="off" pattern="[0-9 \\-]{6,8}" maxlength="8" required class="cc-codigo"></label>${erroDe(e.erro)}
          <div class="cc-acoes">${bt("conta-ir", "Voltar", { classe: "cc-link", dados: { etapa: "inicio" } })}${enviar("Entrar com código", o)}</div></form>`,
        );
    case "google-app":
      return cartao("Termine no navegador", `<p class="cc-texto">Abrimos o Google no seu navegador. Quando terminar lá, volte aqui.</p><div class="cc-acoes">${bt("conta-fechar", "Cancelar", { classe: "cc-link" })}${bt("conta-reler", "Já terminei", { classe: "pri", ocupado: o })}</div>`);
  }
}

/** O bloco ao vivo inteiro: as linhas do que já se resolveu e o cartão ativo. Vazio = nada a mostrar. */
export function htmlBlocoConta(v: VistaConta): string {
  if (!v.etapa && v.resolvidas.length === 0) return "";
  const linhas = v.resolvidas.map((l) => `<p class="cc-resolvida">${esc(l)}</p>`).join("");
  return `<section class="cc-bloco" aria-label="Conta no nod">${linhas}${v.etapa ? htmlEtapa(v.etapa, v) : ""}</section>`;
}

/** A mesma regra do servidor (problemaDaSenha): conta por ponto de código, um emoji é um caractere. */
export const SENHA_CURTA = "A senha precisa de pelo menos 12 caracteres.";
export const senhaCurta = (senha: string): boolean => [...senha].length < 12;

/** A frase de um erro da API para dentro do cartão (limite, entrada, rede). */
export function fraseDoErro(e: unknown): string {
  if (e instanceof AppDesatualizado) return "Atualize o app do nod para entrar numa conta por aqui.";
  if (e instanceof ErroApi) {
    if (e.status === 429) return "Muitas tentativas. Espere um pouco e tente de novo.";
    // A mensagem da API é fixa por código (TABELA_ERROS): a frase sai só do código. A senha curta é barrada antes, aqui.
    if (e.codigo === "entrada_invalida") return "Confira o que foi digitado.";
    if (e.codigo === "estado_invalido") return "Isso não vale mais. Comece de novo.";
    if (e.status === 0 || e.status >= 500) return "Não deu para falar com o nod agora. Tente de novo.";
  }
  return "Não deu certo. Tente de novo.";
}

export type DepsConta = {
  api: () => ApiConta;
  /** A conversa do bot Nod (onde abre o que começa pelo menu); null = sem ele, abre na conversa da tela. */
  conversaDoNod: () => { conversaId: string; agenteId: string } | null;
  conversaDaTela: () => string | null;
  irParaConversa: (conversaId: string, agenteId: string) => void;
  aoMudar: () => void;
  google: () => boolean;
  noApp: () => boolean;
  /** Entrou noutro espaço (conta, importação, redefinição, pareamento): o app troca a chave; a web recarrega. */
  entrou: (trocaApp: string | null) => Promise<void>;
  /** A conta mudou (criada, senha): o menu relê o estado. */
  contaMudou: (estado: EstadoContaDto | null) => void;
  abrirUrl: (url: string) => void;
  agora: () => number;
  /** Relógio dos polls (pareamento): os testes trocam por um falso. */
  intervalo?: (fn: () => void, ms: number) => () => void;
  /** Lê um campo do formulário (na página, FormData; nos testes, um falso). */
  campo: (form: Formulario, nome: string) => string;
};

const ETAPAS_DIRETAS = new Set(["inicio", "cadastro", "entrar", "recuperar", "senha", "sessoes", "parear-entrar"]);

/** O controlador: uma etapa ativa, as linhas resolvidas e a conversa onde o bloco mora. */
export function criarContaNoChat(deps: DepsConta) {
  let etapa: Etapa | null = null;
  let ocupado = false;
  let resolvidas: string[] = [];
  let conversaId: string | null = null;
  let pararPoll: (() => void) | null = null;
  const campo = deps.campo;
  const intervalo = deps.intervalo ?? ((fn, ms) => { const t = setInterval(fn, ms); return () => clearInterval(t); });

  const mudar = (e: Etapa | null) => { etapa = e; deps.aoMudar(); };
  const resolver = (linha: string) => { pollParar(); resolvidas = [...resolvidas, linha].slice(-6); mudar(null); };
  function pollParar() { pararPoll?.(); pararPoll = null; }
  function poll(fn: () => Promise<boolean>, ms = 2000) {
    pollParar();
    let rodando = false;
    pararPoll = intervalo(() => {
      if (rodando) return;
      rodando = true;
      void fn().then((parar) => { if (parar) pollParar(); }, () => undefined).finally(() => { rodando = false; });
    }, ms);
  }
  /** "Conferindo…": o botão fica desabilitado e um segundo clique (ou Enter) não manda de novo. */
  async function trabalhar(fn: () => Promise<void>): Promise<void> {
    if (ocupado) return;
    ocupado = true;
    deps.aoMudar();
    try { await fn(); } finally { ocupado = false; deps.aoMudar(); }
  }
  const comErro = async (fn: () => Promise<void>, aoErro: (frase: string) => void) => {
    try { await fn(); } catch (e) { aoErro(fraseDoErro(e)); }
  };

  async function etapaInicial(qual: string): Promise<Etapa> {
    switch (qual) {
      case "cadastro": return { tipo: "cadastro", erro: null };
      case "entrar": return { tipo: "entrar", erro: null };
      case "recuperar": return { tipo: "recuperar", enviadoPara: null };
      case "senha": return { tipo: "senha", erro: null, salva: null };
      case "parear-entrar": return { tipo: "parear-entrar", simbolos: null, erro: null };
      case "sessoes": {
        void deps.api().sessoes().then((dados) => { if (etapa?.tipo === "sessoes") mudar({ ...etapa, dados }); }, () => undefined);
        return { tipo: "sessoes", dados: null, confirmar: false };
      }
      default: return { tipo: "inicio" };
    }
  }

  /** Abre um cartão. `pelaInterface`: começou pelo menu, então vai para a conversa do Nod. */
  async function abrir(qual: string, pelaInterface = true): Promise<void> {
    pollParar();
    const nod = pelaInterface ? deps.conversaDoNod() : null;
    conversaId = nod?.conversaId ?? deps.conversaDaTela();
    if (nod) deps.irParaConversa(nod.conversaId, nod.agenteId);
    if (qual === "parear-gerar") return gerarPareamento();
    mudar(await etapaInicial(ETAPAS_DIRETAS.has(qual) ? qual : "inicio"));
  }

  /** Retoma o que ficou aberto no servidor (código pendente, escolha). Chamado no boot e na volta do Google. */
  async function retomar(): Promise<EstadoContaDto | null> {
    const e = await deps.api().estado().catch(() => null);
    deps.contaMudou(e);
    if (!e) return null;
    if (e.escolha) { conversaId ??= deps.conversaDoNod()?.conversaId ?? deps.conversaDaTela(); mudar({ tipo: "escolha", email: e.escolha.email, espaco: e.escolha.espaco, falhou: false, confirmado: false }); }
    else if (e.verificando && !etapa) { conversaId ??= deps.conversaDoNod()?.conversaId ?? deps.conversaDaTela(); mudar({ tipo: "codigo", email: e.verificando.email, restantes: null, vencido: false, reenviado: false }); }
    return e;
  }

  async function irParaEscolha(email: string, confirmado: boolean): Promise<void> {
    const e = await deps.api().estado().catch(() => null);
    mudar({ tipo: "escolha", email, espaco: e?.escolha?.espaco ?? null, falhou: false, confirmado });
  }

  async function gerarPareamento(): Promise<void> {
    await trabalhar(async () => {
      try {
        const { codigo, expiraEm } = await deps.api().gerarPareamento();
        mudar({ tipo: "parear-gerar", codigo, expiraEm, pedido: null, vencido: false });
        poll(async () => {
          if (etapa?.tipo !== "parear-gerar") return true;
          if (deps.agora() >= etapa.expiraEm && !etapa.pedido) { mudar({ ...etapa, vencido: true }); return true; }
          const { pareamento: p } = await deps.api().pareamento();
          if (etapa?.tipo !== "parear-gerar") return true;
          if (p?.estado === "pedido" && p.simbolos) { mudar({ ...etapa, pedido: { aparelho: p.aparelho ?? "Outro computador", simbolos: p.simbolos } }); return true; }
          if (!p || p.estado === "trocado") { mudar({ ...etapa, vencido: true }); return true; }
          deps.aoMudar(); // o relógio do código
          return false;
        });
      } catch (e) {
        resolver(fraseDoErro(e));
      }
    });
  }

  const acoes: Record<string, (el: ElAcao) => Promise<void> | void> = {
    "conta-abrir": (el) => abrir(el.dataset.etapa ?? "inicio", true),
    "conta-ir": (el) => { pollParar(); void etapaInicial(el.dataset.etapa ?? "inicio").then(mudar); },
    "conta-fechar": () => {
      pollParar();
      const e = etapa;
      // Fechar o código ou o cartão de início deixa o espaço como está; a linha só diz isso.
      resolver(e?.tipo === "inicio" ? "Seu espaço continua só neste computador. Dá para criar a conta depois, pelo menu." : e?.tipo === "recuperar" && e.enviadoPara ? "Link de recuperação pedido." : e?.tipo === "senha" && e.salva !== null ? "Senha nova salva." : "Fechado.");
    },
    "conta-google": () => trabalhar(async () => {
      try {
        const { url } = await deps.api().google(deps.noApp());
        if (deps.noApp()) mudar({ tipo: "google-app" });
        deps.abrirUrl(url);
      } catch (e) {
        resolver(fraseDoErro(e));
      }
    }),
    "conta-reler": () => trabalhar(async () => {
      const e = await retomar();
      if (etapa?.tipo !== "google-app") return;
      if (e?.conta) resolver(`Conta criada: ${e.conta.email}.`);
    }),
    "conta-reenviar": () => trabalhar(async () => {
      if (etapa?.tipo !== "codigo") return;
      const atual = etapa;
      await comErro(async () => { const r = await deps.api().reenviar(); mudar({ ...atual, vencido: false, restantes: null, reenviado: r.enviado, naoEnviado: !r.enviado, erro: null }); }, (erro) => mudar({ ...atual, reenviado: false, restantes: null, erro }));
    }),
    "conta-importar": () => trabalhar(async () => {
      if (etapa?.tipo !== "escolha") return;
      const atual = etapa;
      try {
        const r = await deps.api().importar();
        if (r.resultado === "falhou") return mudar({ ...atual, falhou: true, incerto: false });
        const resumo = resumoDoEspaco(r.contagem);
        resolver(`Levado para ${atual.email}${resumo ? `: ${resumo}` : ""}.`);
        await deps.entrou(r.trocaApp);
      } catch (e) {
        // Recusa do servidor (4xx) = a transação voltou, nada mudou. Sem resposta (rede) ou 5xx de fora = não se sabe.
        // 401/403 = sem sessão aqui (talvez porque a importação já foi): nem "nada mudou", nem "tente de novo".
        const status = e instanceof ErroApi ? e.status : 0;
        const semSessao = status === 401 || status === 403;
        const recusado = !semSessao && status >= 400 && status < 500;
        mudar({ ...atual, falhou: true, incerto: !recusado && !semSessao, semSessao });
      }
    }),
    "conta-ir-entrar": () => mudar({ tipo: "entrar", erro: null }),
    "conta-outra": () => trabalhar(async () => {
      await deps.api().outra().catch(() => undefined);
      mudar({ tipo: "cadastro", erro: null });
    }),
    "conta-cancelar": () => trabalhar(async () => {
      await deps.api().cancelar().catch(() => undefined);
      resolver("Seu espaço continua só neste computador.");
    }),
    "conta-sessoes-confirmar": () => { if (etapa?.tipo === "sessoes") mudar({ ...etapa, confirmar: true }); },
    "conta-sessoes-voltar": () => { if (etapa?.tipo === "sessoes") mudar({ ...etapa, confirmar: false }); },
    "conta-sair-outras": () => trabalhar(async () => {
      try {
        const { encerradas } = await deps.api().sairDasOutras();
        resolver(encerradas === 1 ? "1 sessão encerrada." : `${encerradas} sessões encerradas.`);
      } catch (e) {
        resolver(fraseDoErro(e));
      }
    }),
    "conta-parear-gerar": () => gerarPareamento(),
    "conta-parear-decidir": (el) => trabalhar(async () => {
      const confirmar = el.dataset.confirmar === "sim";
      try {
        const { estado } = await deps.api().decidirPareamento(confirmar);
        resolver(estado === "confirmado" ? "Computador conectado." : confirmar ? "O pedido não vale mais. Gere outro código." : "Pedido recusado. Ninguém entrou.");
      } catch (e) {
        resolver(fraseDoErro(e));
      }
    }),
  };

  const forms: Record<string, (form: Formulario) => Promise<void>> = {
    "conta-cadastro": (form) => trabalhar(async () => {
      const email = campo(form, "email").trim();
      if (senhaCurta(campo(form, "senha"))) return mudar({ tipo: "cadastro", erro: SENHA_CURTA });
      await comErro(async () => {
        const r = await deps.api().cadastrar(email, campo(form, "senha"));
        mudar({ tipo: "codigo", email: r.email, restantes: null, vencido: false, reenviado: false, naoEnviado: !r.enviado });
      }, (erro) => mudar({ tipo: "cadastro", erro }));
    }),
    "conta-codigo": (form) => trabalhar(async () => {
      if (etapa?.tipo !== "codigo") return;
      const atual = etapa;
      const codigo = campo(form, "codigo");
      await comErro(async () => {
        const r = await deps.api().verificar(codigo);
        if (r.resultado === "errado") {
          if (r.restantes <= 0) return mudar({ ...atual, vencido: true, restantes: null });
          return mudar({ ...atual, restantes: r.restantes, reenviado: false, erro: null });
        }
        if (r.resultado === "vencido") return mudar({ ...atual, vencido: true, restantes: null });
        // Pessoa de time (ADR-030): o e-mail está provado, mas ela entra só pelo Google.
        if (r.resultado === "pelo_google") return mudar({ tipo: "cadastro", erro: `${r.email} entra pelo Google. Volte e use Continuar com o Google.` });
        if (r.resultado === "convertida") {
          resolver(`Conta criada: ${r.email}. Seu espaço agora entra de qualquer lugar.`);
          deps.contaMudou(await deps.api().estado().catch(() => null));
          return;
        }
        await irParaEscolha(r.email, true);
      }, (erro) => mudar({ ...atual, restantes: null, reenviado: false, erro }));
    }),
    "conta-entrar": (form) => trabalhar(async () => {
      await comErro(async () => {
        const r = await deps.api().entrar(campo(form, "email").trim(), campo(form, "senha"));
        if (r.resultado === "recusado") return mudar({ tipo: "entrar", erro: "E-mail ou senha não conferem." });
        if (r.resultado === "escolher") return irParaEscolha(r.email, false);
        resolver("Você entrou na sua conta.");
        await deps.entrou(r.trocaApp);
      }, (erro) => mudar({ tipo: "entrar", erro }));
    }),
    "conta-recuperar": (form) => trabalhar(async () => {
      const email = campo(form, "email").trim();
      // Resposta neutra: o mesmo cartão exista a conta ou não (só o limite e o e-mail inválido mudam a frase).
      await comErro(async () => { await deps.api().recuperar(email); mudar({ tipo: "recuperar", enviadoPara: email }); }, (frase) => resolver(frase));
    }),
    "conta-senha": (form) => trabalhar(async () => {
      const nova = campo(form, "nova");
      if (nova !== campo(form, "nova2")) return mudar({ tipo: "senha", erro: "As duas senhas novas não são iguais.", salva: null });
      if (senhaCurta(nova)) return mudar({ tipo: "senha", erro: SENHA_CURTA, salva: null });
      await comErro(async () => {
        const r = await deps.api().trocarSenha(campo(form, "atual"), nova);
        mudar(r.resultado === "trocada" ? { tipo: "senha", erro: null, salva: r.encerradas } : { tipo: "senha", erro: "A senha atual não confere.", salva: null });
      }, (erro) => mudar({ tipo: "senha", erro, salva: null }));
    }),
    "conta-parear-pedir": (form) => trabalhar(async () => {
      const codigo = campo(form, "codigo");
      await comErro(async () => {
        const r = await deps.api().pedirPareamento(codigo);
        if (r.resultado === "invalido") return mudar({ tipo: "parear-entrar", simbolos: null, erro: "Esse código não vale. Gere outro no computador onde você já entrou." });
        mudar({ tipo: "parear-entrar", simbolos: r.simbolos, erro: null });
        poll(async () => {
          if (etapa?.tipo !== "parear-entrar") return true;
          const s = await deps.api().esperarPareamento();
          if (s.estado === "esperando") return false;
          if (s.estado === "entrou") { resolver("Computador conectado."); await deps.entrou(s.trocaApp); }
          // Este computador tinha trabalho no espaço provisório: a mesma escolha do "entrar" (levar ou não).
          else if (s.estado === "escolher") await irParaEscolha(s.email, false);
          else mudar({ tipo: "parear-entrar", simbolos: null, erro: s.estado === "recusado" ? "O pedido foi recusado no outro computador." : "O código venceu. Gere outro." });
          return true;
        });
      }, (erro) => mudar({ tipo: "parear-entrar", simbolos: null, erro }));
    }),
  };

  return {
    /** O bloco ao vivo desta conversa (vazio fora dela). */
    blocoNaConversa(id: string): string {
      // O estado pode chegar antes da frota (boot): o cartão pendente se liga à conversa do Nod quando ela existir.
      if ((etapa || resolvidas.length) && !conversaId) conversaId = deps.conversaDoNod()?.conversaId ?? deps.conversaDaTela();
      if (id !== conversaId) return "";
      return htmlBlocoConta({ etapa, ocupado, resolvidas, google: deps.google(), agora: deps.agora() });
    },
    abrir,
    retomar,
    /** A volta do Google (`?conta=`): o que o servidor fez vira a linha ou o cartão certo. */
    async aoVoltarDoGoogle(r: string): Promise<void> {
      conversaId ??= deps.conversaDoNod()?.conversaId ?? deps.conversaDaTela();
      const e = await retomar();
      if (r === "recusado") resolver("O Google não confirmou esse e-mail. Crie com e-mail e senha; nada mudou.");
      else if (r === "convertida" && e?.conta) resolver(`Conta criada: ${e.conta.email}.`);
      else if (r === "entrou") resolver("Você entrou na sua conta.");
    },
    /** Outra sessão: nada do cartão anterior fica. */
    descartar(): void { pollParar(); etapa = null; ocupado = false; resolvidas = []; conversaId = null; },
    acoes,
    forms,
    /** Para os testes. */
    etapa: () => etapa,
  };
}
