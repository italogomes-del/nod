import type { Decisao } from "../../contracts/decisao.ts";
import { ehErroDeDominio } from "../../domain/erro.ts";
import { redigir } from "../../domain/redacao.ts";
import { log } from "../../obs/log.ts";
import { metricas as registroPadrao, type Metricas } from "../../obs/metricas.ts";
import { criarRepos } from "../../repositories/index.ts";
import type { Db, Escopo, Relogio, Transacao } from "../../shared/types.ts";
import { autoriaPessoa, carimbo, evento } from "../../use-cases/apoio-l7.ts";
import { vencerPedidoDaRotina } from "../../use-cases/decidir-acesso.ts";
import { expirarItensNaMaquina } from "../../use-cases/itens-na-maquina.ts";
import { registrarDesfechoRotina, TIPOS_GATE_ROTINA, TIPOS_QUE_SEGURAM_A_EXECUCAO } from "../../use-cases/disparar-rotina.ts";
import type { Deps, Services, UseCasesNod } from "../../use-cases/tipos.ts";
import { paraCadaPessoa, type OpcoesLaco } from "./escopos-de-fundo.ts";

/** definido em 2026-09-16: 30 s — a spec aceita "em ≤30s" para o vencimento aparecer (fluxo SUA VEZ E EXPIRAÇÃO). */
export const INTERVALO_VARREDOR_MS = 30_000;

export type OpcoesVarredor = { services: Services; useCases: UseCasesNod; agora: Relogio; metricas?: Metricas };
/** `pausadas` (definido em 2026-09-24, emenda da ADR-044): rotinas cujo pedido de acesso venceu. */
export type ResultadoVarredura = { vencidas: string[]; mensagens: number; passaramEmBranco: string[]; pausadas: string[] };

/**
 * definido em 2026-09-24: o que o desfecho quer dizer, em palavras — as mesmas do rótulo do card
 * vencido (web/telas/sua-vez.ts, rotuloVencido). Os VALORES da métrica (ADR-017 #2) não mudam.
 */
const DESFECHO_HUMANO: Readonly<Record<string, string>> = {
  expirou_sem_ninguem_ver: "ninguém chegou a ver",
  expirou_com_alguem_ciente: "alguém viu, mas ninguém respondeu",
};

/**
 * Varredura de UMA pessoa (E7.4, ADR-007/011): vencerPendentes escreve 'vencida' com o desfecho
 * que diz se alguém VIU (vista_em) → marcarVarrida(id, 'vencida') ON CONFLICT — só quem inseriu
 * escreve a mensagem com carimbo na conversa de origem e o evento (rodar duas vezes = uma
 * mensagem). Gate de rotina vencido (gate_rotina ou aprovacao ligada ao turno da rotina) → execução 'passou_em_branco' com motivo tipado
 * 'ninguem_respondeu_o_gate' e a frase "nada foi enviado" (E7.5), zero efeito externo. O atraso
 * (agora − prazo) vai ao log: é como se observa um varredor que ficou parado (E7.4.3).
 */
export async function varrerPessoa(escopo: Escopo, tx: Transacao, opcoes: OpcoesVarredor): Promise<ResultadoVarredura> {
  const agora = opcoes.agora();
  return tx(async (trx) => {
    const repos = criarRepos(trx, escopo);
    const deps: Deps = { repos, services: opcoes.services, useCases: opcoes.useCases, tx, escopo, agora: opcoes.agora };
    const resultado: ResultadoVarredura = { vencidas: [], mensagens: 0, passaramEmBranco: [], pausadas: [] };
    const vencidas: Decisao[] = await repos.decisoes.vencerPendentes(agora);
    for (const d of vencidas) {
      resultado.vencidas.push(d.id);
      if (!(await repos.decisoes.marcarVarrida(d.id, "vencida"))) continue;
      const tipoDesfecho = d.desfecho?.tipo ?? "expirou_sem_ninguem_ver";
      // ADR-017 #2: uma expiração por decisão vencida, rotulada pela causa que o repo devolveu (pendência L8 §4).
      if (tipoDesfecho === "expirou_sem_ninguem_ver" || tipoDesfecho === "expirou_com_alguem_ciente") {
        (opcoes.metricas ?? registroPadrao).incrementar({ metrica: "expiracao", causa: tipoDesfecho, tenant_id: escopo.tenantId });
      }
      const autoria = autoriaPessoa(escopo.pessoaId, "regra:varredor-expiracao");
      // definido em 2026-09-24 (emenda da ADR-044): o pedido de acesso de uma rotina que vence pausa a
      // rotina, e a linha da pausa ("ninguém liberou o acesso ao Gmail em 24h") substitui a de vencimento.
      const pedidoDaRotina = await vencerPedidoDaRotina(deps, d);
      if (pedidoDaRotina.pausada) {
        resultado.pausadas.push(pedidoDaRotina.pausada.id);
      } else {
        await repos.mensagens.criar({
          conversaId: d.conversaId,
          turnoId: d.turnoId,
          autoria,
          kind: "sistema",
          texto: redigir("decisao-vencida", agora, { quando: carimbo(agora), desfecho: DESFECHO_HUMANO[tipoDesfecho] ?? tipoDesfecho }),
          confianca: "confiavel",
        });
      }
      resultado.mensagens += 1;
      const events = [evento(deps, "decisao_vencida", autoria, { decisaoId: d.id, tipo: d.tipo, desfecho: tipoDesfecho, atrasoMs: agora - Date.parse(d.prazoDecisaoEm) }, { conversaId: d.conversaId, turnoId: d.turnoId }), ...pedidoDaRotina.events];
      // Gate de rotina = gate_rotina OU aprovacao ligada a um turno de rotina (TIPOS_GATE_ROTINA); se o
      // turno não é de rotina, registrarDesfechoRotina devolve 'nao_e_rotina' e nada mais acontece.
      // definido em 2026-09-24 (fio da pergunta): a pergunta vencida também fecha a janela — a execução
      // esperava por ela (TIPOS_QUE_SEGURAM_A_EXECUCAO) e não entregou.
      if (TIPOS_QUE_SEGURAM_A_EXECUCAO.has(d.tipo) && d.turnoId) {
        const motivo = TIPOS_GATE_ROTINA.has(d.tipo) ? "ninguem_respondeu_o_gate" : "pergunta_sem_resposta";
        const r = await registrarDesfechoRotina(deps, { turnoId: d.turnoId, desfecho: "passou_em_branco", motivo });
        if ("execucao" in r.data) {
          resultado.passaramEmBranco.push(r.data.rotina.id);
          resultado.mensagens += 1;
          events.push(...(r.events ?? []));
        }
      }
      await repos.events.gravarComOutbox(events);
      log("info", "decisao_vencida_varrida", { decisao_id: d.id, tipo: d.tipo, desfecho: tipoDesfecho, atraso_ms: agora - Date.parse(d.prazoDecisaoEm) });
    }
    // ADR-048: item aprovado que o Mac da dona não buscou no prazo vira falha e a decisão fecha.
    const noMac = await expirarItensNaMaquina(deps);
    if (noMac.events.length) await repos.events.gravarComOutbox(noMac.events);
    if (noMac.expirados > 0) log("info", "itens_na_maquina_expirados", { quantos: noMac.expirados });
    return resultado;
  });
}

export async function varrer(db: Db, opcoes: OpcoesVarredor, laco: OpcoesLaco = {}): Promise<void> {
  await paraCadaPessoa(
    db,
    async (escopo, tx) => {
      try {
        await varrerPessoa(escopo, tx, opcoes);
      } catch (e) {
        log("erro", "varredura_falhou", { erro: ehErroDeDominio(e) ? e.codigo : e instanceof Error ? e.name : "desconhecido" });
        throw e;
      }
    },
    laco,
  );
}

export function iniciarVarredorExpiracao(db: Db, opcoes: OpcoesVarredor & { intervaloMs?: number }, laco: OpcoesLaco = {}): { parar(): void } {
  let rodando = false;
  const timer = setInterval(() => {
    if (rodando) return;
    rodando = true;
    varrer(db, opcoes, laco)
      .catch((e: unknown) => log("erro", "varredor_tick_falhou", { erro: e instanceof Error ? e.name : "desconhecido" }))
      .finally(() => {
        rodando = false;
      });
  }, opcoes.intervaloMs ?? INTERVALO_VARREDOR_MS);
  timer.unref();
  return { parar: () => clearInterval(timer) };
}
