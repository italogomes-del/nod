import { randomUUID } from "node:crypto";
import type { RuntimeEvent } from "../contracts/evento.ts";
import type { CasoNod } from "../contracts/servicos.ts";
import { montarItens, type PropostaItem } from "../domain/aprovacao-item.ts";
import { conectorTocaAprendiz } from "../domain/dado-pessoal.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { PRAZO_DECISAO_MS } from "./pedir-a-pessoa.ts";
import { autoriaDoAgente } from "./registrar-negacao.ts";
import type { Deps } from "./tipos.ts";

/**
 * Aprovação em LISTA tipada (E4.1/E4.2, EMENDA 23): cada item vira linha própria em itens_aprovacao
 * com destino tipado; origem sensível (declaração do conector de ORIGEM, nunca o texto — ADR-002)
 * nasce desmarcada com justificativa fixa do sistema. O destino tem que existir no catálogo do
 * conector registrado (o agente nunca inventa escopo, E6.2). A decisão nasce pendente para a dona;
 * o proxy faz long-poll e, sem decisão, manda o modelo encerrar o turno (a decisão retoma depois).
 */
const montarPedido = (computador: boolean): CasoNod<Deps, "pedir_aprovacao"> => async (deps, input) => {
  const agora = deps.agora();
  if (!Array.isArray(input.itens) || input.itens.length === 0) throw new ErroDeDominio("entrada_invalida", { cause: "itens vazios" });
  const propostas: PropostaItem[] = [];
  for (const item of input.itens) {
    if (item.destino.conector === "computador") {
      if (!computador) throw new ErroDeDominio("nao_permitido");
      const id = item.destino.argumentos?.acaoId;
      if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id) || item.destino.ferramenta !== "executar") throw new ErroDeDominio("entrada_invalida");
      const c = await deps.repos.computadores.obter(input.agenteId);
      const a = await deps.repos.computadores.buscarAcao(id);
      if (!c || !a || a.computadorId !== c.id || a.turnoId !== input.turnoId || a.estado !== "pendente") throw new ErroDeDominio("nao_permitido");
      propostas.push({ texto: item.texto, destino: item.destino, origemSensivel: false });
      continue;
    }
    const conector = await deps.repos.conectores.buscarPorSlug(item.destino.conector);
    if (!conector) throw new ErroDeDominio("entrada_invalida", { cause: `conector ${item.destino.conector} não registrado` });
    if (!conector.catalogo.some((c) => c.nome === item.destino.ferramenta)) {
      throw new ErroDeDominio("entrada_invalida", { cause: `ferramenta ${item.destino.ferramenta} fora do catálogo de ${conector.slug}` });
    }
    let origemSensivel = false;
    if (item.origem_conector) {
      const origem = await deps.repos.conectores.buscarPorSlug(item.origem_conector);
      // Origem desconhecida = fail-closed: trata como sensível (ADR-002: não declarou = toca).
      origemSensivel = origem ? conectorTocaAprendiz(origem) : true;
    }
    propostas.push({
      texto: item.texto,
      destino: { conector: conector.slug, ferramenta: item.destino.ferramenta, argumentos: item.destino.argumentos ?? {} },
      origemSensivel,
    });
  }
  const decisao = await deps.repos.decisoes.criar({
    tipo: "aprovacao",
    agenteId: input.agenteId,
    conversaId: input.conversaId,
    turnoId: input.turnoId,
    prazoDecisaoEm: agora + PRAZO_DECISAO_MS,
    frase: input.resumo,
  });
  if (!decisao) throw new Error("decisão não criada");
  const itens = montarItens({ tenantId: deps.escopo.tenantId, decisaoId: decisao.id, propostas, agora });
  await deps.repos.itensAprovacao.criarLote(
    decisao.id,
    itens.map((i) => ({ idx: i.idx, texto: i.textoOriginal, destino: i.destino, origemSensivel: i.origemSensivel, justificativa: i.justificativa })),
  );
  const evento: RuntimeEvent = {
    tenantId: deps.escopo.tenantId,
    id: randomUUID(),
    createdAt: agora,
    kind: "decisao_criada",
    autoria: autoriaDoAgente(deps.escopo, input.agenteId),
    pessoaDestinoId: deps.escopo.pessoaId,
    conversaId: input.conversaId,
    turnoId: input.turnoId,
    dados: { decisao_id: decisao.id, tipo: "aprovacao", itens: itens.length, sensiveis: itens.filter((i) => i.origemSensivel).length, prazo_decisao_em: decisao.prazoDecisaoEm },
  };
  return { data: { estado: "pendente", decisao_id: decisao.id, instrucao: "encerre o turno; a decisão retoma depois" }, events: [evento] };
};

export const pedirAprovacao = montarPedido(false);
export const pedirAprovacaoComputador = montarPedido(true);
