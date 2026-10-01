import type { Concessao } from "../contracts/concessao.ts";
import type { Proposta } from "../contracts/conversa.ts";
import type { RuntimeEvent } from "../contracts/evento.ts";
import type { MotivoBloqueioRotina } from "../contracts/motivos.ts";
import { TIPOS_PEDIDO_A_PESSOA } from "../contracts/pedido.ts";
import type { BloqueioRotina, ParadaDaRotina, Rotina } from "../contracts/rotina.ts";
import type { TipoDecisao } from "../contracts/decisao.ts";
import { acaoArriscadaNoApp } from "../domain/aprovacao-permanente.ts";
import { decidirPeloModo } from "../domain/modo-aprovacao.ts";
import { nomeDoApp } from "../domain/pedido-acesso.ts";
import { faltaDeAcesso, janelasQueNaoRodaram, necessidadesDaRotina, type ConectorRegistrado, type NecessidadeDaRotina } from "../domain/rotina-acessos.ts";
import type { Repos } from "../repositories/tipos.ts";
import { autoriaPessoa, rotinaDoTurno } from "./apoio-l7.ts";
import { semCard } from "./confirmar-pelo-modo.ts";
import { decidirAcesso } from "./decidir-acesso.ts";
import { garantirPedidoDeAcesso } from "./garantir-pedido-de-acesso.ts";
import type { Deps } from "./tipos.ts";

/** definido em 2026-09-24 (emenda da ADR-044): a regra que para a janela e abre o card, sem pessoa. */
export const REGRA_PRE_VOO = "regra:pre-voo-rotina" as const;

const PEDIDO_A_PESSOA: ReadonlySet<TipoDecisao> = new Set<TipoDecisao>(TIPOS_PEDIDO_A_PESSOA);

/**
 * O que a rotina precisa AGORA: o que ela declara ou cita na fonte (necessidadesDaRotina) e, além disso,
 * o que um turno dela já pediu por pedir_acesso e segue aberto — a rotina que pediu o Slack no meio da
 * execução falharia igual na próxima janela. Para um app que a fonte já cita vale a necessidade da fonte;
 * o card só acrescenta os apps que ela não cita. Um card cujo pedido já foi atendido por outro caminho (a
 * pessoa concedeu na tela Conectores) não trava nada: faltaDeAcesso o dá por satisfeito.
 */
async function necessidadesAtuais(repos: Repos, rotina: Rotina, registrados: readonly ConectorRegistrado[]): Promise<NecessidadeDaRotina[]> {
  const base = necessidadesDaRotina(rotina, registrados);
  const citados = new Set(base.map((n) => n.slug));
  const dosCards: NecessidadeDaRotina[] = [];
  for (const p of await repos.propostas.pendentesDeAcessoDaRotina(rotina.id)) {
    if (p.payload.kind !== "acesso" || citados.has(p.payload.conector)) continue;
    citados.add(p.payload.conector);
    const slug = p.payload.conector;
    dosCards.push({ slug, conector: registrados.find((c) => c.slug === slug) ?? null, capacidades: p.payload.conectar ? null : p.payload.capacidades });
  }
  return [...base, ...dosCards].sort((a, b) => a.slug.localeCompare(b.slug));
}

/** A pergunta de pedir_a_pessoa que um turno desta rotina fez e ainda espera (o fio da pergunta, #58). */
async function perguntaAbertaDaRotina(repos: Repos, rotina: Rotina): Promise<boolean> {
  for (const d of await repos.decisoes.pendentesDaConversa(rotina.conversaId)) {
    if (!PEDIDO_A_PESSOA.has(d.tipo) || d.turnoId === null) continue;
    if ((await rotinaDoTurno(repos, d.turnoId))?.rotina.id === rotina.id) return true;
  }
  return false;
}

export type BloqueioDoPreVoo = { motivo: MotivoBloqueioRotina; propostaId: string | null; events: RuntimeEvent[] };

/**
 * Pré-voo da rotina (definido em 2026-09-24, emenda da ADR-044, "rotina se trava sozinha"): antes de
 * enfileirar o turno — e de gastar um turno de modelo —, o servidor confere o que ele mesmo sabe:
 * 1. falta conexão ou acesso a um app que a rotina precisa → garante UM card por (agente, app) e para;
 * 2. só no agendador: a pergunta da execução anterior ainda espera → para (o fio segura a janela, #58).
 * Trava (agente, conector) de cada app necessário, em ordem, antes de ler as concessões: o clique que
 * concede trava o mesmo par, e assim um tick nunca abre card para um acesso que acabou de ser dado.
 */
export async function preVooDaRotina(deps: Deps, rotina: Rotina, opcoes: { agendada: boolean }): Promise<BloqueioDoPreVoo | null> {
  const registrados = await deps.repos.conectores.listar();
  const necessidades = await necessidadesAtuais(deps.repos, rotina, registrados);
  for (const id of [...new Set(necessidades.flatMap((n) => (n.conector ? [n.conector.id] : [])))].sort()) await deps.repos.concessoes.travar(rotina.agenteId, id);
  // ADR-066: cada app que falta e que o modo concede sai do caminho; o primeiro que ele não concede para a janela.
  for (let i = 0; i <= necessidades.length; i++) {
    const bloqueio = await faltaOuConcede(deps, rotina, necessidades);
    if (bloqueio !== "concedido") return bloqueio ?? (opcoes.agendada && (await perguntaAbertaDaRotina(deps.repos, rotina)) ? { motivo: "aguardando_resposta", propostaId: null, events: [] } : null);
  }
  return null;
}

/**
 * O primeiro app que falta: card aberto (garantido) e bloqueio; ou "concedido", quando o modo do bot concede na hora;
 * ou null, quando nada falta. revisto em 2026-10-01 (ADR-066): no automático e no total o pré-voo concede como o
 * turno já concedia — antes era o único lugar em que o total ainda esperava um clique, e cada janela saía bloqueada.
 * Conectar um app (login) continua sendo da pessoa. O que é "Apagar e desfazer" para no automático, como no turno.
 */
async function faltaOuConcede(deps: Deps, rotina: Rotina, necessidades: readonly NecessidadeDaRotina[]): Promise<BloqueioDoPreVoo | "concedido" | null> {
  const falta = faltaDeAcesso(necessidades, await deps.repos.concessoes.doAgente(rotina.agenteId));
  if (falta) {
    const g = await garantirPedidoDeAcesso(deps, {
      agenteId: rotina.agenteId,
      conversaId: rotina.conversaId,
      rotinaId: rotina.id,
      instrucaoDaRotina: rotina.instrucao,
      slug: falta.necessidade.slug,
      conector: falta.necessidade.conector,
      conectar: falta.motivo === "sem_conexao",
      capacidades: falta.necessidade.capacidades,
      turnoId: null,
      autoria: autoriaPessoa(deps.escopo.pessoaId, REGRA_PRE_VOO),
    });
    const p = g.proposta.payload;
    if (falta.motivo !== "sem_conexao" && falta.necessidade.conector && g.decisao && (g.decisao.estado === "pendente" || g.decisao.estado === "reaberta") && p.kind === "acesso" && !p.conectar) {
      const catalogo = falta.necessidade.conector.catalogo;
      const arriscada = p.capacidades.some((nome) => {
        const cap = catalogo.find((c) => c.nome === nome);
        return cap ? acaoArriscadaNoApp(cap) : true;
      });
      const d = decidirPeloModo((await deps.repos.agentes.buscar(rotina.agenteId))?.modoAprovacao, { arriscada, credencial: false });
      if (d?.automatico) {
        const r = await decidirAcesso(deps, { decisaoId: g.decisao.id, recusar: false, executor: "catcher", porRegra: { regra: d.regra, regraVersao: d.versao }, semDisparar: true });
        // O disparo segue no mesmo passo e só devolve os eventos do turno: estes vão direto ao outbox (como no computador).
        const eventos = [...semCard(g.events), ...(r.events ?? [])];
        if (eventos.length) await deps.repos.events.gravarComOutbox(eventos);
        return "concedido";
      }
    }
    return { motivo: falta.motivo, propostaId: g.proposta.id, events: g.events };
  }
  return null;
}

/**
 * A parada que o card de acesso mostra: as janelas 'bloqueada' seguidas até agora e, desde a primeira
 * delas, a rotina está parada; sem nenhuma (o card nasceu de pedir_acesso num turno), desde o card.
 */
export async function paradaDoPedido(repos: Pick<Repos, "rotinas" | "rotinaExecucoes">, proposta: Proposta): Promise<ParadaDaRotina | null> {
  if (proposta.payload.kind !== "acesso" || !proposta.payload.rotinaId) return null;
  const rotina = await repos.rotinas.buscar(proposta.payload.rotinaId);
  const naoRodaram = rotina ? janelasQueNaoRodaram(await repos.rotinaExecucoes.listar(rotina.id)) : [];
  return { desde: naoRodaram.at(-1) ?? proposta.criadoEm, naoRodaram, fusoIana: rotina?.fusoIana ?? "UTC" };
}

/**
 * A rotina parada como a lista de rotinas mostra (RotinaDto.bloqueio): falta conexão ou acesso E há um
 * card aberto para o app — é o card que dá o botão. Sem card (a rotina ainda não rodou desde que o
 * acesso sumiu, ou o card venceu e a pausou), não há parada a mostrar: a próxima janela abre o card.
 * Só lê: não trava nem cria nada.
 */
export async function bloqueioDaRotina(repos: Repos, rotina: Rotina, registrados: readonly ConectorRegistrado[], concessoes: readonly Pick<Concessao, "conectorId" | "capacidade">[]): Promise<BloqueioRotina | null> {
  const falta = faltaDeAcesso(await necessidadesAtuais(repos, rotina, registrados), concessoes);
  if (!falta) return null;
  const card = await repos.propostas.acessoDeRotinaAberto(rotina.agenteId, falta.necessidade.slug);
  if (card?.payload.kind !== "acesso") return null;
  let decisaoId: string | null = null;
  if (!card.payload.conectar) {
    const decisao = await repos.decisoes.buscar(card.id);
    if (!decisao || (decisao.estado !== "pendente" && decisao.estado !== "reaberta")) return null;
    decisaoId = decisao.id;
  }
  const naoRodaram = janelasQueNaoRodaram(await repos.rotinaExecucoes.listar(rotina.id));
  return {
    motivo: falta.motivo,
    app: nomeDoApp(falta.necessidade.slug, falta.necessidade.conector?.nome),
    slug: falta.necessidade.slug,
    decisaoId,
    rodaNaHora: card.payload.rotinaId === rotina.id,
    desde: naoRodaram.at(-1) ?? card.criadoEm,
    naoRodaram,
    fusoIana: rotina.fusoIana,
  };
}
