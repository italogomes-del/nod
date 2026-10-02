import { randomUUID } from "node:crypto";
import type { Concessao } from "../contracts/concessao.ts";
import type { RuntimeEvent } from "../contracts/evento.ts";
import type { ItemAprovacao } from "../contracts/item-aprovacao.ts";
import type { DesfechoItem, MotivoAprovacaoManual } from "../contracts/motivos.ts";
import type { CasoNod } from "../contracts/servicos.ts";
import { montarItens, type PropostaItem } from "../domain/aprovacao-item.ts";
import { acaoArriscadaNoApp, decidirLote, REGRA_APROVACAO_PERMANENTE, type DecisaoAutomatica } from "../domain/aprovacao-permanente.ts";
import { REGRA_MODO_AUTOMATICO, REGRA_MODO_TOTAL } from "../domain/modo-aprovacao.ts";
import { conectorTocaDadoPessoal } from "../domain/dado-pessoal.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { errosDoSchema } from "../domain/schema-args.ts";
import { rotinaDoTurno } from "./apoio-l7.ts";
import { executarItens } from "./decidir.ts";
import { PRAZO_DECISAO_MS } from "./pedir-a-pessoa.ts";
import { semprePermitirVivo } from "./regras-vivas.ts";
import { autoriaDoAgente } from "./registrar-negacao.ts";
import type { Deps } from "./tipos.ts";

/**
 * Aprovação em LISTA tipada (E4.1/E4.2, EMENDA 23): cada item vira linha própria em itens_aprovacao
 * com destino tipado; origem sensível (declaração do conector de ORIGEM, nunca o texto — ADR-002)
 * nasce desmarcada com justificativa fixa do sistema. O destino tem que existir no catálogo do
 * conector registrado (o agente nunca inventa escopo, E6.2).
 *
 * ADR-042: antes de criar a pendência, a regra NOMEADA decide item a item sobre o plano JÁ PUXADO
 * (avaliação local, nunca consulta por chamada — ADR-013). Quando TODO o lote passa, a decisão nasce
 * FECHADA (`estado: 'decidida'`, `decidida_por` NULO porque nenhuma pessoa decidiu) e o turno segue
 * sem morrer no long-poll. Quando qualquer item precisa de gente, o lote inteiro pergunta — executar
 * metade deixaria o mundo meio mudado sem desfazer — e cada item guarda o motivo de ter parado.
 */
/**
 * definido em 2026-09-21: a classificação por origem (ADR-002) fica DESLIGADA — decisão do Marlon,
 * de que o nod não está sendo construído para tratar dado pessoal sensível. Nenhum item novo nasce
 * sensível, então o CHECK item_sensivel_marcado_exige_pessoa vira vacuamente verdadeiro.
 *
 * NEUTRALIZADA, não removida, e isso é deliberado. Remover custaria ~78 arquivos e migração nova,
 * com quatro efeitos irreversíveis: `origem_sensivel` é carimbo do instante da criação e não há
 * coluna que guarde qual conector originou o item (architecture.html:224 — "impossível de
 * retroagir"); a trilha é imutável por trigger e já gravou `sensiveis: N` por evento (ADR-004);
 * mensagens de resultado já escritas trazem "(sensível, não aprovado)" no texto; e o Postgres não
 * remove valor de enum. Deixando a coluna e o CHECK, o histórico continua legível e voltar atrás
 * é esta constante.
 *
 * O que NÃO sai daqui, porque não depende desta premissa: trilha sem texto livre, erro que não ecoa
 * `message` e rótulo de métrica em união fechada valem para qualquer titular (ADR-002 refinamento,
 * ADR-004, ADR-017). Fica em aberto o parecer jurídico nomeado em product-spec.html:456 e o art. 14
 * da LGPD (architecture.html:545), que nenhum ADR cobre.
 */
const CLASSIFICAR_ORIGEM_SENSIVEL = false;

const montarPedido = (computador: boolean): CasoNod<Deps, "pedir_aprovacao"> => async (deps, input) => {
  const agora = deps.agora();
  if (!Array.isArray(input.itens) || input.itens.length === 0) throw new ErroDeDominio("entrada_invalida", { cause: "itens vazios" });
  const propostas: PropostaItem[] = [];
  const conectorIdPorIdx: (string | null)[] = [];
  // ADR-059: a capacidade de destino é arriscada (apagar, merge, aprovar PR)? Lido do catálogo do CONECTOR.
  const arriscadaPorIdx: boolean[] = [];
  let concessoes: Concessao[] | undefined;
  // definido em 2026-09-30 (ADR-062): argumentos conferidos contra o schema do conector ANTES do card. Sem isso, um
  // item sem campo obrigatório virava card, falhava depois do clique e o bot pedia de novo igual (o Milton teve 6
  // comentários sem `assignee` hoje, 6 cards). Volta ao bot como resposta, não como exceção: o `cause` de um erro de
  // domínio só vai para o log (AGENTS.md: erro nunca vaza `message`), e o bot precisa ler o que corrigir.
  const errosDeArgs: string[] = [];
  for (const [idxItem, item] of input.itens.entries()) {
    if (item.destino.conector === "computador") {
      if (!computador) throw new ErroDeDominio("nao_permitido");
      const id = item.destino.argumentos?.acaoId;
      if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id) || item.destino.ferramenta !== "executar") throw new ErroDeDominio("entrada_invalida");
      const c = await deps.repos.computadores.obter(input.agenteId);
      const a = await deps.repos.computadores.buscarAcao(id);
      if (!c || !a || a.computadorId !== c.id || a.turnoId !== input.turnoId || a.estado !== "pendente") throw new ErroDeDominio("nao_permitido");
      propostas.push({ texto: item.texto, destino: item.destino, origemSensivel: false });
      conectorIdPorIdx.push(null);
      arriscadaPorIdx.push(false);
      continue;
    }
    const conector = await deps.repos.conectores.buscarPorSlug(item.destino.conector);
    if (!conector) throw new ErroDeDominio("entrada_invalida", { cause: `conector ${item.destino.conector} não registrado` });
    const capacidade = conector.catalogo.find((c) => c.nome === item.destino.ferramenta);
    if (!capacidade) {
      throw new ErroDeDominio("entrada_invalida", { cause: `ferramenta ${item.destino.ferramenta} fora do catálogo de ${conector.slug}` });
    }
    // definido em 2026-09-24 (revisão da ADR-047): o catálogo do CONECTOR não é o do agente. Sem concessão,
    // um clique em "Pode fazer" executava uma ferramenta que a pessoa nunca deu a ele; pede acesso antes.
    concessoes ??= await deps.repos.concessoes.doAgente(input.agenteId);
    if (!concessoes.some((c) => c.conectorId === conector.id && c.capacidade === item.destino.ferramenta)) {
      throw new ErroDeDominio("nao_permitido", { cause: `sem concessão de ${conector.slug}.${item.destino.ferramenta}: peça com pedir_acesso` });
    }
    errosDeArgs.push(...errosDoSchema(capacidade.schema, item.destino.argumentos ?? {}, `itens[${idxItem}].destino.argumentos (${conector.slug}.${item.destino.ferramenta})`));
    let origemSensivel = false;
    if (CLASSIFICAR_ORIGEM_SENSIVEL && item.origem_conector) {
      const origem = await deps.repos.conectores.buscarPorSlug(item.origem_conector);
      // Origem desconhecida = fail-closed: trata como sensível (ADR-002: não declarou = toca).
      origemSensivel = origem ? conectorTocaDadoPessoal(origem) : true;
    }
    // ADR-048: carimbado na criação pelo plano JÁ PUXADO — a ferramenta que roda no gh do Mac deste
    // turno roda lá também quando aprovada; o agente não escolhe onde.
    const naMaquina = input.plano?.catalogo.ferramentas.some((f) => f.nome === `${conector.slug}__${item.destino.ferramenta}` && f.conectorId === conector.id && f.execucao === "maquina") === true;
    propostas.push({
      texto: item.texto,
      destino: { conector: conector.slug, ferramenta: item.destino.ferramenta, argumentos: item.destino.argumentos ?? {}, ...(naMaquina ? { execucao: "maquina" as const } : {}) },
      origemSensivel,
    });
    conectorIdPorIdx.push(conector.id);
    arriscadaPorIdx.push(acaoArriscadaNoApp(capacidade));
  }

  if (errosDeArgs.length > 0) return { data: { estado: "recusada", erros: errosDeArgs, instrucao: "corrija os argumentos e chame pedir_aprovacao de novo" }, events: [] };

  // ADR-052 (0033): turno que trouxe a web pelas nativas não usa "Sempre permitir" — a mesma regra do não confiável.
  const contaminado = input.plano ? await deps.repos.turnos.contaminado(input.turnoId) : false;
  const planoDoTurno = input.plano && contaminado ? { ...input.plano, confiancaEntrada: "nao_confiavel" as const } : input.plano ?? null;
  // ADR-062: as regras "Sempre permitir" de AGORA, não as congeladas no plano — o clique vale já neste turno.
  const plano = planoDoTurno ? { ...planoDoTurno, semprePermitir: await semprePermitirVivo(deps, input.agenteId, planoDoTurno) } : null;
  // ADR-059: o modo ATUAL do agente, não o do plano — trocar para mais restrito vale já na próxima ação.
  const modo = plano ? (await deps.repos.agentes.buscar(input.agenteId))?.modoAprovacao ?? "manual" : "manual";
  const { automatico, porItem } = decidirLote(propostas.map((p, idx) => ({ plano, destino: p.destino, origemSensivel: p.origemSensivel, modo, arriscada: arriscadaPorIdx[idx] === true })));

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

  if (!automatico) {
    await deps.repos.itensAprovacao.criarLote(
      decisao.id,
      itens.map((i, idx) => ({ idx: i.idx, texto: i.textoOriginal, destino: i.destino, origemSensivel: i.origemSensivel, justificativa: i.justificativa, motivoManual: motivoDe(porItem[idx]) })),
    );
    return { data: { estado: "pendente", decisao_id: decisao.id, instrucao: "encerre o turno; a decisão retoma depois" }, events: [eventoCriada(deps, input, decisao.id, itens, agora)] };
  }

  // Lote automático: executa ANTES de gravar o desfecho, como faz o caminho da pessoa (decidir.ts).
  const criados = await deps.repos.itensAprovacao.criarLote(
    decisao.id,
    itens.map((i) => ({ idx: i.idx, texto: i.textoOriginal, destino: i.destino, origemSensivel: i.origemSensivel, justificativa: i.justificativa })),
  );
  const rotina = (await rotinaDoTurno(deps.repos, input.turnoId)) !== null;
  const desfechos = await executarItens(deps.services, criados.map((item, idx) => ({ item, conectorId: conectorIdPorIdx[idx] ?? null, dono: deps.escopo, rotina })));
  for (const d of desfechos) await deps.repos.itensAprovacao.registrarDesfecho(d.itemId, d.desfecho);
  // decidida_por fica NULO: nenhuma PESSOA decidiu. Quem decidiu está em decidido_por da autoria,
  // com a versão da regra (ADR-023: autoria não se infere de outro campo).
  // A regra que MAIS concede manda no registro: se a pessoa criou uma permissão, é ela que
  // responde "sob que autoridade isto saiu?", mesmo que outros itens tenham passado por leitura.
  // ADR-059: o modo do bot concede mais que a regra por ferramenta — total, depois automático, depois a permanente.
  const quemMaisConcede = [REGRA_MODO_TOTAL, REGRA_MODO_AUTOMATICO, REGRA_APROVACAO_PERMANENTE]
    .map((r) => porItem.find((d) => d.automatico && d.regra === r))
    .find((d) => d !== undefined);
  const regra = quemMaisConcede?.automatico ? quemMaisConcede.regra : primeiraRegra(porItem);
  const regraVersao = quemMaisConcede?.automatico ? quemMaisConcede.versao : primeiraVersao(porItem);
  await deps.repos.decisoes.fecharPorRegra(decisao.id, { regra, regraVersao, agora });
  // ADR-048: item que roda no gh do Mac (servidor compartilhado) ainda não tem desfecho: o turno espera
  // pelo long-poll de `aguardar` enquanto o app desktop da pessoa executa; a fala "Fiz sem perguntar"
  // sai quando o Mac relatar (itens-na-maquina.ts).
  if (criados.some((i) => i.selecionado && i.destino.execucao === "maquina" && !desfechos.some((d) => d.itemId === i.id))) {
    return { data: { estado: "pendente", decisao_id: decisao.id, instrucao: "encerre o turno; a decisão retoma depois" }, events: [] };
  }

  const autoria = autoriaDoAgente(deps.escopo, input.agenteId, { decididoPor: regra, regraVersao });
  const mensagem = await deps.repos.mensagens.criar({
    conversaId: input.conversaId,
    turnoId: input.turnoId,
    kind: "resultado_aprovacao",
    texto: textoAutomatico(criados, desfechos, regra),
    confianca: "confiavel",
    autoria,
  });

  const evento: RuntimeEvent = {
    tenantId: deps.escopo.tenantId,
    id: randomUUID(),
    createdAt: agora,
    kind: "mensagem_criada",
    autoria,
    pessoaDestinoId: deps.escopo.pessoaId,
    conversaId: input.conversaId,
    turnoId: input.turnoId,
    dados: { decisao_id: decisao.id, mensagem_id: mensagem?.id ?? null, itens: criados.length, executados: desfechos.filter((d) => d.desfecho === "executado").length },
  };
  return {
    data: { estado: "decidida", itens: desfechos.map((d, idx) => ({ idx, desfecho: d.desfecho })) },
    events: [evento],
  };
};

const motivoDe = (d: DecisaoAutomatica | undefined): MotivoAprovacaoManual | null => (d && !d.automatico ? d.motivo : null);
const primeiraRegra = (ds: readonly DecisaoAutomatica[]): `regra:${string}` => {
  const a = ds.find((d) => d.automatico);
  return a?.automatico ? a.regra : REGRA_APROVACAO_PERMANENTE;
};
const primeiraVersao = (ds: readonly DecisaoAutomatica[]): number => {
  const a = ds.find((d) => d.automatico);
  return a?.automatico ? a.versao : 1;
};

/** ADR-059: o modo que aprovou vai na fala, para quem lê de manhã saber por que nada pediu clique. */
const PELO_MODO: Readonly<Record<string, string>> = {
  [REGRA_MODO_AUTOMATICO]: " · aprovação automática",
  [REGRA_MODO_TOTAL]: " · sem aprovações",
};

/** Fala na conversa do que saiu sem perguntar: "precisa ficar no chat" foi requisito explícito. */
export function textoAutomatico(itens: readonly ItemAprovacao[], desfechos: readonly { itemId: string; desfecho: DesfechoItem }[], regra?: string): string {
  const linhas = itens.map((i) => {
    const d = desfechos.find((x) => x.itemId === i.id)?.desfecho ?? "falhou_na_execucao";
    return `- ${i.textoFinal} (${i.destino.conector}.${i.destino.ferramenta}): ${d.replaceAll("_", " ")}`;
  });
  return `Fiz sem perguntar (${itens.length === 1 ? "1 ação" : `${itens.length} ações`})${(regra && PELO_MODO[regra]) ?? ""}:\n${linhas.join("\n")}`;
}

function eventoCriada(deps: Deps, input: { agenteId: string; conversaId: string; turnoId: string }, decisaoId: string, itens: readonly ItemAprovacao[], agora: number): RuntimeEvent {
  return {
    tenantId: deps.escopo.tenantId,
    id: randomUUID(),
    createdAt: agora,
    kind: "decisao_criada",
    autoria: autoriaDoAgente(deps.escopo, input.agenteId),
    pessoaDestinoId: deps.escopo.pessoaId,
    conversaId: input.conversaId,
    turnoId: input.turnoId,
    dados: { decisao_id: decisaoId, tipo: "aprovacao", itens: itens.length, sensiveis: itens.filter((i) => i.origemSensivel).length },
  };
}

export const pedirAprovacao = montarPedido(false);
export const pedirAprovacaoComputador = montarPedido(true);
