import type { EpochMs } from "./ids.ts";

/**
 * Frentes e lotes (definido em 2026-10-12, ADR-099, partes 3/4, migração 0071). A frente é um trabalho com
 * `forma = 'frente'`: roda por baixo do dono (a conversa do bot) e devolve um resumo curto em vez de aparecer como task.
 * `task` é a forma de hoje (ADR-083); até a Parte 5 as frentes também aparecem como tasks.
 */
export const FORMAS_TRABALHO = ["task", "frente"] as const;
export type FormaTrabalho = (typeof FORMAS_TRABALHO)[number];

/**
 * O que a frente devolve ao dono: fatos, não narrativa. `feito` é obrigatório; `pr` é o número do PR, `sha` o commit
 * (7 a 40 hexadecimais minúsculos), `branch` o branch da frente e `falta` o que ficou para depois. Validado em
 * src/domain/resumo-da-frente.ts; o CHECK trabalho_resumo da 0071 só guarda o teto de bytes.
 */
export type ResumoFrente = {
  feito: string;
  pr?: number;
  sha?: string;
  branch?: string;
  falta?: string;
};

/**
 * O que o `Trabalho` ganha com a 0071 (definido em 2026-10-12, ADR-099), fora de trabalho.ts para ele ficar abaixo das 200
 * linhas (gatilho do AGENTS.md). Só leitura e gravação por enquanto: nenhum caso de uso decide por eles.
 */
export type CamposDeFrente = {
  /** `task` (a de hoje) ou `frente`. Ausente = `task` (quem monta o trabalho fora do repositório; o banco sempre tem). */
  forma?: FormaTrabalho;
  /** O lote da frente; null = solta (toda task, e a frente fora de lote). */
  loteId?: string | null;
  /** O que a frente devolveu; null = ainda nada. */
  resumo?: ResumoFrente | null;
};

/** definido em 2026-10-12 (especificação das Partes 3/4): cada texto do resumo até 1000 caracteres. */
export const TETO_TEXTO_RESUMO = 1000;
/** CHECK trabalho_resumo da 0071: o JSON inteiro até 16000 bytes. */
export const TETO_BYTES_RESUMO = 16000;

/**
 * Um lote de frentes (0071): as frentes abertas juntas para o MESMO pedido. Um pedido nunca espera frentes de outro.
 * - `abertoPorTurnoId`: o turno do dono que abriu o lote; o retorno é uma retomada dele;
 * - `trabalhoId`: null = lote da conversa do dono; preenchido = o trabalho onde o retorno nasce;
 * - `avisarACadaUma`: o dono pediu o resultado de cada frente quando ela termina (frentes independentes e de duração
 *   muito diferente); false = todas voltam juntas, quando a última termina;
 * - `retornoTurnoId`: o turno de retorno (UNIQUE: um por lote); `devolvidoEm`: quando o lote foi devolvido (com ou sem
 *   turno de retorno);
 * - `titulo`: o `titulo_do_lote` que o modelo mandou (0092, plano chat limpo, PR 5); null = não mandou. A tela usa
 *   `tituloDoLote` (src/domain/frente.ts), que cai no título da frente ou em "N frentes".
 */
export type LoteDeFrentes = {
  id: string;
  agenteId: string;
  abertoPorTurnoId: string;
  trabalhoId: string | null;
  avisarACadaUma: boolean;
  titulo: string | null;
  retornoTurnoId: string | null;
  criadoEm: EpochMs;
  devolvidoEm: EpochMs | null;
};
