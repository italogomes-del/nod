import type { CapacidadeConector } from "../contracts/conector.ts";

type Catalogo = readonly Pick<CapacidadeConector, "nome" | "readOnlyHint">[];

/** Os níveis que a pessoa escolhe por bot e por app; "nenhum" revoga tudo o que o bot tinha no app. */
export type NivelDeAcesso = "nenhum" | "leitura" | "escrita";

export type IdGrupoAcesso = "ler" | "criar" | "alterar" | "comentar" | "apagar";

export type GrupoDeAcesso = { id: IdGrupoAcesso; rotulo: string; capacidades: string[] };

export const ROTULOS_GRUPO: Record<IdGrupoAcesso, string> = {
  ler: "Ler",
  criar: "Criar e enviar",
  alterar: "Editar",
  comentar: "Comentar",
  apagar: "Apagar",
};

const ORDEM: readonly IdGrupoAcesso[] = ["ler", "criar", "alterar", "comentar", "apagar"];

/**
 * definido em 2026-09-25: o catálogo do Composio tem dezenas de ações por app (SLACK_ADD_EMOJI,
 * CLICKUP_CREATE_TASK…) e a pessoa decide por GRUPO, não por nome técnico. O nível de leitura continua
 * sendo o `readOnlyHint` da sonda (ADR-013), nunca o nome; o nome só separa a ESCRITA em grupos, e
 * quem cai em mais de um verbo vai para o primeiro que casar nesta ordem: apagar ganha de tudo, porque
 * errar para o lado de "apagar" só deixa a ação desmarcada.
 */
const VERBOS: readonly [IdGrupoAcesso, RegExp][] = [
  ["apagar", /(^|_)(DELETE|REMOVE|ARCHIVE|TRASH|DESTROY|PURGE|UNINSTALL|DEACTIVATE|REVOKE|KICK|LEAVE)(_|$)/],
  ["comentar", /(^|_)(COMMENT|COMMENTS|REPLY|REACTION|REACT)(_|$)/],
  ["criar", /(^|_)(CREATE|ADD|NEW|POST|SEND|UPLOAD|INSERT|INVITE|SCHEDULE|DUPLICATE|COPY|FORWARD)(_|$)/],
];

function grupoDaEscrita(nome: string): IdGrupoAcesso {
  const n = nome.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  for (const [id, re] of VERBOS) if (re.test(n)) return id;
  return "alterar";
}

export function grupoDaCapacidade(c: Pick<CapacidadeConector, "nome" | "readOnlyHint">): IdGrupoAcesso {
  return c.readOnlyHint === true ? "ler" : grupoDaEscrita(c.nome);
}

/** Os grupos NÃO vazios do catálogo, na ordem fixa em que a pessoa os lê no card. */
export function gruposDoCatalogo(catalogo: Catalogo): GrupoDeAcesso[] {
  const por = new Map<IdGrupoAcesso, string[]>();
  for (const c of catalogo) {
    const id = grupoDaCapacidade(c);
    por.set(id, [...(por.get(id) ?? []), c.nome]);
  }
  return ORDEM.filter((id) => por.has(id)).map((id) => ({ id, rotulo: ROTULOS_GRUPO[id], capacidades: por.get(id) ?? [] }));
}

/**
 * O que cada nível concede. definido em 2026-09-25: "Ler e alterar" nunca inclui "apagar" — a pessoa
 * que quiser apagar marca o grupo no card ou concede na tela avançada, ação por ação.
 */
export function capacidadesDoNivel(catalogo: Catalogo, nivel: NivelDeAcesso): string[] {
  if (nivel === "nenhum") return [];
  return catalogo.filter((c) => {
    const g = grupoDaCapacidade(c);
    return nivel === "leitura" ? g === "ler" : g !== "apagar";
  }).map((c) => c.nome);
}

/**
 * O nível que um conjunto concedido representa, para a tela dizer "Ler" ou "Ler e alterar". Qualquer
 * escrita concedida já é "escrita"; leitura sem escrita é "leitura"; nada é "nenhum".
 */
export function nivelDasConcedidas(catalogo: Catalogo, concedidas: readonly string[]): NivelDeAcesso {
  if (concedidas.length === 0) return "nenhum";
  const leitura = new Set(catalogo.filter((c) => c.readOnlyHint === true).map((c) => c.nome));
  return concedidas.some((n) => !leitura.has(n)) ? "escrita" : "leitura";
}
