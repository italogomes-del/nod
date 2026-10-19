import { randomUUID } from "node:crypto";
import type { RuntimeEvent } from "../contracts/evento.ts";
import type { PlanoTurno } from "../contracts/plano-turno.ts";
import { classificarComando, comandoArriscado, enviaPeloTerminal, tocaCredencial } from "../domain/comando.ts";
import { NATIVA_MCP_DA_PESSOA } from "../domain/nativas.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { decidirPeloModo, REGRA_MODO_TOTAL, type DecisaoDoModo } from "../domain/modo-aprovacao.ts";
import { terminalLiberadoNaTarefa } from "./liberar-na-tarefa.ts";
import { medirRevisao, type OrigemDaRevisao } from "./medir-revisao.ts";
import { PRAZO_DECISAO_MS } from "./pedir-a-pessoa.ts";
import { autoriaDoAgente } from "./registrar-negacao.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

/** O destino do item de aprovação de um comando: não é conector, é o terminal do Mac da pessoa (ADR-055). */
export const DESTINO_TERMINAL = { conector: "terminal", ferramenta: "bash" } as const;

/** Por que o comando rodou sem card — vai à trilha e aos testes, nunca ao modelo como permissão. */
export type SaidaAutorizarComando = { permitir: true; porque: "leitura" | "aprovado" | "liberado_na_tarefa" | "modo_automatico" | "modo_total" } | { aguardar: string };

/**
 * Cada comando do terminal do Mac da pessoa (definido em 2026-09-28, ADR-055, "terminal de verdade, como o
 * inhouse"). O hook do nod manda o comando ANTES de ele rodar; aqui se decide, nesta ordem:
 *
 *  1. só lê (classificarComando) e o turno não trouxe conteúdo da web → roda;
 *  2. a pessoa já aprovou ESTE comando nesta tarefa (a retomada refaz o que ela aprovou depois da espera) → roda;
 *  3. ela respondeu "Pode fazer e o resto desta tarefa" num comando, o turno está limpo e fora do gate de
 *     rotina, e o comando não toca credencial nem é arriscado → roda;
 *  4. ADR-059: o modo do bot aprova (`decidirPeloModo`): no automático, o que não é arriscado num turno limpo;
 *     no total, tudo. Credencial do Mac nunca passa por aqui → card em qualquer modo;
 *  5. senão → card de aprovação na conversa, e o hook espera a resposta no próprio turno.
 *
 * Turno contaminado pela web (0033) pede até a leitura no manual: um texto de página pode ter mandado o modelo "só
 * olhar" algo que vaza. Plano sem Bash é recusa — o hook de uma máquina antiga não abre porta. O modo é o ATUAL do
 * agente, lido aqui: a dona que volta para o manual no meio de uma tarefa vale no comando seguinte.
 *
 * `arquivo` (definido em 2026-10-01, ADR-066): Write/Edit/NotebookEdit fora de ~/nod/<bot> passam pela MESMA decisão —
 * nunca é leitura, nunca é arriscado (o arriscado de arquivo é a credencial, que o hook já nega). Antes a gravação
 * ignorava o modo: no manual, o bot gravava em qualquer arquivo do Mac sem card.
 */
/**
 * revisto em 2026-10-11: era 8.000. O levantamento das sessões dos bots (VM e Mac, 28/09 a 11/10) achou 27 recusas
 * "entrada inválida", todas de comandos entre 8.017 e 24.613 caracteres — o `python3 - <<'EOF'` que edita um arquivo
 * grande. O corpo da rota já tem teto de 1 MB; este limite só segura o comando absurdo.
 */
export const COMANDO_MAX = 64_000;

type Permitir = { permitir: true; porque: "leitura" | "aprovado" | "liberado_na_tarefa" | "modo_automatico" | "modo_total" };
type PedeCard = { card: { agenteNome: string | null; motivo: Extract<DecisaoDoModo, { automatico: false }> | null; risco: string | null } };

/**
 * O que a chamada pede (revisto em 2026-10-14, ADR-103): um comando do terminal, gravar um arquivo, ou usar um app (MCP)
 * da pessoa. O app nunca é leitura nem arriscado pelo texto: ninguém sabe pelo nome se a ferramenta só lê, então segue o
 * modo como o comando que muda algo.
 */
type Pedido = { tipo: "comando" } | { tipo: "arquivo"; arquivo: string } | { tipo: "mcp" };

const ORIGEM_DO_PEDIDO: Record<Pedido["tipo"], OrigemDaRevisao> = { comando: "terminal", arquivo: "arquivo", mcp: "mcp" };

/**
 * Os passos 1–4 acima, sem efeito: roda (e por quê) ou pede card. Quem cria o card é `autorizarComando`. `medir`: o PR 1
 * do plano dos modos de aprovação conta, no ponto em que o modo seria consultado, o que o Automático novo faria (só o
 * card do terminal; o `esperar_comando` não abre card e fica sem revisor).
 */
async function decidirComando(deps: Deps, plano: PlanoTurno, texto: string, pedido: Pedido, medir = false): Promise<Permitir | PedeCard> {
  const contaminado = plano.confiancaEntrada !== "confiavel" || (await deps.repos.turnos.contaminado(plano.turnoId));
  if (pedido.tipo === "comando" && classificarComando(texto).tipo === "leitura" && !contaminado) return { permitir: true, porque: "leitura" };
  if (await deps.repos.itensAprovacao.comandoAprovadoNaCadeia(plano.turnoId, texto)) return { permitir: true, porque: "aprovado" };
  const risco = pedido.tipo === "comando" ? comandoArriscado(texto) : null;
  const credencial = tocaCredencial(pedido.tipo === "arquivo" ? pedido.arquivo : texto);
  // definido em 2026-09-30 (ADR-062, auditoria das aprovações): "o resto desta tarefa" libera o comando comum, não
  // a credencial nem o arriscado — antes esta linha vinha antes das duas cercas, e um "pode fazer" num `ls` liberava
  // o `security find-generic-password` e o `rm -rf` seguintes, que nem o modo total libera sem a pessoa.
  if (!contaminado && !credencial && risco === null && (await terminalLiberadoNaTarefa(deps, plano.turnoId))) {
    return { permitir: true, porque: "liberado_na_tarefa" };
  }
  const agente = await deps.repos.agentes.buscar(plano.agenteId);
  if (medir) {
    // Envio para fora: no terminal, `enviaPeloTerminal`; todo MCP da pessoa (o nome não diz se só lê); gravar arquivo, nunca.
    const envioParaFora = pedido.tipo === "mcp" || (pedido.tipo === "comando" && enviaPeloTerminal(texto));
    await medirRevisao(deps, plano, agente?.modoAprovacao, { origem: ORIGEM_DO_PEDIDO[pedido.tipo], arriscada: risco !== null, credencial, envioParaFora, contaminado });
  }
  // ADR-066: conteúdo de fora não para o automático nem o total — só o manual, que já chega aqui pedindo.
  const doModo = decidirPeloModo(agente?.modoAprovacao, { arriscada: risco !== null, credencial });
  if (doModo?.automatico) return { permitir: true, porque: doModo.regra === REGRA_MODO_TOTAL ? "modo_total" : "modo_automatico" };
  return { card: { agenteNome: agente?.nome ?? null, motivo: doModo ?? null, risco } };
}

/**
 * definido em 2026-10-12 (ADR-099, parte 2): `esperar_comando` passa o comando pelas MESMAS regras do terminal do bot, mas
 * não abre card — o turno vai encerrar logo depois, e ninguém esperaria a resposta. null = o comando pediria aprovação.
 */
export async function comandoRodaSemCard(deps: Deps, plano: PlanoTurno, comando: string): Promise<Permitir | null> {
  if (!(plano.nativas ?? []).includes("Bash")) return null;
  const texto = comando.trim();
  if (texto === "" || texto.length > COMANDO_MAX) return null;
  const r = await decidirComando(deps, plano, texto, { tipo: "comando" });
  return "permitir" in r ? r : null;
}

/** ADR-103: gravar arquivo é o Write no Claude e o apply_patch no Codex; o plano traz um ou outro. */
const NATIVAS_QUE_GRAVAM = ["Write", "apply_patch"];

export const autorizarComando: CasoDeUso<{ plano: PlanoTurno; comando: string } | { plano: PlanoTurno; arquivo: string } | { plano: PlanoTurno; mcp: string }, SaidaAutorizarComando> = async (deps, entrada) => {
  const { plano } = entrada;
  const arquivo = "arquivo" in entrada ? entrada.arquivo.trim() : null;
  const mcp = "mcp" in entrada ? entrada.mcp.trim() : null;
  const nativas = plano.nativas ?? [];
  const noPlano = arquivo !== null ? NATIVAS_QUE_GRAVAM.some((n) => nativas.includes(n)) : nativas.includes(mcp !== null ? NATIVA_MCP_DA_PESSOA : "Bash");
  if (!noPlano) throw new ErroDeDominio("nao_permitido", { cause: `${arquivo !== null ? "gravar arquivo" : mcp !== null ? NATIVA_MCP_DA_PESSOA : "Bash"} fora do plano deste turno` });
  const texto = arquivo !== null ? `Gravar ${arquivo}` : mcp !== null ? mcp : "comando" in entrada ? entrada.comando.trim() : "";
  if (texto === "" || arquivo === "" || texto.length > COMANDO_MAX) throw new ErroDeDominio("entrada_invalida", { cause: arquivo !== null ? "arquivo" : mcp !== null ? "mcp" : "comando" });
  const pedido: Pedido = arquivo !== null ? { tipo: "arquivo", arquivo } : mcp !== null ? { tipo: "mcp" } : { tipo: "comando" };
  const decidido = await decidirComando(deps, plano, texto, pedido, true);
  if ("permitir" in decidido) return { data: decidido };
  const { agenteNome, motivo: doModo, risco } = decidido.card;

  const agora = deps.agora();
  const decisao = await deps.repos.decisoes.criar({
    tipo: "aprovacao",
    agenteId: plano.agenteId,
    conversaId: plano.conversaId,
    turnoId: plano.turnoId,
    prazoDecisaoEm: agora + PRAZO_DECISAO_MS,
    frase: `${agenteNome ?? "O bot"} quer ${arquivo !== null ? "gravar um arquivo no seu Mac" : mcp !== null ? "usar um app seu" : "rodar um comando no seu Mac"}`,
  });
  if (!decisao) throw new ErroDeDominio("estado_invalido", { cause: "decisão não criada" });
  await deps.repos.itensAprovacao.criarLote(decisao.id, [{ idx: 0, texto, destino: { ...DESTINO_TERMINAL, argumentos: arquivo === null ? { comando: texto } : { arquivo } }, origemSensivel: false, motivoManual: doModo?.motivo ?? "destino_terminal",
    // ADR-059: o porquê do arriscado, em frase fixa do domínio (nunca texto do modelo), para o card dizer o que parou.
    ...(doModo?.motivo === "acao_arriscada" && risco ? { justificativa: risco } : {}) }]);
  const evento: RuntimeEvent = {
    tenantId: deps.escopo.tenantId,
    id: randomUUID(),
    createdAt: agora,
    kind: "decisao_criada",
    autoria: autoriaDoAgente(deps.escopo, plano.agenteId),
    pessoaDestinoId: deps.escopo.pessoaId,
    conversaId: plano.conversaId,
    turnoId: plano.turnoId,
    dados: { decisao_id: decisao.id, tipo: "aprovacao", itens: 1, sensiveis: 0 },
  };
  return { data: { aguardar: decisao.id }, events: [evento] };
};
