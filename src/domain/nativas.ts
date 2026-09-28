import { tocaCredencial } from "./comando.ts";
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
 * Cada chamada passa pelo hook PreToolUse do nod (trilha no servidor). Só no harness Claude Code, com o hook.
 * revisto em 2026-09-28 (ADR-053): sem sandbox — arquivos em qualquer lugar do Mac, Bash com rede e as
 * credenciais da pessoa, e cada comando decidido pelo servidor (leitura roda, o resto pede aprovação).
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

/**
 * `comando` = o Bash: quem decide é o SERVIDOR (autorizar-comando.ts), com o comando na mão — só lê roda direto,
 * o resto vira card. O hook nunca decide um comando sozinho.
 */
export type DecisaoNativa = { permitir: boolean; motivo: string; contamina: boolean; comando?: string };

/**
 * A decisão do hook do nod para UMA chamada nativa, pura. revisto em 2026-09-28 (ADR-053, "terminal de verdade,
 * como o inhouse"): a pessoa escolheu que o bot lê e grava em QUALQUER lugar do Mac, como ela no Claude Code —
 * as nativas de arquivo não são mais confinadas à pasta do bot (ADR-052). O Bash roda fora de sandbox, com rede e
 * as credenciais dela, e por isso cada comando passa pelo servidor. Fail-closed: ferramenta desconhecida e Bash
 * sem comando → nega.
 */
export function decidirNativa(p: { ferramenta: string; entrada: Record<string, unknown> }): DecisaoNativa {
  // Ferramenta MCP do nod não é nativa: quem decide é o proxy (ADR-013), que também grava a trilha. Medido ao
  // vivo em 2026-09-28: com o matcher "*", o CLI consultava o hook para MCP e ele negava publicar_artefato.
  if (p.ferramenta.startsWith("mcp__")) return { permitir: true, motivo: "ferramenta do nod: quem decide é o proxy", contamina: false };
  switch (p.ferramenta) {
    case "Read":
    case "Write":
    case "Edit":
    case "NotebookEdit":
    case "Glob":
    case "Grep": {
      // ADR-053: o Mac inteiro, menos onde moram as credenciais — lê-las é o primeiro passo para vazá-las.
      const caminhos = ["file_path", "notebook_path", "path", "pattern"].map((k) => p.entrada[k]).filter((v): v is string => typeof v === "string");
      return caminhos.some(tocaCredencial)
        ? { permitir: false, motivo: "arquivo de credencial (chaves, tokens, Keychain): o nod não abre; se a tarefa precisar, peça à pessoa", contamina: false }
        : { permitir: true, motivo: "arquivos do Mac da pessoa", contamina: false };
    }
    case "Bash": {
      const comando = typeof p.entrada.command === "string" ? p.entrada.command : "";
      return comando.trim() === ""
        ? { permitir: false, motivo: "comando vazio", contamina: false }
        : { permitir: true, motivo: "o servidor do nod decide o comando", contamina: false, comando };
    }
    case "WebFetch":
    case "WebSearch":
      return { permitir: true, motivo: "conteúdo da web: o turno passa a tratar escrita externa como não confiável", contamina: true };
    default:
      return { permitir: false, motivo: `ferramenta fora do kit do nod: ${p.ferramenta}`, contamina: false };
  }
}
