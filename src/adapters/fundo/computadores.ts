import { randomUUID } from "node:crypto";
import type { AcaoComputador, Computador, ComputadorDto, DriverComputador, ResultadoComputador } from "../../contracts/computador.ts";
import { FERRAMENTAS_COMPUTADOR } from "../../contracts/ferramentas-computador.ts";
import type { PlanoTurno } from "../../contracts/plano-turno.ts";
import { alteraComputador, resumoAcaoComputador, validarAcaoComputador } from "../../domain/computador.ts";
import { ErroDeDominio } from "../../domain/erro.ts";
import type { Escopo } from "../../shared/types.ts";
import { errosDoSchema, type ResultadoChamada } from "../../use-cases/chamar-ferramenta.ts";
import { pedirAprovacaoComputador } from "../../use-cases/pedir-aprovacao.ts";
import { pedirAPessoa } from "../../use-cases/pedir-a-pessoa.ts";
import { registrarNegacao } from "../../use-cases/registrar-negacao.ts";
import { fecharComResposta, retomarComResposta } from "../../use-cases/responder-decisao.ts";
import type { Deps } from "../../use-cases/tipos.ts";

type Dentro = <T>(escopo: Escopo, fn: (d: Deps) => Promise<T>) => Promise<T>;
type Opcoes = { executor(): "local" | "catcher"; dentro: Dentro; driver: DriverComputador; cifrar(s: string): string; decifrar(s: string): string; mudou(escopo: Escopo, agenteId: string): void };
type Reserva = { computador: Computador; operacao: string; acao: AcaoComputador; registroId: string; turnoId?: string; aprovado: boolean };

// definido em 2026-09-18: reserva confirmada ANTES do efeito; watchdog do runtime encerra em 55 s.
const LEASE_MS = 300_000;
async function obter(d: Deps, agenteId: string): Promise<Computador> {
  const c = await d.repos.computadores.obter(agenteId);
  if (!c) throw new ErroDeDominio("nao_encontrado");
  return (await d.repos.computadores.travar(c.id))!;
}
function livre(c: Computador, agora: number): void {
  if (c.ocupadoAte && c.ocupadoAte > agora) throw new ErroDeDominio("estado_invalido");
}
async function reservar(d: Deps, c: Computador, acao: AcaoComputador, autor: "bot" | "pessoa", turnoId?: string, registroId?: string): Promise<Reserva> {
  livre(c, d.agora());
  const operacao = randomUUID();
  const registro = registroId ?? (await d.repos.computadores.registrar({ computadorId: c.id, turnoId, autor, tipo: acao.tipo, estado: "executando" })).id;
  if (registroId) await d.repos.computadores.concluir(registroId, "executando");
  await d.repos.computadores.ocupar(c.id, operacao, d.agora() + LEASE_MS);
  return { computador: c, operacao, acao, registroId: registro, turnoId, aprovado: Boolean(registroId) };
}
async function turnoPermitido(d: Deps, turnoId: string, agenteId: string, aprovado = false): Promise<boolean> {
  const t = await d.repos.turnos.buscar(turnoId);
  return Boolean(t && (aprovado || (t.prazoEm > d.agora() && t.estado !== "concluido" && t.estado !== "interrompido")) && t.agenteId === agenteId && t.ownerId === d.escopo.pessoaId && !t.pararSolicitadoEm &&
    t.motivoInterrupcao !== "parado_pela_pessoa" && !(await d.repos.agentes.execucaoBloqueada(turnoId)) &&
    await d.repos.paradas.ativa(d.escopo.pessoaId, t.conversaId) === false);
}

export function criarComputadores(o: Opcoes) {
  async function executar(escopo: Escopo, r: Reserva): Promise<ResultadoComputador> {
    let estado: "concluida" | "falhou" = "falhou";
    try {
      await o.driver.iniciar(r.computador.id);
      const estadoAtual = await o.dentro(escopo, async d => {
        const c = await d.repos.computadores.travar(r.computador.id);
        const agente = c ? await d.repos.agentes.buscar(c.agenteId) : null;
        return { desligar: !c?.habilitado || !agente, permitido: Boolean(c?.habilitado && c.controle === r.computador.controle && c.operacaoId === r.operacao && c.ocupadoAte && c.ocupadoAte > d.agora() && agente && (!r.turnoId || await turnoPermitido(d, r.turnoId, c.agenteId, r.aprovado))) };
      });
      if (!estadoAtual.permitido) { if (estadoAtual.desligar) await o.driver.parar(r.computador.id); throw new ErroDeDominio("nao_permitido"); }
      const resultado = await o.driver.executar(r.computador.id, r.acao);
      estado = resultado.codigoSaida !== undefined && resultado.codigoSaida !== 0 ? "falhou" : "concluida";
      return resultado;
    } finally {
      await o.dentro(escopo, async (d) => {
        await d.repos.computadores.travar(r.computador.id);
        await d.repos.computadores.concluir(r.registroId, estado);
        await d.repos.computadores.liberar(r.computador.id, r.operacao);
      });
      o.mudou(escopo, r.computador.agenteId);
    }
  }
  return {
    async desligarExcluido(escopo: Escopo, agenteId: string): Promise<void> {
      const c = await o.dentro(escopo, async d => {
        const agente = await d.repos.agentes.buscar(agenteId, true);
        if (!agente?.excluidoEm || agente.ownerId !== escopo.pessoaId) throw new ErroDeDominio("nao_permitido");
        const c = await d.repos.computadores.buscarVinculo(agenteId);
        if (c) await d.repos.computadores.configurar(c.id, { habilitado: false, controle: "pessoa" });
        return c;
      });
      if (c) await o.driver.parar(c.id);
      o.mudou(escopo, agenteId);
    },
    async consultar(escopo: Escopo, agenteId: string): Promise<ComputadorDto> {
      const c = await o.dentro(escopo, async (d) => {
        const computador = await obter(d, agenteId);
        return { computador, atividade: await d.repos.computadores.atividade(computador.id) };
      });
      return { ...c, ...await o.driver.estado(c.computador.id) };
    },
    async configurar(escopo: Escopo, agenteId: string, operacao: string): Promise<void> {
      const operacaoId = randomUUID();
      let registroId: string | undefined;
      const c = await o.dentro(escopo, async (d) => {
        const c = await obter(d, agenteId);
        if (operacao !== "parar") livre(c, d.agora());
        if (operacao === "assumir") await d.repos.computadores.configurar(c.id, { controle: "pessoa" });
        else if (operacao === "devolver") {
          await d.repos.computadores.configurar(c.id, { controle: "bot", ajuda: null, ajudaDecisaoId: null });
          if (c.ajudaDecisaoId) {
            const decisao = await d.repos.decisoes.buscar(c.ajudaDecisaoId);
            if (decisao && (decisao.estado === "pendente" || decisao.estado === "reaberta")) {
              const r = await fecharComResposta(d, { decisaoId: decisao.id, texto: "Concluí o passo no computador e devolvi o controle. Observe a tela e continue." });
              if (r.events?.length) await d.repos.events.gravarComOutbox(r.events);
              const retomada = await retomarComResposta(d, { decisao: r.data.decisao, texto: "Concluí o passo no computador e devolvi o controle. Observe a tela e continue.", respondidaPor: { id: escopo.pessoaId, nome: "A pessoa" }, executor: o.executor() });
              if (retomada.events?.length) await d.repos.events.gravarComOutbox(retomada.events);
            }
          }
        } else if (operacao === "supervisionado" || operacao === "autonomo") await d.repos.computadores.configurar(c.id, { politica: operacao });
        else if (operacao === "parar") await d.repos.computadores.configurar(c.id, { habilitado: false, controle: "pessoa" });
        else if (operacao === "iniciar") await d.repos.computadores.configurar(c.id, { habilitado: true });
        else throw new ErroDeDominio("entrada_invalida");
        if (operacao === "iniciar") await d.repos.computadores.ocupar(c.id, operacaoId, d.agora() + LEASE_MS);
        registroId = (await d.repos.computadores.registrar({ computadorId: c.id, autor: "pessoa", tipo: operacao, estado: operacao === "iniciar" || operacao === "parar" ? "executando" : "concluida" })).id;
        return c;
      });
      let sucesso = false;
      try {
        if (operacao === "iniciar") {
          await o.driver.iniciar(c.id);
          const habilitado = await o.dentro(escopo, async d => (await d.repos.computadores.travar(c.id))?.habilitado);
          if (!habilitado) { await o.driver.parar(c.id); throw new ErroDeDominio("estado_invalido"); }
        }
        if (operacao === "parar") await o.driver.parar(c.id);
        sucesso = true;
      } finally {
        await o.dentro(escopo, async d => {
          if (operacao === "iniciar") await d.repos.computadores.liberar(c.id, operacaoId);
          if (registroId) await d.repos.computadores.concluir(registroId, sucesso ? "concluida" : "falhou");
        });
        o.mudou(escopo, agenteId);
      }
    },
    async humano(escopo: Escopo, agenteId: string, valor: unknown): Promise<ResultadoComputador> {
      const acao = validarAcaoComputador(valor);
      const r = await o.dentro(escopo, async (d) => {
        const c = await obter(d, agenteId);
        if (!c.habilitado || (acao.tipo !== "observar" && acao.tipo !== "arquivos" && acao.tipo !== "ler_arquivo" && acao.tipo !== "ler_texto" && acao.tipo !== "audio" && c.controle !== "pessoa")) throw new ErroDeDominio("nao_permitido");
        return reservar(d, c, acao, "pessoa");
      });
      return executar(escopo, r);
    },
    async chamar(escopo: Escopo, plano: PlanoTurno, nome: string, argumentos: unknown): Promise<ResultadoChamada> {
      const resultado = await o.dentro(escopo, async (d): Promise<ResultadoChamada | Reserva> => {
        const negar = async (motivo: "parada_ativa" | "fora_do_catalogo" | "args_invalidos" | "capacidade_desligada" | "plano_expirado") => {
          const n = await registrarNegacao(d, { turnoId: plano.turnoId, agenteId: plano.agenteId, conversaId: plano.conversaId, nome, motivo, classe: "ferramenta_negada", autoria: plano.autoria });
          if (n.events?.length) await d.repos.events.gravarComOutbox(n.events);
          return { ok: false as const, negacao: n.data };
        };
        if (plano.tenantId !== escopo.tenantId || plano.autoria.conta_de_execucao !== escopo.pessoaId || !plano.catalogo.ferramentas.some((f) => f.nome === nome && f.origem === "computador")) return negar("fora_do_catalogo");
        if (plano.expiraEm <= d.agora()) return negar("plano_expirado");
        if (!await turnoPermitido(d, plano.turnoId, plano.agenteId)) return negar("parada_ativa");
        const schema = FERRAMENTAS_COMPUTADOR[nome as keyof typeof FERRAMENTAS_COMPUTADOR];
        if (!schema || errosDoSchema(schema, argumentos).length) return negar("args_invalidos");
        const c = await obter(d, plano.agenteId);
        if (!c.habilitado) return negar("capacidade_desligada");
        if (c.controle !== "bot") return { ok: true, conteudo: JSON.stringify({ estado: "aguardando_pessoa", instrucao: "A pessoa está com o computador. Encerre o turno e aguarde a devolução." }), confianca: "confiavel" };
        const args = argumentos as Record<string, unknown>;
        if (nome === "computador_pedir_ajuda") {
          livre(c, d.agora());
          const motivo = String(args.motivo).slice(0, 1000);
          const ajuda = await pedirAPessoa(d, { turnoId: plano.turnoId, agenteId: plano.agenteId, conversaId: plano.conversaId, tipo: "pergunta", texto: `Abra meu computador para concluir este passo: ${motivo}. Use Assumir controle; depois, Devolver ao bot. Não envie senha ou código aqui.` });
          await d.repos.computadores.configurar(c.id, { controle: "aguardando_pessoa", ajuda: motivo, ajudaDecisaoId: ajuda.data.decisao_id });
          if (ajuda.events?.length) await d.repos.events.gravarComOutbox(ajuda.events);
          await d.repos.computadores.registrar({ computadorId: c.id, turnoId: plano.turnoId, autor: "bot", tipo: "pedir_ajuda", estado: "concluida" });
          return { ok: true, conteudo: JSON.stringify(ajuda.data), confianca: "confiavel" };
        }
        let acao: AcaoComputador;
        try { acao = validarAcaoComputador({ ...args, ...(nome !== "computador_interagir" ? { tipo: nome.slice(11) } : {}), ...(nome === "computador_arquivos" ? { caminho: args.caminho ?? "." } : {}) }); }
        catch { return negar("args_invalidos"); }
        if (alteraComputador(acao) && (c.politica === "supervisionado" || plano.politicaExecucao.efeitoExternoSoPorAprovacao)) {
          const registro = await d.repos.computadores.registrar({ computadorId: c.id, turnoId: plano.turnoId, autor: "bot", tipo: acao.tipo, estado: "pendente", argumentosCifrados: o.cifrar(JSON.stringify(acao)) });
          const pedido = await pedirAprovacaoComputador(d, { turnoId: plano.turnoId, agenteId: plano.agenteId, conversaId: plano.conversaId, resumo: "Ação no computador do bot", itens: [{ texto: resumoAcaoComputador(acao), destino: { conector: "computador", ferramenta: "executar", argumentos: { acaoId: registro.id } } }] });
          if (pedido.events?.length) await d.repos.events.gravarComOutbox(pedido.events);
          if (pedido.data.estado !== "pendente") throw new ErroDeDominio("estado_invalido");
          return { aguardar: pedido.data.decisao_id };
        }
        return reservar(d, c, acao, "bot", plano.turnoId);
      });
      o.mudou(escopo, plano.agenteId);
      if (!("operacao" in resultado)) return resultado;
      try {
        const r = await executar(escopo, resultado);
        const imagem = r.tela?.imagem;
        return { ok: true, isError: r.codigoSaida !== undefined && r.codigoSaida !== 0, conteudo: JSON.stringify({ ...r, audio: undefined, ...(r.tela ? { tela: { ...r.tela, imagem: undefined } } : {}) }), confianca: "nao_confiavel", ...(r.audio ? { audio: r.audio } : {}), ...(imagem ? { imagem: { mimeType: "image/png" as const, data: imagem } } : {}) };
      } catch {
        return { ok: true, isError: true, conteudo: JSON.stringify({ erro: "computador_indisponivel_ou_tela_alterada", instrucao: nome === "computador_ler_texto" || nome === "computador_gravar_texto" ? "A operação de texto falhou. Confira caminho, tamanho, UTF-8 e revisão; releia o arquivo antes de editar. Não afirme que gravou." : "A ação falhou. Observe a tela antes de tentar novamente; não afirme que executou." }), confianca: "confiavel" };
      }
    },
    async executarAprovado(p: Escopo & { agenteId: string; turnoId: string; acaoId: string }): Promise<void> {
      const r = await o.dentro(p, async (d) => {
        const c = await obter(d, p.agenteId);
        if (!c.habilitado || c.controle !== "bot" || !await turnoPermitido(d, p.turnoId, p.agenteId, true)) throw new ErroDeDominio("nao_permitido");
        const a = await d.repos.computadores.buscarAcao(p.acaoId);
        if (!a || a.computadorId !== c.id || a.turnoId !== p.turnoId || a.estado !== "pendente" || !a.argumentosCifrados) throw new ErroDeDominio("estado_invalido");
        const acao = validarAcaoComputador(JSON.parse(o.decifrar(a.argumentosCifrados)));
        return reservar(d, c, acao, "bot", p.turnoId, a.id);
      });
      const resultado = await executar(p, r);
      if (resultado.codigoSaida !== undefined && resultado.codigoSaida !== 0) throw new ErroDeDominio("estado_invalido");
    },
  };
}
export type Computadores = ReturnType<typeof criarComputadores>;
