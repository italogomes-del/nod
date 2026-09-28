import type { Confianca } from "../contracts/mensagem.ts";
import type { ModoTurno } from "../contracts/plano-turno.ts";

/**
 * Ferramentas nativas de arquivo do Claude Code liberadas quando há projeto autorizado (ADR-039). Bash fica
 * fora: --restricted remove as ferramentas que rodam comando, e comando continua indo ao container do nod.
 * Medido em 2026-09-18: com --restricted, ler fora das pastas permitidas é NEGADO pelo CLI (aparece em
 * permission_denials), por caminho relativo e absoluto, e o CLAUDE.md do projeto é ignorado.
 */
export const NATIVAS_DE_ARQUIVO = ["Read", "Edit", "Write", "Glob", "Grep", "NotebookEdit"] as const;

/**
 * definido em 2026-09-28 (ADR-052): o kit do terminal — o que a pessoa faz no Claude Code, o bot faz no nod.
 * Cada chamada passa pelo hook PreToolUse do nod (caminho confinado à pasta do bot e às pastas autorizadas,
 * trilha no servidor) e o Bash roda no sandbox nativo, sem rede. Só no harness Claude Code, com o hook.
 */
export const NATIVAS_DO_TERMINAL = [...NATIVAS_DE_ARQUIVO, "Bash", "WebFetch", "WebSearch"] as const;

/** As nativas que trazem conteúdo de FORA para o turno: a chamada marca o turno como contaminado (0033). */
export const NATIVAS_QUE_CONTAMINAM: readonly string[] = ["WebFetch", "WebSearch"];

/**
 * Quais nativas o turno recebe. definido em 2026-09-28: só turno de CONVERSA e CONFIÁVEL. Até aqui qualquer
 * turno de uma conversa com pasta autorizada ganhava Write/Edit nativos — inclusive a continuação com a
 * resposta de um colega (não confiável) e a retomada de rotina com gate. As nativas não passam pelo proxy:
 * não há moldura nem catálogo reduzido que as segure (ADR-026), então o único gate possível é não ligá-las.
 * revisto em 2026-09-28 (ADR-050, "bot novo é bot completo"): a criação também — é a mesma conversa própria,
 * aberta pela pessoa; antes ela nem tinha pasta, e bot novo com workspace_* sem Write/Edit ficaria pela metade.
 * revisto em 2026-09-28 (ADR-052): com o harness Claude Code (`terminal`), o turno de conversa confiável tem o
 * kit do terminal mesmo sem pasta de projeto — a pasta do bot (~/nod/<bot>) é sempre dele.
 */
export function nativasDoTurno(t: { modo: ModoTurno; confianca: Confianca; pastasAutorizadas: boolean; terminal?: boolean }): readonly string[] {
  if (!(t.modo === "conversa" || t.modo === "criacao") || t.confianca !== "confiavel") return [];
  if (t.terminal) return NATIVAS_DO_TERMINAL;
  return t.pastasAutorizadas ? NATIVAS_DE_ARQUIVO : [];
}

/** Nome da pasta do bot no Mac da pessoa (~/nod/<nome>): o nome dele, sem o que o sistema de arquivos não aceita. */
export function pastaDoBot(nome: string): string {
  const limpo = nome.normalize("NFC").replace(/[/\\:\0]/g, "-").replace(/^\.+/, "").replace(/\s+/g, " ").trim().slice(0, 60);
  return limpo === "" ? "bot" : limpo;
}

export type DecisaoNativa = { permitir: boolean; motivo: string; contamina: boolean };

/**
 * A decisão do hook do nod para UMA chamada nativa (ADR-052), pura: `resolver` devolve o caminho real
 * (realpath do que existe; do ancestral que existe + o resto, senão) e `permitidas` já vem resolvida. Medido
 * em 2026-09-28: o CLI entrega /private/var/… onde o turno passou /var/… — comparar sem resolver nega o que é
 * da pasta do bot. Fail-closed: ferramenta desconhecida, caminho fora ou Bash sem sandbox → nega.
 */
export function decidirNativa(p: { ferramenta: string; entrada: Record<string, unknown>; permitidas: readonly string[]; cwd: string; resolver: (caminho: string) => string; separador?: string }): DecisaoNativa {
  const sep = p.separador ?? "/";
  const dentro = (caminho: string) => {
    const real = p.resolver(caminho.startsWith(sep) ? caminho : `${p.cwd}${sep}${caminho}`);
    return p.permitidas.some((raiz) => real === raiz || real.startsWith(raiz.endsWith(sep) ? raiz : `${raiz}${sep}`));
  };
  const caminhoDe = (chave: string, padrao?: string): string | null => {
    const v = p.entrada[chave];
    return typeof v === "string" && v !== "" ? v : padrao ?? null;
  };
  const porCaminho = (caminho: string | null): DecisaoNativa =>
    caminho !== null && dentro(caminho)
      ? { permitir: true, motivo: "dentro das pastas do bot", contamina: false }
      : { permitir: false, motivo: "fora da pasta do bot e das pastas autorizadas nesta conversa", contamina: false };
  // Ferramenta MCP do nod não é nativa: quem decide é o proxy (ADR-013), que também grava a trilha. Medido ao
  // vivo em 2026-09-28: com o matcher "*", o CLI consultava o hook para MCP e ele negava publicar_artefato.
  if (p.ferramenta.startsWith("mcp__")) return { permitir: true, motivo: "ferramenta do nod: quem decide é o proxy", contamina: false };
  switch (p.ferramenta) {
    case "Read":
    case "Write":
    case "Edit":
      return porCaminho(caminhoDe("file_path"));
    case "NotebookEdit":
      return porCaminho(caminhoDe("notebook_path"));
    case "Glob":
    case "Grep":
      return porCaminho(caminhoDe("path", p.cwd));
    case "Bash":
      return p.entrada.dangerouslyDisableSandbox === true
        ? { permitir: false, motivo: "comando fora da área protegida não roda no nod", contamina: false }
        : { permitir: true, motivo: "no sandbox: grava só nas pastas do bot, sem rede", contamina: false };
    case "WebFetch":
    case "WebSearch":
      return { permitir: true, motivo: "conteúdo da web: o turno passa a tratar escrita externa como não confiável", contamina: true };
    default:
      return { permitir: false, motivo: `ferramenta fora do kit do nod: ${p.ferramenta}`, contamina: false };
  }
}
