import type { ComputadorDto, RegistroComputador } from "../../src/contracts/computador.ts";
import type { MotivoFalhaComputador } from "../../src/contracts/motivos.ts";
import { botao, esc } from "./render.ts";

/**
 * Cópia de PREFIXO/SUFIXO de src/domain/computador.ts (a web não executa src/). O teste unitário
 * compara com `textoPedidoDeTela`: se a frase do servidor mudar e a cópia não, o cartão some.
 */
const PREFIXO_PEDIDO_DE_TELA = "Abra meu computador para concluir este passo: ";
const SUFIXO_PEDIDO_DE_TELA = ". Use Assumir controle; depois, Devolver ao bot. Não envie senha ou código aqui.";

/** O motivo humano do pedido de tela, ou null se a frase não é um `computador_pedir_ajuda`. */
export function motivoDoPedidoDeTela(frase: string): string | null {
  if (!frase.startsWith(PREFIXO_PEDIDO_DE_TELA) || !frase.endsWith(SUFIXO_PEDIDO_DE_TELA)) return null;
  return frase.slice(PREFIXO_PEDIDO_DE_TELA.length, frase.length - SUFIXO_PEDIDO_DE_TELA.length);
}

/**
 * definido em 2026-10-16: a pessoa vê a tela. Ligar, desligar, terminal, arquivos, política e a
 * atividade ficam na classe `computador-dev-only` e só aparecem com o Modo dev (`.computador-dev`).
 * Mora aqui, sem DOM, para o teste do servidor não puxar o diálogo.
 */
export function htmlDialogoComputador(nome: string): string {
  return `<header class="computador-header"><div><span class="computador-kicker computador-dev-only">COMPUTADOR DO BOT</span><h2>${esc(nome)}</h2><p class="computador-sub computador-dev-only">Privado de ${esc(nome)} · separado do seu Mac e dos outros bots</p></div><span class="computador-dev-selo computador-dev-only">Modo dev</span><span class="computador-status" role="status">Conectando…</span><button type="button" class="computador-acao computador-uso" data-c="assumir" hidden>Assumir controle</button><button type="button" class="computador-acao computador-uso" data-c="devolver" hidden>Devolver ao bot</button><button type="button" class="computador-fechar" data-c="fechar" aria-label="Fechar computador">✕</button></header>
    <div class="computador-toolbar computador-dev-only"><button data-c="iniciar">Ligar computador</button><button data-c="assumir">Assumir controle</button><button data-c="devolver">Devolver ao bot</button><button data-c="parar">Desligar</button><button data-c="atualizar">Atualizar tela</button><label>Bot pode agir<select aria-label="Permissão do bot"><option value="supervisionado">Com aprovação por ação</option><option value="autonomo">Nas tarefas que eu pedir</option></select></label></div>
    <p class="computador-ajuda computador-dev-only" role="status">Seu navegador, logins e arquivos ficam neste computador.</p><p class="computador-erro" role="alert"></p>
    <div class="computador-layout"><section class="computador-desktop"><form class="computador-url computador-dev-only"><label class="sr-only" for="computador-url">Endereço do navegador</label><input id="computador-url" name="url" placeholder="https://…" autocomplete="off" /><button>Abrir</button></form>
      <div class="computador-abas computador-dev-only"></div><div class="computador-viewport"><div class="computador-vazio">Abrindo a tela de ${esc(nome)}.<small>O desktop está ligando.</small></div><div class="computador-fora" role="status" hidden></div><img hidden alt="Tela do computador do bot" tabindex="0" draggable="false" /><button type="button" class="computador-velo computador-uso" data-c="assumir" hidden>Assumir controle</button><div class="computador-browser-dialog" hidden><p></p><input aria-label="Resposta ao diálogo do navegador" /><button data-c="aceitar-dialogo">Confirmar</button><button data-c="recusar-dialogo">Cancelar</button></div></div>
      <div class="computador-input computador-dev-only"><form class="computador-texto"><input type="password" autocomplete="off" aria-label="Texto para digitar no computador" placeholder="Cole texto ou senha aqui para digitar na tela" /><button>Digitar</button></form><button data-c="enter">Enter</button><button data-c="tab">Tab</button><button data-c="esc">Esc</button><button data-c="audio">Ouvir 5 s</button></div><audio controls hidden></audio><p class="computador-dica computador-dev-only">Assuma o controle para clicar e digitar. Clique na tela para usar o teclado. Senhas são enviadas diretamente ao computador.</p>
    </section><aside class="computador-lateral computador-dev-only"><details open><summary>Arquivos</summary><p>Arquivos e downloads em /workspace</p><form class="computador-pasta"><input aria-label="Pasta" value="." /><button>Ver</button></form><label class="computador-upload">Enviar arquivo<input type="file" /></label><div class="computador-arquivos"></div></details>
      <details><summary>Terminal</summary><form class="computador-terminal"><textarea aria-label="Comando no computador" placeholder="python3 --version" rows="3"></textarea><button>Executar</button></form><pre class="computador-saida"></pre></details>
      <details open><summary>Atividade recente</summary><ol class="computador-atividade"></ol></details></aside></div>`;
}

/** O cartão da conversa: o bot entregou a tela e a pessoa entra sem mandar senha no chat. */
export function htmlCartaoTela(motivo: string, agenteId: string, aberta: boolean): string {
  const acao = aberta && agenteId
    ? `<div class="mcf-acoes">${botao("abrir-computador", "Abrir computador", { classe: "pri sm", id: agenteId, dados: { assumir: "1" } })}</div>`
    : `<p class="mudo sm">A tela voltou para o bot.</p>`;
  return `<div class="msg-computador" role="status"><div class="mc-cab"><b>Computador</b><span class="tag ${aberta ? "tag-ok" : "tag-cinza"}">${aberta ? "precisa de você" : "devolvida"}</span></div><p>${esc(motivo)}</p>${acao}</div>`;
}

/**
 * definido em 2026-09-24 (emenda da ADR-037): a falha do computador do bot em palavras. Mesmos textos
 * de src/domain/computador.ts (MOTIVO_FALHA_EM_PORTUGUES) — o teste unitário compara as duas tabelas.
 */
export const MOTIVO_FALHA_TEXTO: Readonly<Record<MotivoFalhaComputador, string>> = {
  docker_indisponivel: "o Docker do servidor não está respondendo",
  imagem_ausente: "a imagem do computador não foi preparada no servidor",
  nao_iniciou: "o computador não conseguiu ligar",
  cofre_invalido: "o cofre de logins do computador não abriu",
  navegador_nao_abriu: "o navegador do computador não abriu",
  sem_resposta: "o computador parou de responder",
  acao_falhou: "a ação falhou dentro do computador",
  tela_alterada: "a tela mudou desde a última observação",
  ocupado: "outra ação estava em andamento",
  limite_de_computadores: "este Mac já tem o máximo de computadores ligados",
};

/**
 * definido em 2026-10-05 (NOD-170): o cartão do teto de computadores ligados. Mesmo texto de textoDoLimite
 * (src/domain/computador.ts), sem a parte que fala com o bot — o teste unitário compara as duas.
 */
export function textoDoLimite(l: { maximo: number; ociosoMin: number }): string {
  const ocioso = l.ociosoMin > 0 ? ` Os computadores sem uso há ${l.ociosoMin} min desligam sozinhos.` : "";
  return `Este Mac já tem ${l.maximo} computadores ligados, o limite. Nada foi executado.${ocioso}`;
}

/** O cartão do limite enquanto o computador segue desligado e a última tentativa bateu no teto do host. */
export function mensagemDoLimite(d: Pick<ComputadorDto, "ativo" | "atividade" | "limite">): string | null {
  const ultima = d.atividade[0];
  if (d.ativo || ultima?.estado !== "falhou" || ultima.motivo !== "limite_de_computadores") return null;
  return d.limite ? textoDoLimite(d.limite) : "Este Mac já tem o máximo de computadores ligados. Nada foi executado.";
}

/** "O navegador do computador não abriu" — o título do cartão de fora do ar. */
export function tituloDaFalha(motivo: MotivoFalhaComputador): string {
  const texto = MOTIVO_FALHA_TEXTO[motivo];
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** O que cada registro de atividade foi, em palavras (o tipo cru "ler_texto" não dizia nada). */
const ROTULO_ATIVIDADE: Readonly<Record<string, string>> = {
  observar: "Observar a tela",
  navegar: "Abrir endereço",
  clicar: "Clicar",
  arrastar: "Arrastar",
  digitar: "Digitar",
  tecla: "Pressionar tecla",
  rolar: "Rolar a tela",
  abas: "Trocar de aba",
  dialogo: "Responder diálogo",
  audio: "Ouvir o áudio",
  arquivos: "Ver arquivos",
  ler_arquivo: "Baixar arquivo",
  ler_texto: "Ler texto",
  gravar_texto: "Salvar texto",
  gravar_arquivo: "Salvar arquivo",
  anexar: "Anexar arquivo",
  terminal: "Terminal",
  pedir_ajuda: "Pedir sua ajuda",
  iniciar: "Ligar",
  parar: "Desligar",
  assumir: "Assumir controle",
  devolver: "Devolver ao bot",
  supervisionado: "Pedir aprovação por ação",
  autonomo: "Agir nas tarefas pedidas",
};

const ROTULO_ESTADO: Readonly<Record<RegistroComputador["estado"], string>> = {
  pendente: "aguardando aprovação",
  executando: "em andamento",
  concluida: "concluída",
  falhou: "falhou",
  recusada: "recusada",
};

export function rotuloDaAtividade(tipo: string): string {
  return ROTULO_ATIVIDADE[tipo] ?? tipo.replaceAll("_", " ");
}

export function rotuloDoEstado(estado: RegistroComputador["estado"]): string {
  return ROTULO_ESTADO[estado] ?? estado;
}

/** Uma linha da atividade: registros SEGUIDOS iguais viram um só, com ×N e o intervalo. */
export type LinhaAtividade = { autor: RegistroComputador["autor"]; tipo: string; estado: RegistroComputador["estado"]; motivo: MotivoFalhaComputador | null; n: number; de: number; ate: number };

/**
 * "Observar a tela · falhou ×7" em vez de sete linhas iguais (a Nina tinha a lista cheia da mesma
 * falha). Agrupa só os VIZINHOS com o mesmo autor, tipo, estado e motivo — a ordem conta a história.
 * A lista chega do mais novo para o mais antigo; `de` é o mais antigo do grupo, `ate` o mais novo.
 */
export function agruparAtividade(atividade: readonly RegistroComputador[]): LinhaAtividade[] {
  const linhas: LinhaAtividade[] = [];
  for (const a of atividade) {
    const ultima = linhas.at(-1);
    if (ultima && ultima.autor === a.autor && ultima.tipo === a.tipo && ultima.estado === a.estado && ultima.motivo === a.motivo) {
      ultima.n += 1;
      ultima.de = Math.min(ultima.de, a.em);
      ultima.ate = Math.max(ultima.ate, a.em);
      continue;
    }
    linhas.push({ autor: a.autor, tipo: a.tipo, estado: a.estado, motivo: a.motivo, n: 1, de: a.em, ate: a.em });
  }
  return linhas;
}

/** Fora do ar: a saúde do servidor manda, esteja o container de pé ou não. */
export function foraDoAr(dto: Pick<ComputadorDto, "computador">): boolean {
  return dto.computador.indisponivelDesde !== null;
}

/** O estado do computador em palavras, para o selo do cabeçalho do diálogo. */
export function estadoEmPalavras(dto: ComputadorDto, agora: number, configuracao: string | null): string {
  const c = dto.computador;
  if (configuracao === "iniciar") return foraDoAr(dto) ? "Tentando de novo…" : "Ligando computador…";
  if (configuracao === "parar") return "Desligando…";
  if (foraDoAr(dto)) return "Fora do ar";
  if (!dto.disponivel) return "Ambiente indisponível";
  if (!dto.ativo) return "Desligado";
  if (c.controle === "pessoa") return "Você está no controle";
  if (c.controle === "aguardando_pessoa") return "Precisa de você";
  return c.ocupadoAte && c.ocupadoAte > agora ? "Bot trabalhando" : "Pronto para o bot";
}
