import type { ResumoFrente } from "../contracts/frente.ts";
import type { EstadoTrabalho } from "../contracts/trabalho.ts";
import type { ErroResumo } from "./resumo-da-frente.ts";

/**
 * Regras puras das frentes (definido em 2026-10-12, ADR-099, partes 3/4, issue I2): o que a frente recebe ao nascer, a
 * linha única do lote na conversa do dono, o catálogo dela e o resumo que o servidor monta quando ela termina sem
 * `devolver_resumo`. Quem lê o banco e grava é o caso de uso (src/use-cases/frentes.ts).
 */

/** A frente é um trabalho com `forma = 'frente'` (0071). Sem forma (montado fora do repositório) = task. */
export function ehFrente(t: { forma?: string | null } | null | undefined): boolean {
  return t?.forma === "frente";
}

/**
 * definido em 2026-10-12 (ADR-099 §5, decisão 10): a frente devolve o fato e termina; quem espera é o dono. Sem
 * `me_chame_as` nem `esperar_comando` (Parte 2) no catálogo dela — o nome que ainda não existir no catálogo não muda nada.
 */
export const FERRAMENTAS_FORA_DA_FRENTE: readonly string[] = ["me_chame_as", "esperar_comando"];

/** A ferramenta só da frente. */
export const FERRAMENTA_DA_FRENTE = "devolver_resumo" as const;

/** O começo da entrada da frente: quem a abriu e o que se espera dela. O pedido vem logo depois, na linha seguinte. */
export function molduraDaFrente(titulo: string, deRotina: boolean): string {
  return deRotina
    ? `[nod] Frente "${titulo}", aberta pela sua rotina. Faça o trabalho até o fim e devolva o que fez com devolver_resumo.\n`
    : `[nod] Frente "${titulo}", aberta por você (o dono) para um pedido da conversa com a pessoa. Ela acompanha pela tela da task; faça o trabalho até o fim e devolva o que fez com devolver_resumo.\n`;
}

/**
 * A entrada do primeiro turno da frente: a moldura, o pedido autocontido (a frente não vê a conversa) e, quando o dono
 * disse, o repositório e o branch de onde partir; por fim, a linha que diz se ela pode empurrar o próprio branch.
 */
export function entradaDaFrente(p: { titulo: string; pedido: string; deRotina: boolean; repo?: string; branchBase?: string; podeEmpurrar?: boolean }): string {
  const repo = p.repo?.trim();
  const base = p.branchBase?.trim();
  const onde = repo ? `\n\nRepositório: ${repo}. Parta de ${base || "origin/main"}.` : base ? `\n\nParta do branch ${base}.` : "";
  const empurrar = linhaDeEmpurrar(p.podeEmpurrar === true, onde !== "");
  return `${molduraDaFrente(p.titulo, p.deRotina)}${p.pedido.trim()}${onde ? `${onde}\n` : "\n\n"}${empurrar}`;
}

/**
 * definido em 2026-10-12 (ADR-099, I4; decisão 5): a frente só empurra o branch que ela criou, e só quando o dono pede
 * (`pode_empurrar` de abrir_frentes, padrão false). A linha vai sempre na entrada, para a frente nunca ter de adivinhar.
 */
export function linhaDeEmpurrar(podeEmpurrar: boolean, temRepositorio: boolean): string {
  if (podeEmpurrar) return "O dono autorizou empurrar o seu branch e abrir PR.";
  return temRepositorio ? "Não empurre: devolva o branch e o SHA." : "Se mexer num repositório, não empurre: devolva o branch e o SHA.";
}

/** O pedido da frente sem a linha de empurrar (o "Fazer aqui" o devolve ao dono, que não devolve resumo nem branch). */
export function semLinhaDeEmpurrar(texto: string): string {
  for (const pode of [true, false]) {
    for (const temRepositorio of [true, false]) {
      const linha = linhaDeEmpurrar(pode, temRepositorio);
      if (texto.endsWith(linha)) return texto.slice(0, -linha.length).trimEnd();
    }
  }
  return texto;
}

/** definido em 2026-10-12 (ADR-099, I4): o branch da frente sai do slug da pasta dela (`<bot>/<slug>`): único por frente. */
export function branchDaFrente(pastaDaFrente: string): string {
  return `frente/${pastaDaFrente.slice(pastaDaFrente.lastIndexOf("/") + 1)}`;
}

/**
 * definido em 2026-10-12 (ADR-099 §6, I4): o incidente de 11/10 — várias tasks do mesmo bot empurravam no branch do PR
 * #845 e cancelavam a CI umas das outras. A saída é de forma, não trava (o hook não muda): cada frente na própria
 * worktree e no próprio branch, a partir do `branch_base`; empurra só o dela e só com autorização; o dono integra.
 */
export function worktreeDaFrente(pastaDaFrente: string): string {
  return `Para mexer num repositório, trabalhe numa worktree dentro da pasta desta frente, num branch só seu, a partir do clone que ela já tem: git -C <clone> fetch origin && git -C <clone> worktree add ~/nod/${pastaDaFrente}/<repo> -b ${branchDaFrente(pastaDaFrente)} <branch_base> (o branch de onde a entrada mandou partir; sem ele, origin/main). Commite só nesse branch e nunca empurre um branch que você não criou — nem o do PR que o pedido citar: nele quem empurra é o dono, depois de integrar. Empurre o seu branch ou abra PR só se a entrada disser que o dono autorizou; com ou sem isso, devolva o branch e o SHA no devolver_resumo. Quando a frente acaba, o nod apaga a worktree que não tem alteração por commitar (o branch fica no clone); a worktree fora desta pasta e o git que troca de branch ou grava fora dela são negados, para não atropelar o trabalho dela e dos colegas.`;
}

/** definido em 2026-10-12 (ADR-099, I4): o lembrete na linha "Frente atual", com ou sem terminal. */
export const BRANCH_NA_FRENTE_ATUAL = "Num repositório, o seu trabalho fica no seu branch: devolva o branch e o SHA, e empurre só se a entrada disser que o dono autorizou.";

/**
 * definido em 2026-10-12 (ADR-099 §6, I4): quem abre frentes (o dono, ou a execução de rotina) integra. Os branches das
 * frentes estão no mesmo clone: integrar é um merge na própria worktree, sem push; e só quem integra empurra no branch
 * do PR. `pode_empurrar` é para a frente que entrega o próprio PR, nunca para duas no mesmo branch.
 */
export const DONO_INTEGRA = "Num repositório, dê a cada frente o repo e o branch_base de onde ela parte; cada uma trabalha no próprio branch (frente/…), no mesmo clone, e devolve o branch e o SHA. Ao receber os resultados, integre esses branches na sua worktree (git merge, sem push: estão no mesmo clone) e só você empurra no branch do PR. pode_empurrar: true só para a frente que deve empurrar o próprio branch e abrir o PR dela; nunca peça a duas frentes que empurrem no mesmo branch.";

/** "Começou a frente X" ou "Começou 3 frentes: A, B e C" (texto da mensagem `sistema`; a web desenha pelo payload). */
export function textoFrentesAbertas(titulos: readonly string[]): string {
  if (titulos.length === 1) return `Começou a frente ${titulos[0]}`;
  const lista = titulos.length === 2 ? `${titulos[0]} e ${titulos[1]}` : `${titulos.slice(0, -1).join(", ")} e ${titulos.at(-1)}`;
  return `Começou ${titulos.length} frentes: ${lista}`;
}

/** definido em 2026-10-12 (I2): da última fala da frente, o resumo sem chamada leva até isto (o teto do texto é 1000). */
export const CORTE_DA_ULTIMA_FALA = 600;

function cortar(texto: string): string {
  const limpo = texto.replace(/\s+/g, " ").trim();
  return limpo.length > CORTE_DA_ULTIMA_FALA ? `${limpo.slice(0, CORTE_DA_ULTIMA_FALA - 1).trimEnd()}…` : limpo;
}

/**
 * definido em 2026-10-12 (ADR-099, I2): a frente acabou sem chamar `devolver_resumo` — o servidor monta o resumo com a
 * última fala dela (cortada) e o estado, para o dono nunca receber um lote com buraco. Só para estado final.
 */
export function resumoSemChamada(p: { estado: EstadoTrabalho; ultimaFala: string | null }): ResumoFrente {
  const fala = p.ultimaFala && p.ultimaFala.trim() !== "" ? cortar(p.ultimaFala) : null;
  if (p.estado === "falhou") {
    return { feito: fala ? `A frente falhou antes de devolver o resumo. Última fala: ${fala}` : "A frente falhou antes de devolver o resumo.", falta: "Conferir o que ficou pela metade e decidir se abre de novo." };
  }
  if (p.estado === "parado") return { feito: fala ? `A pessoa parou a frente antes do fim. Última fala: ${fala}` : "A pessoa parou a frente antes do fim." };
  return { feito: fala ?? "A frente terminou sem dizer o que fez." };
}

/** O que o bot lê quando o resumo volta recusado: o campo e o jeito de corrigir, nunca um corte silencioso. */
export function instrucaoDoResumoInvalido(erro: ErroResumo, campo?: string): string {
  const qual = campo ? ` (${campo})` : "";
  const como: Record<ErroResumo, string> = {
    nao_e_objeto: "mande os campos feito, pr, sha, branch e falta",
    campo_desconhecido: "use só feito, pr, sha, branch e falta",
    feito_vazio: "diga em feito o que você fez",
    texto_invalido: "os textos são strings",
    texto_longo: "cada texto tem até 1000 caracteres; escreva mais curto",
    pr_invalido: "pr é o número do PR, inteiro positivo",
    sha_invalido: "sha é o commit, de 7 a 40 caracteres hexadecimais minúsculos",
    resumo_grande: "o resumo passou do tamanho; escreva mais curto",
  };
  return `O resumo não foi guardado${qual}: ${como[erro]}. Chame devolver_resumo de novo.`;
}
