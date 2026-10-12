import { randomUUID } from "node:crypto";
import type { RuntimeEvent } from "../contracts/evento.ts";
import type { PlanoTurno } from "../contracts/plano-turno.ts";
import { classificarComando, comandoArriscado, tocaCredencial } from "../domain/comando.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { decidirPeloModo, REGRA_MODO_TOTAL, type DecisaoDoModo } from "../domain/modo-aprovacao.ts";
import { terminalLiberadoNaTarefa } from "./liberar-na-tarefa.ts";
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

/** Os passos 1–4 acima, sem efeito: roda (e por quê) ou pede card. Quem cria o card é `autorizarComando`. */
async function decidirComando(deps: Deps, plano: PlanoTurno, texto: string, arquivo: string | null): Promise<Permitir | PedeCard> {
  const contaminado = plano.confiancaEntrada !== "confiavel" || (await deps.repos.turnos.contaminado(plano.turnoId));
  if (arquivo === null && classificarComando(texto).tipo === "leitura" && !contaminado) return { permitir: true, porque: "leitura" };
  if (await deps.repos.itensAprovacao.comandoAprovadoNaCadeia(plano.turnoId, texto)) return { permitir: true, porque: "aprovado" };
  const risco = arquivo === null ? comandoArriscado(texto) : null;
  const credencial = tocaCredencial(arquivo ?? texto);
  // definido em 2026-09-30 (ADR-062, auditoria das aprovações): "o resto desta tarefa" libera o comando comum, não
  // a credencial nem o arriscado — antes esta linha vinha antes das duas cercas, e um "pode fazer" num `ls` liberava
  // o `security find-generic-password` e o `rm -rf` seguintes, que nem o modo total libera sem a pessoa.
  if (!contaminado && !credencial && risco === null && (await terminalLiberadoNaTarefa(deps, plano.turnoId))) {
    return { permitir: true, porque: "liberado_na_tarefa" };
  }
  const agente = await deps.repos.agentes.buscar(plano.agenteId);
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
  const r = await decidirComando(deps, plano, texto, null);
  return "permitir" in r ? r : null;
}

export const autorizarComando: CasoDeUso<{ plano: PlanoTurno; comando: string } | { plano: PlanoTurno; arquivo: string }, SaidaAutorizarComando> = async (deps, entrada) => {
  const { plano } = entrada;
  const arquivo = "arquivo" in entrada ? entrada.arquivo.trim() : null;
  const nativa = arquivo === null ? "Bash" : "Write";
  if (!(plano.nativas ?? []).includes(nativa)) throw new ErroDeDominio("nao_permitido", { cause: `${nativa} fora do plano deste turno` });
  const texto = arquivo === null ? ("comando" in entrada ? entrada.comando.trim() : "") : `Gravar ${arquivo}`;
  if (texto === "" || arquivo === "" || texto.length > COMANDO_MAX) throw new ErroDeDominio("entrada_invalida", { cause: arquivo === null ? "comando" : "arquivo" });
  const decidido = await decidirComando(deps, plano, texto, arquivo);
  if ("permitir" in decidido) return { data: decidido };
  const { agenteNome, motivo: doModo, risco } = decidido.card;

  const agora = deps.agora();
  const decisao = await deps.repos.decisoes.criar({
    tipo: "aprovacao",
    agenteId: plano.agenteId,
    conversaId: plano.conversaId,
    turnoId: plano.turnoId,
    prazoDecisaoEm: agora + PRAZO_DECISAO_MS,
    frase: `${agenteNome ?? "O bot"} quer ${arquivo === null ? "rodar um comando" : "gravar um arquivo"} no seu Mac`,
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
