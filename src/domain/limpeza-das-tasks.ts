import type { EstadoTrabalho } from "../contracts/trabalho.ts";
import type { PastaParaLimpar } from "../contracts/ponte.ts";
import { RETOMAR_ATE_MS } from "./pedido-parado.ts";
import { pastaRelativa } from "./trabalho.ts";

/**
 * A limpeza das pastas de task (definido em 2026-10-09, ADR-088, issue #216). Medido no Mac do Marlon em 09/10: `~/nod`
 * com 254 GB (109 GB em 06/10), 261 worktrees, nenhuma removida pelo nod. Aqui só a regra de QUEM pode ser limpo; quem
 * lê o banco é o caso de uso (src/use-cases/limpeza-das-tasks.ts) e quem apaga é o Mac
 * (src/adapters/executor/limpeza-das-tasks.ts), sempre com `git worktree remove` sem --force.
 */

/** definido em 2026-10-09 (proposta da #216): a task encerrada há mais disto tem as worktrees limpas removidas. */
export const LIMPAR_APOS_MS = 3 * 24 * 3_600_000;

/**
 * definido em 2026-10-09: antes disto a task encerrada ainda pode voltar sozinha (a retomada automática do pedido a
 * colega, ADR-084, só vale para quedas das últimas 2 h). Nem a worktree de PR mergeado sai nesse intervalo.
 */
export const RETOMADA_POSSIVEL_MS = RETOMAR_ATE_MS;

/**
 * definido em 2026-10-09: o servidor só oferece as tasks encerradas nos últimos 30 dias. O Mac confere cada pasta
 * (um `lstat`); sem a janela, a lista cresceria para sempre com pastas já limpas. O que sobrar de mais antigo é órfão
 * (aparece na contagem `orfas` quando fica na raiz do bot) e espera a tela de Este Mac.
 */
export const JANELA_DA_LIMPEZA_MS = 30 * 24 * 3_600_000;

/** definido em 2026-10-09: worktree órfã sem mexer há isto conta como "parada" no relato (o número da #216). */
export const ORFA_PARADA_MS = 2 * 24 * 3_600_000;

/** O que o banco diz de uma task encerrada candidata (trabalhosRepo.candidatosALimpeza). */
export type FatosLimpeza = {
  estado: EstadoTrabalho;
  terminadoEm: number | null;
  pasta: string | null;
  /** Turnos pendentes (inclusive a volta marcada, `acordar_em`) ou rodando. */
  turnosVivos: number;
  decisaoPendente: boolean;
  /** Outra task que não acabou usa a mesma pasta (pasta decidida por quem chamou, fora do slug com id). */
  pastaDividida: boolean;
};

/**
 * `<bot>/<slug>` validado, ou null: exatamente dois nomes, nenhum vazio, `.`/`..`, escondido ou com barra invertida.
 * A raiz do bot (`~/nod/<bot>`) nunca é pasta de task: lá moram as worktrees antigas de dono desconhecido.
 */
export function pastaDeTask(pasta: string | null): string | null {
  if (pasta === null) return null;
  const rel = pastaRelativa(pasta);
  if (rel === null) return null;
  const partes = rel.split("/");
  if (partes.length !== 2) return null;
  if (partes.some((p) => p.trim() === "" || p.startsWith(".") || p.includes("\\") || p.includes("\0"))) return null;
  return rel;
}

/**
 * Quando a pasta da task pode ser limpa (ADR-088):
 * - nunca a task aberta, `parado` (a pessoa parou e pode querer continuar), com turno vivo ou volta marcada, ou com
 *   decisão pendente (o "Retomar" é uma decisão);
 * - nunca nas primeiras 2 h depois de encerrar (a retomada automática da ADR-084);
 * - `encerrada`: terminada ou falha há mais de 3 dias;
 * - `so_com_pr_mergeado`: encerrada há menos; o Mac só remove a worktree cujo PR já foi mergeado.
 */
export function quandoLimpar(f: FatosLimpeza, agora: number): PastaParaLimpar["quando"] | null {
  if (f.estado !== "terminado" && f.estado !== "falhou") return null;
  if (f.terminadoEm === null || f.turnosVivos > 0 || f.decisaoPendente || f.pastaDividida) return null;
  if (pastaDeTask(f.pasta) === null) return null;
  const ha = agora - f.terminadoEm;
  if (ha >= LIMPAR_APOS_MS) return "encerrada";
  if (ha >= RETOMADA_POSSIVEL_MS) return "so_com_pr_mergeado";
  return null;
}

/**
 * Normaliza um caminho absoluto para comparar (sem `.`, `..` e barras repetidas); o relativo volta null. revisto em
 * 2026-10-09 (revisão do #225): NFC e sem caixa — o APFS do Mac não diferencia maiúsculas e guarda nomes em NFD, e a
 * origem que o Docker relata pode vir com outra caixa ou outra forma do mesmo acento. Comparar texto puro deixava a
 * montagem passar despercebida. Quem chama resolve os links (realpath) dos dois lados antes.
 */
function normalizar(caminho: string): string | null {
  caminho = caminho.normalize("NFC").toLowerCase();
  if (!caminho.startsWith("/")) return null;
  const partes: string[] = [];
  for (const s of caminho.split("/")) {
    if (s === "" || s === ".") continue;
    if (s === "..") partes.pop();
    else partes.push(s);
  }
  return `/${partes.join("/")}`;
}

/**
 * definido em 2026-10-09 (#216): `~/nod/Eng 1/nod-169/infra/postgres/init` é bind mount do `nod-postgres` do diário. O
 * caminho é protegido quando alguma montagem de container (rodando ou parado) está DENTRO dele ou é ele: apagar a
 * worktree apagaria a origem da montagem. Montagem que contém o caminho (um container que monta `~/nod` inteiro) não
 * protege: ela não depende desta pasta.
 */
export function protegidoPorMontagem(caminho: string, montagens: readonly string[]): boolean {
  const alvo = normalizar(caminho);
  if (alvo === null) return true;
  return montagens.some((m) => {
    const fonte = normalizar(m);
    return fonte !== null && (fonte === alvo || fonte.startsWith(`${alvo}/`));
  });
}

/**
 * definido em 2026-10-09 (revisão do #225): o que o `git worktree remove` apagaria junto sem perguntar (arquivo IGNORADO)
 * e que se refaz sozinho — dependência, build, cache, log. Qualquer outro ignorado (`.env`, `backups/*.dump`, um banco
 * local) segura a worktree com o motivo `ignorado_valioso`: o git não protege o que está no .gitignore, e é melhor
 * recusar demais do que apagar algo que não volta.
 */
const PASTAS_REGENERAVEIS = new Set(["node_modules", "dist", "build", "out", "output", "coverage", ".vite", ".next", ".turbo", ".cache", ".parcel-cache", ".pnpm-store", "__pycache__", ".pytest_cache"]);
const ARQUIVOS_REGENERAVEIS = new Set([".DS_Store", "tsconfig.tsbuildinfo"]);

/** O caminho ignorado (relativo à worktree, como o `git status --ignored` mostra) se refaz sozinho? */
export function ignoradoRegeneravel(caminho: string): boolean {
  const partes = caminho.replace(/\/+$/, "").split("/").filter((p) => p !== "");
  if (partes.length === 0) return false;
  if (partes.some((p) => PASTAS_REGENERAVEIS.has(p))) return true;
  const nome = partes[partes.length - 1]!;
  return ARQUIVOS_REGENERAVEIS.has(nome) || nome.endsWith(".log");
}

/** Os nomes de arquivo de compose que, sem a lista de montagens do Docker, seguram a worktree (fail-closed). */
export function ehArquivoDeCompose(nome: string): boolean {
  return /^(docker-)?compose(\.[\w.-]+)?\.ya?ml$/.test(nome);
}

/** Por que o `git worktree remove` (sem --force) recusou, pela saída de erro dele. */
export function motivoDaRecusa(stderr: string): "suja" | "travada" | "erro" {
  if (/contains modified or untracked files|is dirty|has modified or untracked|use --force to delete it/i.test(stderr) && !/locked/i.test(stderr)) return "suja";
  if (/locked/i.test(stderr)) return "travada";
  return "erro";
}
