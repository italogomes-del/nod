import { randomUUID } from "node:crypto";
import type { Decisao, TipoDecisao } from "../contracts/decisao.ts";
import type { RuntimeEvent } from "../contracts/evento.ts";
import type { ArgsPedirAPessoa } from "../contracts/ferramentas-nod.ts";
import type { CasoNod, ContextoFerramenta } from "../contracts/servicos.ts";
import { redigir } from "../domain/redacao.ts";
import { rotinaDoTurno } from "./apoio-l7.ts";
import { autoriaDoAgente } from "./registrar-negacao.ts";
import type { Deps } from "./tipos.ts";

/** definido em 2026-09-16: 24 h de relógio de parede para a pessoa responder (mesmo valor do NOD_PRAZO_DECISAO_MS do .env.example). */
export const PRAZO_DECISAO_MS = 24 * 60 * 60 * 1000;

const TIPOS: readonly ArgsPedirAPessoa["tipo"][] = ["pergunta", "falta_de_dado", "permissao"];

/**
 * Pergunta ≠ permissão (E4.4, EMENDA 16): args malformados caem no caminho de JULGAMENTO HUMANO
 * ('pergunta'), nunca em 'permissao'. Usada por chamar-ferramenta ANTES da validação de schema:
 * pedir_a_pessoa nunca é recusada por args_invalidos — vira pergunta.
 */
export function normalizarPedidoAPessoa(args: unknown): ArgsPedirAPessoa {
  const a = (typeof args === "object" && args !== null ? args : {}) as Record<string, unknown>;
  const tipo = TIPOS.find((t) => t === a.tipo) ?? "pergunta";
  const texto = typeof a.texto === "string" && a.texto.trim() !== "" ? a.texto.trim() : "(pedido sem texto)";
  const saida: ArgsPedirAPessoa = { tipo, texto };
  if (typeof a.dado === "string" && a.dado.trim() !== "") saida.dado = a.dado.trim();
  if (typeof a.quem_destrava === "string" && a.quem_destrava.trim() !== "") saida.quem_destrava = a.quem_destrava.trim();
  return saida;
}

/** Resolve a pessoa nomeada entre as pessoas do tenant (nome inteiro ou primeiro nome, sem caixa); ausente/desconhecida = dona. */
export async function resolverDecisor(deps: Deps, nome: string | undefined): Promise<{ id: string; nome: string }> {
  const pessoas = await deps.repos.pessoas.listarDoTenant();
  const dona = pessoas.find((p) => p.id === deps.escopo.pessoaId) ?? { id: deps.escopo.pessoaId, nome: "você" };
  if (!nome) return { id: dona.id, nome: dona.nome };
  const alvo = nome.trim().toLowerCase();
  const achada = pessoas.find((p) => p.nome.toLowerCase() === alvo) ?? pessoas.find((p) => p.nome.toLowerCase().split(/\s+/)[0] === alvo);
  return achada ? { id: achada.id, nome: achada.nome } : { id: dona.id, nome: dona.nome };
}

function fraseDoPedido(args: ArgsPedirAPessoa, quem: string, agora: number): string {
  switch (args.tipo) {
    case "falta_de_dado":
      return redigir("parei-falta-dado", agora, { dado: args.dado ?? args.texto, quem });
    case "permissao":
      return `parei: preciso de permissão — ${args.texto}; quem destrava: ${quem}; não vou tentar de novo.`;
    case "pergunta":
      return `parei para perguntar a ${quem}: ${args.texto}`;
  }
}

/**
 * definido em 2026-09-24 (ADR-044): a rotina que dispara às 8h, 13h e 18h e esbarra no mesmo buraco
 * perguntaria de novo a cada disparo — a Nina deixava um card por execução. Num turno de rotina, a
 * decisão PENDENTE do mesmo agente e tipo cujo turno leva à MESMA rotina já é a pergunta: reaproveita,
 * sem mensagem nem evento novos. Fora de rotina nada muda (cada conversa pergunta o que precisa).
 */
async function pedidoDaMesmaRotina(deps: Deps, input: ContextoFerramenta, tipo: TipoDecisao): Promise<Decisao | null> {
  const daRotina = await rotinaDoTurno(deps.repos, input.turnoId);
  if (!daRotina) return null;
  for (const d of await deps.repos.decisoes.pendentesDaConversa(input.conversaId)) {
    if (d.agenteId !== input.agenteId || d.tipo !== tipo || d.turnoId === null) continue;
    if ((await rotinaDoTurno(deps.repos, d.turnoId))?.rotina.id === daRotina.rotina.id) return d;
  }
  return null;
}

/**
 * Nona ferramenta nod (EMENDA 16): cria uma Decisao TIPADA ('pergunta' | 'falta_de_dado' |
 * 'permissao') dirigida à pessoa nomeada (perna extra da RLS, EMENDA 1) ou à dona, escreve a
 * mensagem de parada na conversa ("parei: falta X; quem destrava: Y; não vou tentar de novo",
 * E5.2) e manda o modelo encerrar o turno. A resposta da pessoa (POST decisoes/:id/responder, L9)
 * cria o turno de retomada. O evento vai para a DONA (o outbox só aceita a pessoa da sessão como
 * destino); a decisora vê pela fila "Sua vez".
 */
export const pedirAPessoa: CasoNod<Deps, "pedir_a_pessoa"> = async (deps, input) => {
  const agora = deps.agora();
  const args = normalizarPedidoAPessoa(input);
  const tipo: TipoDecisao = args.tipo;
  const repetida = await pedidoDaMesmaRotina(deps, input, tipo);
  if (repetida) return { data: { estado: "pendente", decisao_id: repetida.id, instrucao: "encerre o turno; a resposta retoma depois" }, events: [] };
  const decisor = await resolverDecisor(deps, args.quem_destrava);
  const frase = fraseDoPedido(args, decisor.nome, agora);
  const decisao = await deps.repos.decisoes.criar({
    tipo,
    decisorId: decisor.id,
    agenteId: input.agenteId,
    conversaId: input.conversaId,
    turnoId: input.turnoId,
    prazoDecisaoEm: agora + PRAZO_DECISAO_MS,
    frase,
  });
  if (!decisao) throw new Error("decisão não criada");
  const autoria = autoriaDoAgente(deps.escopo, input.agenteId);
  await deps.repos.mensagens.criar({ conversaId: input.conversaId, turnoId: input.turnoId, autoria, kind: "texto", texto: frase, confianca: "confiavel" });
  const evento: RuntimeEvent = {
    tenantId: deps.escopo.tenantId,
    id: randomUUID(),
    createdAt: agora,
    kind: "decisao_criada",
    autoria,
    pessoaDestinoId: deps.escopo.pessoaId,
    conversaId: input.conversaId,
    turnoId: input.turnoId,
    dados: { decisao_id: decisao.id, tipo, decisor_id: decisor.id, prazo_decisao_em: decisao.prazoDecisaoEm },
  };
  return { data: { estado: "pendente", decisao_id: decisao.id, instrucao: "encerre o turno; a resposta retoma depois" }, events: [evento] };
};
