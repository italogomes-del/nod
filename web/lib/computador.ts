import type { ComputadorDto, RegistroComputador } from "../../src/contracts/computador.ts";
import type { MotivoFalhaComputador } from "../../src/contracts/motivos.ts";

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
