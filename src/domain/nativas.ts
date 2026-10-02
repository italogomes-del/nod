import { tocaCredencial } from "./comando.ts";
import { arquivoForaDaPastaDoBot, gitForaDaPastaDoBot, type ContextoDaPasta } from "./git-na-pasta-do-bot.ts";
import { FERRAMENTAS_DE_TAREFA } from "./tarefas-do-bot.ts";
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
 * definido em 2026-09-28 (emenda da ADR-055, "as skills do terminal"): as skills da pessoa e os subagentes. Sem a
 * ferramenta Skill, o Dev 1 respondeu "não tenho ferramenta de skills" a um pedido de /review — as 305 skills dela
 * e os plugins já vinham carregados pelo --add-dir da pasta dela, e nenhuma podia ser chamada. Medido no CLI
 * 2.1.284: o hook do nod recebe a Skill e o Agent, e DEPOIS cada ferramenta que a skill ou o subagente usa (o Bash
 * do subagente chega com o agent_id dele) — a decisão do servidor continua em toda chamada. O `init` lista o
 * subagente como "Task"; o --tools aceita e o hook recebe "Agent".
 */
export const NATIVAS_DE_SKILL = ["Skill", "Agent"] as const;

/**
 * definido em 2026-09-28 (ADR-052): o kit do terminal — o que a pessoa faz no Claude Code, o bot faz no nod.
 * Cada chamada passa pelo hook PreToolUse do nod (trilha no servidor). Só no harness Claude Code, com o hook.
 * revisto em 2026-09-28 (ADR-055): sem sandbox — arquivos em qualquer lugar do Mac, Bash com rede e as
 * credenciais da pessoa, e cada comando decidido pelo servidor (leitura roda, o resto pede aprovação).
 * revisto em 2026-10-01 (ADR-067): `Monitor` (acompanha um comando e acorda o bot a cada linha) e `TaskStop` (para um
 * comando que o próprio bot pôs em segundo plano) — o que deixa o trabalho seguir por horas, como no Claude Code.
 */
export const NATIVAS_DE_SEGUNDO_PLANO = ["Monitor", "TaskStop"] as const;
export const NATIVAS_DO_TERMINAL = [...NATIVAS_DE_ARQUIVO, "Bash", ...NATIVAS_DE_SEGUNDO_PLANO, "WebFetch", "WebSearch", ...NATIVAS_DE_SKILL, ...FERRAMENTAS_DE_TAREFA] as const;

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
 * revisto em 2026-10-01 (ADR-066, "o bot tem o que você deu; o modo decide"): com o hook, o kit vale em TODO modo —
 * rotina, pedido de colega, sala — e com qualquer confiança da entrada. O motivo de desligar ("as nativas não passam
 * pelo proxy, o único gate é não ligá-las") caiu com a ADR-052: o hook leva cada chamada ao servidor, o Bash é
 * decidido pelo modo e, desde esta ADR, o Edit/Write fora da pasta do bot também. Em 30/09 os Devs não
 * implementaram nenhum dos 6 pedidos do Chico porque o pedido de colega não tinha terminal. Só o peer legado fica
 * sem. Sem o hook (driver antigo, só --restricted), ninguém decide as nativas: elas ficam na conversa confiável.
 */
export function nativasDoTurno(t: { modo: ModoTurno; confianca: Confianca; pastasAutorizadas: boolean; terminal?: boolean }): readonly string[] {
  if (t.modo === "peer") return [];
  if (t.terminal) return NATIVAS_DO_TERMINAL;
  return t.pastasAutorizadas && (t.modo === "conversa" || t.modo === "criacao") && t.confianca === "confiavel" ? NATIVAS_DE_ARQUIVO : [];
}

/** Por que um turno de harness com terminal ficou sem ele: o modo, ou a entrada que veio de fora. */
export type MotivoSemTerminal = "pedido_de_colega" | "rotina" | "sala" | "conteudo_de_fora" | "resposta_a_colega";

/**
 * definido em 2026-10-01 (ADR-065): o motivo vai ao prompt, porque sem ele o bot não sabe por que tem terminal num
 * turno e não no outro. Em 30/09 os Devs responderam "neste turno não tenho terminal" a 6 de 6 pedidos de implementar
 * do Chico, a Clarice gravou na memória que os Devs "não têm terminal" e o Marlon perguntou cinco vezes como
 * desbloqueá-los. Sai da MESMA regra de `nativasDoTurno`: se ela mudar, o motivo acompanha. null = o turno tem o
 * terminal, ou o harness nunca o teria (Codex, máquina sem o hook) — aí não há o que explicar.
 */
export function motivoSemTerminal(t: { modo: ModoTurno; confianca: Confianca; terminal?: boolean }): MotivoSemTerminal | null {
  if (!t.terminal) return null;
  if (nativasDoTurno({ modo: t.modo, confianca: t.confianca, pastasAutorizadas: false, terminal: true }).includes("Bash")) return null;
  // Confiável, o mesmo modo teria o terminal: o que tirou foi a entrada.
  if (nativasDoTurno({ modo: t.modo, confianca: "confiavel", pastasAutorizadas: false, terminal: true }).includes("Bash")) return "conteudo_de_fora";
  if (t.modo === "delegacao") return "pedido_de_colega";
  if (t.modo === "rotina") return "rotina";
  if (t.modo === "sala") return "sala";
  return "resposta_a_colega";
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
/**
 * `arquivo` (definido em 2026-10-01, ADR-066): Write/Edit/NotebookEdit fora de ~/nod/<bot> — o servidor decide pelo
 * modo, como o comando. Só com o contexto da pasta (config do hook novo); sem ele, a gravação passa como antes.
 */
export type DecisaoNativa = { permitir: boolean; motivo: string; contamina: boolean; comando?: string; arquivo?: string };

/**
 * A decisão do hook do nod para UMA chamada nativa, pura. revisto em 2026-09-28 (ADR-055, "terminal de verdade,
 * como o inhouse"): a pessoa escolheu que o bot lê e grava em QUALQUER lugar do Mac, como ela no Claude Code —
 * as nativas de arquivo não são mais confinadas à pasta do bot (ADR-052). O Bash roda fora de sandbox, com rede e
 * as credenciais dela, e por isso cada comando passa pelo servidor. Fail-closed: ferramenta desconhecida e Bash
 * sem comando → nega.
 */
export function decidirNativa(p: { ferramenta: string; entrada: Record<string, unknown>; pasta?: ContextoDaPasta }): DecisaoNativa {
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
      // ADR-055: o Mac inteiro, menos onde moram as credenciais — lê-las é o primeiro passo para vazá-las.
      const caminhos = ["file_path", "notebook_path", "path", "pattern"].map((k) => p.entrada[k]).filter((v): v is string => typeof v === "string");
      if (caminhos.some(tocaCredencial)) return { permitir: false, motivo: "arquivo de credencial (chaves, tokens, Keychain): o nod não abre; se a tarefa precisar, peça à pessoa", contamina: false };
      // ADR-066: gravar fora da pasta do bot segue o modo de aprovação (o servidor decide); ler continua livre.
      const grava = p.ferramenta === "Write" || p.ferramenta === "Edit" || p.ferramenta === "NotebookEdit";
      const alvo = typeof p.entrada.file_path === "string" ? p.entrada.file_path : typeof p.entrada.notebook_path === "string" ? p.entrada.notebook_path : null;
      const arquivo = grava && p.pasta && alvo !== null ? arquivoForaDaPastaDoBot(alvo, p.pasta) : null;
      return { permitir: true, motivo: "arquivos do Mac da pessoa", contamina: false, ...(arquivo ? { arquivo } : {}) };
    }
    // ADR-067: o Monitor roda um comando como o Bash (cada linha da saída acorda o bot) — mesma cerca e mesma decisão.
    case "Bash":
    case "Monitor": {
      const comando = typeof p.entrada.command === "string" ? p.entrada.command : "";
      if (comando.trim() === "") return { permitir: false, motivo: "comando vazio", contamina: false };
      // ADR-065: git que mexe na pasta de trabalho só na pasta do bot — cerca local, antes do servidor, em qualquer modo.
      const fora = p.pasta ? gitForaDaPastaDoBot(comando, p.pasta) : null;
      return fora ? { permitir: false, motivo: fora, contamina: false } : { permitir: true, motivo: "o servidor do nod decide o comando", contamina: false, comando };
    }
    case "WebFetch":
    case "WebSearch":
      return { permitir: true, motivo: "conteúdo da web: o turno passa a tratar escrita externa como não confiável", contamina: true };
    // Emenda da ADR-055: a skill é instrução dos arquivos da própria pessoa, e o subagente é o mesmo modelo com as
    // mesmas ferramentas; o que cada um USA passa por aqui de novo, chamada por chamada.
    case "Skill":
      return { permitir: true, motivo: "skill da pessoa: cada ferramenta que ela usar passa pelo nod", contamina: false };
    case "Agent":
      return { permitir: true, motivo: "subagente: cada ferramenta dele passa pelo nod", contamina: false };
    // A lista de tarefas do bot só organiza o trabalho dentro da sessão: não lê nem muda nada fora dela.
    case "TaskCreate":
    case "TaskGet":
    case "TaskList":
    case "TaskUpdate":
      return { permitir: true, motivo: "lista de tarefas do bot", contamina: false };
    // ADR-067: parar um comando que o próprio bot pôs em segundo plano não toca nada fora da sessão.
    case "TaskStop":
      return { permitir: true, motivo: "para um comando que o bot pôs em segundo plano", contamina: false };
    default:
      return { permitir: false, motivo: `ferramenta fora do kit do nod: ${p.ferramenta}`, contamina: false };
  }
}
