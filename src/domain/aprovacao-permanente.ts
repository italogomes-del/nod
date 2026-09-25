import type { DestinoItem } from "../contracts/item-aprovacao.ts";
import type { MotivoAprovacaoManual } from "../contracts/motivos.ts";
import type { FerramentaPlano, PlanoTurno } from "../contracts/plano-turno.ts";

/**
 * DUAS regras nomeadas, não uma (ADR-042 claim 5): os ciclos de vida são opostos.
 * `consulta_sem_decisao` tem autoridade do CONECTOR, vale desde o dia um e não se revoga;
 * `aprovacao_permanente` tem autoridade da PESSOA, nasce de clique e ela revoga quando quiser.
 * Fundi-las seria o `if` anônimo que o ADR-026 proíbe ("regra nomeada no servidor, não constante").
 * Underscore, nunca hífen: o CHECK trilha_sem_texto_livre exige ^[a-z0-9_:]+$ (0001_fundacao.sql:96).
 */
export const REGRA_CONSULTA_SEM_DECISAO = "regra:consulta_sem_decisao" as const;
export const VERSAO_CONSULTA_SEM_DECISAO = 1 as const;
export const REGRA_APROVACAO_PERMANENTE = "regra:aprovacao_permanente" as const;
/**
 * v2 em 2026-09-21: a classificação por origem foi desligada (CLASSIFICAR_ORIGEM_SENSIVEL em
 * pedir-aprovacao.ts), então o CONJUNTO de itens que esta regra deixa passar AUMENTOU — item que
 * antes seria marcado sensível agora é elegível. Subir a versão é o que a própria regra manda
 * quando isso acontece, e é o que permite ler uma linha antiga sabendo sob qual semântica a
 * pessoa consentiu.
 */
export const VERSAO_APROVACAO_PERMANENTE = 2 as const;

/**
 * `regra_versao` sobe quando muda o CONJUNTO DE ITENS que a regra deixa passar para uma mesma
 * linha armazenada — por exemplo, se a regra passar a exigir concessão com N dias, ou se o escopo
 * por destino entrar (uma regra v1 passaria a significar outra coisa). NÃO sobe por redação, por
 * mudança de superfície nem por desempenho. A versão vai gravada na linha, nunca lida deste módulo
 * na hora de renderizar: a trilha de seis meses atrás tem que dizer sob qual semântica decidiu.
 */
export type RegraAprovacao = typeof REGRA_CONSULTA_SEM_DECISAO | typeof REGRA_APROVACAO_PERMANENTE;

/**
 * Ações que NUNCA viram "Sempre permitir" (definido em 2026-09-24, ADR-046): aprovar e fazer merge
 * mudam o estado de um trabalho de OUTRAS pessoas e não se desfazem com um comentário. Com a delegação,
 * um texto injetado num PR pode induzir o agente a pedir a ação; comentar sem pergunta é o risco aceito,
 * aprovar e fazer merge não — esses sempre pedem clique. Casa pelo nome da CAPACIDADE (a parte depois
 * de `slug__`), porque a regra é gravada por capacidade (ADR-042) e o jeito de conectar não muda o nome
 * (ADR-047). Lista curta e explícita, não classificação: o que não está aqui segue a regra da pessoa.
 */
export const NUNCA_PERMANENTE: readonly RegExp[] = [
  /merge/i, // pr_merge, GITHUB_MERGE_A_PULL_REQUEST, qualquer merge
  /approv|aprovar/i, // aprovar em qualquer conector
  // Revisão de PR pode APROVAR: pr_revisar (nativo), GITHUB_CREATE_/SUBMIT_A_REVIEW…, UPDATE/DISMISS_A_REVIEW…
  /review|revisar/i,
];

/**
 * Verbo de LEITURA no começo da capacidade — `list_reviews`, `GITHUB_LIST_REVIEWS…`,
 * `GITHUB_CHECK_IF_A_PULL_REQUEST_HAS_BEEN_MERGED`: consultar não aprova nada e continua livre. Olha o
 * 1º e o 2º pedaço porque o Composio prefixa o app (`GITHUB_`).
 */
const VERBO_DE_LEITURA = new Set(["list", "get", "check", "fetch", "search", "find", "read", "ver", "ler", "listar", "consultar", "buscar"]);

/**
 * `nome` = `${slug}__${capacidade}` (catálogo do plano) ou só a capacidade (item de aprovação).
 * definido em 2026-09-24 (revisão da ADR-046): casa pelo NOME, para valer igual no GitHub nativo e no
 * mapeado pelo Composio (ADR-047), e nunca pega ferramenta de leitura — por `readOnlyHint` quando o
 * catálogo diz, e pelo verbo quando quem chama só tem o nome.
 */
export function nuncaPermanente(nome: string, readOnlyHint = false): boolean {
  if (readOnlyHint) return false;
  const i = nome.indexOf("__");
  const capacidade = i >= 0 ? nome.slice(i + 2) : nome;
  const pedacos = capacidade.toLowerCase().split("_");
  if (pedacos.slice(0, 2).some((p) => VERBO_DE_LEITURA.has(p))) return false;
  return NUNCA_PERMANENTE.some((r) => r.test(capacidade));
}

export type DecisaoAutomatica =
  | { automatico: true; regra: RegraAprovacao; versao: number }
  | { automatico: false; motivo: MotivoAprovacaoManual };

export type EntradaAprovacao = {
  /** Ausente = nunca automático. O caminho do computador não carrega plano (ADR-042 claim 1). */
  plano: Pick<PlanoTurno, "catalogo" | "politicaExecucao" | "confiancaEntrada" | "semprePermitir"> | null;
  destino: DestinoItem;
  /** Já calculado pelo caso de uso a partir da DECLARAÇÃO do conector de origem (ADR-002). */
  origemSensivel: boolean;
};

/**
 * Precedência FECHADA, avaliada sobre o plano JÁ PUXADO (ADR-013: nunca consulta por chamada).
 * A ordem é deliberada: tudo que NEGA vem antes de tudo que PERMITE, e nenhuma negativa é
 * contornável por regra da pessoa — ADR-038 ("preferência persistida não vence instrução atual"; e
 * conteúdo não confiável nunca toca a precedência).
 *
 *  1. sem plano                  → perguntar (fail-closed)
 *  2. origem sensível            → perguntar ANTES do banco: o CHECK item_sensivel_marcado_exige_pessoa
 *                                  recusaria o INSERT, e um erro de constraint vira 500 em vez de
 *                                  "isto precisa de você" (ADR-029: negação é estado renderizado)
 *  3. gate de rotina ligado      → perguntar (ADR-037: rotina que exige aprovação continua exigindo;
 *                                  rotina roda sem ninguém olhando, que é quando a aprovação mais vale)
 *  4. entrada não confiável      → perguntar (ADR-042 claim 6; `semprePermitir` já chega vazia, e esta
 *                                  linha torna a intenção explícita e testável em vez de emergente)
 *  5. fora do catálogo do plano  → perguntar (readOnlyHint NUNCA se infere de nome de ferramenta)
 *  6. readOnlyHint do CONECTOR   → AUTOMÁTICO por `consulta_sem_decisao`
 *  7. ação que nunca é permanente → perguntar (ADR-046: aprovar PR, merge)
 *  8. ferramenta em semprePermitir → AUTOMÁTICO por `aprovacao_permanente`
 *  9. senão                      → perguntar
 *
 * O passo 5 exigir `origem === "conector"` é o que mantém a feature honesta: só
 * `ferramentasDeConectores` (plano-turno.ts) lê `readOnlyHint` da SONDA. Ferramenta nod tem o campo
 * fixo em `false`, e computador/workspace vêm de lista escrita no código — nenhuma delas entra por
 * esta porta, mesmo que pareça inofensiva.
 */
export function decidirAprovacao(entrada: EntradaAprovacao): DecisaoAutomatica {
  const { plano } = entrada;
  if (!plano) return { automatico: false, motivo: "sem_plano" };
  if (entrada.origemSensivel) return { automatico: false, motivo: "origem_sensivel" };
  if (plano.politicaExecucao.efeitoExternoSoPorAprovacao) return { automatico: false, motivo: "gate_de_rotina" };
  if (entrada.destino.conector === "computador") return { automatico: false, motivo: "destino_computador" };

  const nome = `${entrada.destino.conector}__${entrada.destino.ferramenta}`;
  const ferramenta: FerramentaPlano | undefined = plano.catalogo.ferramentas.find((f) => f.nome === nome);
  if (!ferramenta || ferramenta.origem !== "conector") return { automatico: false, motivo: "fora_do_catalogo" };

  if (ferramenta.readOnlyHint) return { automatico: true, regra: REGRA_CONSULTA_SEM_DECISAO, versao: VERSAO_CONSULTA_SEM_DECISAO };

  // A regra da PESSOA cai inteira em turno contaminado; a do CONECTOR (acima) não, porque
  // catalogoReduzido já deixa readOnly passar direto e executá-la aqui não amplia nada.
  if (plano.confiancaEntrada === "nao_confiavel") return { automatico: false, motivo: "regra_suspensa_conteudo_nao_confiavel" };
  if (nuncaPermanente(nome, ferramenta.readOnlyHint)) return { automatico: false, motivo: "sem_regra_permanente" };
  if (plano.semprePermitir.includes(nome)) return { automatico: true, regra: REGRA_APROVACAO_PERMANENTE, versao: VERSAO_APROVACAO_PERMANENTE };
  return { automatico: false, motivo: "sem_regra_permanente" };
}

/**
 * O lote MISTO pergunta tudo (ADR-042, perfil conservador do Marlon): executar metade e perguntar a
 * outra deixaria o mundo meio mudado sem desfazer — a mensagem já saiu quando a pessoa recusa o
 * resto. Os itens que teriam passado guardam o motivo mesmo assim, então a lista continua
 * explicável. Particionar de verdade é follow-up e cabe aqui dentro.
 */
export function decidirLote(entradas: readonly EntradaAprovacao[]): { automatico: boolean; porItem: DecisaoAutomatica[] } {
  const porItem = entradas.map(decidirAprovacao);
  const automatico = porItem.length > 0 && porItem.every((d) => d.automatico);
  return { automatico, porItem };
}
