import { randomUUID } from "node:crypto";
import type { AcaoComputador, AmbienteComputador, DriverComputador, ResultadoComputador } from "../../contracts/computador.ts";
import type { ComandoComputador, ResultadoComandoComputador, TipoComandoComputador } from "../../contracts/computador-motor.ts";
import type { UsoDoMac } from "../../contracts/raio-x.ts";
import type { VmLocalAnunciada } from "../../contracts/vm-local.ts";
import { escolherMaquina, type MaquinaCandidata, motivoParaFicarAcordada, PRAZO_COMANDO_MS, TETO_PRONTO_MS } from "../../domain/computador-canal.ts";
import { ehFalhaComputador, EsperandoTela, FalhaComputador } from "../../domain/computador.ts";
import { log } from "../../obs/log.ts";
import type { Escopo } from "../../shared/types.ts";
import type { CanalComputador } from "./canal.ts";
import { assinarComando, publicaDeAssinatura, seloDoIniciar } from "./selo.ts";

/**
 * O driver "motor" do computador (definido em 2026-10-22, NOD-96 PR 3, ADR-122): o computador da pessoa roda numa
 * máquina dela, pelo motor, e este driver só põe comandos assinados na fila da conexão certa (canal.ts) e espera a
 * resposta. O portão continua em fundo/computadores.ts (aprovação, política, saúde); o despachante é
 * `escolherMaquina` (domínio). Só com `NOD_COMPUTADORES=motor` (compor.ts).
 *
 * O `iniciar` liga a máquina do computador uma vez (as chamadas juntas esperam o mesmo pedido: a ação no meio do boot
 * espera, não falha) e tem teto de 60 s, contado depois de acordar a máquina (NOD-92). Máquina sem contato falha NA HORA.
 */

/** O computador como o driver precisa dele (o id vem do portão; o resto do banco, sem RLS de quem chama). */
export type ComputadorLocalizado = {
  escopo: Escopo;
  /**
   * O computador no supervisor (o da pessoa, `por_pessoa`), quando o portão fala de outro id (o do bot). Ausente = o
   * próprio id. Vai nos comandos, no selo e no TOFU; a tela é o `agenteId`.
   */
  computadorId?: string;
  /** A tela: o bot dono do computador (por bot) ou do pedido. Nulo = o computador inteiro. */
  agenteId: string | null;
  maquinaId: string | null;
  hospedeiraId: string | null;
  supervisorPub: string | null;
  padraoId: string | null;
  uso: UsoDoMac;
};
/** `vmLocal`: o preparo da VM local que o Mac anuncia (NOD-93); ausente nas Linux e no app antigo. */
export type MaquinaDaPessoa = MaquinaCandidata & { nome: string; vmLocal?: VmLocalAnunciada };

export type OpcoesDriverMotor = {
  env: Record<string, string | undefined>;
  canal: CanalComputador;
  /** O escopo vem do portão (fundo/computadores.ts); sem ele, o computador não é localizado (RLS). */
  localizar(id: string, escopo: Escopo | undefined): Promise<ComputadorLocalizado | null>;
  /** As máquinas conectadas (contato < 60 s) da pessoa, com o anúncio do computador (ponte.ts). */
  maquinas(escopo: Escopo): MaquinaDaPessoa[];
  /** O nome da máquina pela chave, mesmo desconectada (maquina_tokens), para "<máquina> está sem contato". */
  nomeDaMaquina(escopo: Escopo, maquinaId: string): Promise<string | null>;
  fixarHospedeira(escopo: Escopo, id: string, maquinaId: string): Promise<void>;
  /** TOFU (ADR-122): a primeira X25519 fica; outra é recusada até o Redefinir. */
  fixarSupervisor(escopo: Escopo, id: string, pub: string): Promise<"gravada" | "igual" | "diferente" | null>;
  /** Gancho da NOD-92: acorda a máquina gerenciada que dorme; true = acordou (o teto de 60 s começa aí). */
  acordarSePreciso?(escopo: Escopo, maquinaId: string): Promise<boolean>;
  agora?: () => number;
  dormir?: (ms: number) => Promise<void>;
  novoId?: () => string;
};

/** definido em 2026-10-22: a ação tem 90 s para voltar (o `docker exec` tinha 70 s; aqui soma a ida e a volta pela ponte). */
export const PRAZO_RESPOSTA_ACAO_MS = 90_000;
/** definido em 2026-10-22: o `parar` não segura quem chamou; sem resposta em 30 s, segue (a ociosidade da máquina desliga). */
const PRAZO_RESPOSTA_PARAR_MS = 30_000;
/** Os comandos que falam de uma tela (o `agenteId` vai junto); os outros são do computador inteiro. */
const TIPOS_DA_TELA = new Set<TipoComandoComputador>(["abrir_tela", "acao", "fechar_tela", "apagar_perfil"]);
/** A cada quanto o driver confere se a máquina ainda tem contato enquanto espera. */
const PASSO_MS = 250;
/** NOD-93: o intervalo entre os `iniciar` enquanto o Mac responde esperando_tela (preparo da VM local). */
const PASSO_ESPERANDO_MS = 1_000;
/**
 * definido em 2026-10-22 (NOD-96 PR 5): Atualizar, Redefinir e Sair de todos esperam até 10 min pela resposta (fechar
 * as telas e apagar perfis demora). O comando continua valendo 2 min para sair da fila; só a espera é longa.
 */
export const PRAZO_RESPOSTA_OPERACAO_MS = 10 * 60_000;

export function criarDriverMotor(o: OpcoesDriverMotor): DriverComputador & { motivoParaFicarAcordada(maquinaId: string): boolean } {
  const agora = o.agora ?? Date.now;
  const dormir = o.dormir ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const novoId = o.novoId ?? randomUUID;
  const credencial = o.env.NOD_CREDENTIAL_KEY ?? "";
  const credencialOk = /^[a-f0-9]{64}$/i.test(credencial);
  const iniciando = new Map<string, Promise<void>>();
  /** A última ação por máquina, para o gancho da NOD-92. */
  const ultimaAcao = new Map<string, number>();
  /**
   * Os ids do portão de cada computador do supervisor, com a tela de cada um, para o `ligados` falar a língua do portão
   * (NOD-170). No modo por pessoa (NOD-96 PR 4) o id do portão é o da tela: conta como ligado só com a tela aberta.
   */
  const idsDoPortao = new Map<string, Map<string, string | null>>();
  async function acharLoc(id: string, escopo: Escopo | undefined): Promise<ComputadorLocalizado | null> {
    const loc = await o.localizar(id, escopo);
    if (loc?.computadorId && loc.computadorId !== id) {
      const ids = idsDoPortao.get(loc.computadorId) ?? new Map<string, string | null>();
      ids.set(id, loc.agenteId);
      idsDoPortao.set(loc.computadorId, ids);
    }
    return loc;
  }

  async function localizar(id: string, escopo: Escopo | undefined): Promise<ComputadorLocalizado> {
    if (!credencialOk) throw new FalhaComputador("cofre_invalido", { detalhe: "NOD_CREDENTIAL_KEY precisa ser hex de 64" });
    const loc = await acharLoc(id, escopo);
    if (!loc) throw new FalhaComputador("nao_iniciou", { detalhe: "computador não encontrado" });
    return loc;
  }

  /** A máquina do computador, já conectada. Sem contato: acorda (NOD-92) ou falha na hora. */
  async function maquinaViva(id: string, loc: ComputadorLocalizado): Promise<MaquinaDaPessoa> {
    const alvo = escolherMaquina({ maquinaId: loc.maquinaId, hospedeiraId: loc.hospedeiraId, padraoId: loc.padraoId, conectadas: o.maquinas(loc.escopo) });
    if (!alvo) throw new FalhaComputador("maquina_sem_contato", { detalhe: "nenhuma máquina conectada anuncia o computador" });
    let viva = o.maquinas(loc.escopo).find((m) => m.machineId === alvo);
    if (!viva && o.acordarSePreciso && await o.acordarSePreciso(loc.escopo, alvo).catch(() => false)) viva = o.maquinas(loc.escopo).find((m) => m.machineId === alvo);
    if (!viva) {
      const nome = await o.nomeDaMaquina(loc.escopo, alvo).catch(() => null);
      log("aviso", "computador_maquina_sem_contato", { computador_id: id, maquina_id: alvo });
      throw new FalhaComputador("maquina_sem_contato", { maquina: nome ?? "a máquina do computador" });
    }
    if (viva.computador === null || viva.computador === "sem_suporte") throw new FalhaComputador("sem_suporte", { maquina: viva.nome });
    if (viva.computador === "faltam_pacotes") throw new FalhaComputador("faltam_pacotes", { maquina: viva.nome });
    return viva;
  }

  /**
   * Manda o comando e espera a resposta até `ate`. Falha na hora se a máquina perde o contato (a conexão sai da lista).
   * No prazo: o comando sai da fila e a resposta que chegar depois é ignorada.
   */
  async function enviar(id: string, loc: ComputadorLocalizado, maquina: MaquinaDaPessoa, tipo: TipoComandoComputador, ate: number, noPrazo: () => FalhaComputador, extra: Partial<ComandoComputador> = {}): Promise<ResultadoComandoComputador> {
    const comando = assinarComando(credencial, { id: novoId(), computadorId: loc.computadorId ?? id, tipo, ...(loc.agenteId && TIPOS_DA_TELA.has(tipo) ? { agenteId: loc.agenteId } : {}), uso: loc.uso, prazoMs: Math.min(ate, agora() + PRAZO_COMANDO_MS), ...extra });
    const espera: { fim?: { r: ResultadoComandoComputador } | { e: unknown } } = {};
    o.canal.enviar(loc.escopo, maquina.machineId, comando).then((r) => { espera.fim = { r }; }, (e: unknown) => { espera.fim = { e }; });
    while (!espera.fim) {
      if (agora() >= ate) o.canal.cancelar(comando.id, noPrazo());
      else if (!o.maquinas(loc.escopo).some((m) => m.machineId === maquina.machineId)) o.canal.cancelar(comando.id, new FalhaComputador("maquina_sem_contato", { maquina: maquina.nome }));
      else await dormir(PASSO_MS);
      // O cancelar rejeita a promessa: um tique para o `then` acima rodar.
      await Promise.resolve();
    }
    if ("e" in espera.fim) throw espera.fim.e;
    return espera.fim.r;
  }

  async function ligar(idDoPortao: string, escopo: Escopo | undefined): Promise<void> {
    const loc = await localizar(idDoPortao, escopo);
    const id = loc.computadorId ?? idDoPortao;
    const maquina = await maquinaViva(id, loc);
    const ate = agora() + TETO_PRONTO_MS;
    const foto = () => o.canal.foto(loc.escopo, maquina.machineId);
    if (foto()?.computadorId === id && foto()?.ligado) return;
    if (!loc.hospedeiraId && !loc.maquinaId) await o.fixarHospedeira(loc.escopo, id, maquina.machineId);
    let pub = loc.supervisorPub;
    // NOD-96 PR 7 (definido em 2026-10-22): numa instalação limpa o supervisor não conhece o computador e não relata
    // nada dele; ele só cria a pasta e a X25519 ao receber um comando com o id. A sonda é esse comando SEM assinatura —
    // sempre recusada (não liga nem desliga nada); o supervisor relata o computador novo na hora e a espera abaixo pega a
    // chave. Sem a sonda, a primeira ação de toda máquina nova esperava os 60 s e falhava (achado do e2e do PR 7).
    const sonda = !pub && !foto()?.supervisorPub ? { id: novoId(), computadorId: id, tipo: "parar" as const, uso: loc.uso, prazoMs: agora() + PRAZO_COMANDO_MS, assinatura: "" } : null;
    if (sonda) o.canal.enviar(loc.escopo, maquina.machineId, sonda).catch(() => undefined);
    try {
      pub = await esperarChave(id, loc, maquina, ate, pub, foto);
    } finally {
      if (sonda) o.canal.cancelar(sonda.id, new FalhaComputador("nao_iniciou"));
    }
    const pedirIniciar = () => enviar(idDoPortao, loc, maquina, "iniciar", ate, () => new FalhaComputador("nao_ficou_pronto", { maquina: maquina.nome }), {
      segredoSelado: seloDoIniciar(credencial, id, pub),
      // NOD-96 PR 7: o supervisor fixa a Ed25519 do servidor no primeiro `iniciar` (TOFU) por este campo; sem ele
      // recusava o comando (`sem_chave_do_servidor`) e nenhuma máquina nova ligava.
      servidorPub: publicaDeAssinatura(credencial, id),
    });
    let r = await pedirIniciar();
    // definido em 2026-10-24 (NOD-93, ADR-127 §3): o Mac responde esperando_tela enquanto a VM local baixa, prepara ou
    // espera memória; o servidor segura e pede de novo até o TETO_PRONTO_MS (estourou: nao_ficou_pronto).
    while (r.desfecho === "esperando_tela") {
      if (agora() >= ate) throw new FalhaComputador("nao_ficou_pronto", { maquina: maquina.nome, detalhe: r.progresso?.etapa });
      await dormir(PASSO_ESPERANDO_MS);
      r = await pedirIniciar();
    }
    if (r.desfecho === "ok") {
      log("info", "computador_iniciado", { computador_id: id, maquina_id: maquina.machineId, driver: "motor" });
      return;
    }
    throw new FalhaComputador(r.motivo ?? "nao_iniciou", { maquina: maquina.nome });
  }

  /** A X25519 do supervisor: a fixada (TOFU) ou a que a máquina relata; sem nenhuma ainda, espera o primeiro estado. */
  async function esperarChave(id: string, loc: ComputadorLocalizado, maquina: MaquinaDaPessoa, ate: number, fixada: string | null, foto: () => ReturnType<CanalComputador["foto"]>): Promise<string> {
    let pub = fixada;
    while (!pub) {
      const relatada = foto()?.supervisorPub;
      if (relatada) {
        const d = await o.fixarSupervisor(loc.escopo, id, relatada);
        if (d === "diferente" || d === null) throw new FalhaComputador("nao_iniciou", { detalhe: "a chave do supervisor não é a fixada; Redefinir o computador" });
        pub = relatada;
        break;
      }
      if (agora() >= ate) throw new FalhaComputador("nao_ficou_pronto", { maquina: maquina.nome, detalhe: "o supervisor não relatou estado" });
      if (!o.maquinas(loc.escopo).some((m) => m.machineId === maquina.machineId)) throw new FalhaComputador("maquina_sem_contato", { maquina: maquina.nome });
      await dormir(PASSO_MS);
    }
    return pub;
  }

  function iniciar(id: string, escopo?: Escopo): Promise<void> {
    const emCurso = iniciando.get(id);
    if (emCurso) return emCurso;
    const p = ligar(id, escopo).finally(() => iniciando.delete(id));
    iniciando.set(id, p);
    return p;
  }

  return {
    async ambiente(): Promise<AmbienteComputador> {
      return credencialOk ? { disponivel: true, motivo: null } : { disponivel: false, motivo: "NOD_CREDENTIAL_KEY precisa ser hex de 64 para o cofre dos computadores" };
    },
    async estado(id, escopo) {
      if (!credencialOk) return { disponivel: false, ativo: false, motivo: "NOD_CREDENTIAL_KEY precisa ser hex de 64 para o cofre dos computadores" };
      const loc = await acharLoc(id, escopo);
      if (!loc) return { disponivel: false, ativo: false, motivo: "Computador não encontrado" };
      const alvo = escolherMaquina({ maquinaId: loc.maquinaId, hospedeiraId: loc.hospedeiraId, padraoId: loc.padraoId, conectadas: o.maquinas(loc.escopo) });
      const viva = alvo ? o.maquinas(loc.escopo).find((m) => m.machineId === alvo) : undefined;
      const ativo = o.canal.ligados().has(loc.computadorId ?? id);
      if (!viva) return { disponivel: false, ativo, motivo: alvo ? "A máquina do computador está sem contato" : "Nenhuma máquina conectada roda o computador" };
      if (viva.computador !== "pronto") return { disponivel: false, ativo, motivo: viva.computador === "faltam_pacotes" ? `Falta instalar pacotes do computador em ${viva.nome}` : `${viva.nome} não consegue rodar o computador` };
      return { disponivel: true, ativo, motivo: null };
    },
    iniciar,
    async parar(id, escopo) {
      const loc = await acharLoc(id, escopo);
      if (!loc || !credencialOk) return;
      const alvo = escolherMaquina({ maquinaId: loc.maquinaId, hospedeiraId: loc.hospedeiraId, padraoId: loc.padraoId, conectadas: o.maquinas(loc.escopo) });
      const viva = alvo ? o.maquinas(loc.escopo).find((m) => m.machineId === alvo) : undefined;
      // Sem contato não há o que parar daqui: o supervisor desliga sozinho pela ociosidade.
      if (!viva) return;
      // NOD-96 PR 4: parar a tela de um bot é fechar só ela; o computador da pessoa (agenteId nulo) para inteiro.
      const tipo: TipoComandoComputador = loc.agenteId ? "fechar_tela" : "parar";
      try {
        await enviar(id, loc, viva, tipo, agora() + PRAZO_RESPOSTA_PARAR_MS, () => new FalhaComputador("sem_resposta", { maquina: viva.nome }));
      } catch (e) {
        log("aviso", "computador_parar_falhou", { computador_id: id, tipo, motivo: ehFalhaComputador(e) ? e.motivo : "desconhecido" });
      }
    },
    async executar(id: string, acao: AcaoComputador, escopo?: Escopo): Promise<ResultadoComputador> {
      const loc = await localizar(id, escopo);
      const maquina = await maquinaViva(id, loc);
      ultimaAcao.set(maquina.machineId, agora());
      const r = await enviar(id, loc, maquina, "acao", agora() + PRAZO_RESPOSTA_ACAO_MS, () => new FalhaComputador("sem_resposta", { maquina: maquina.nome }), { acao });
      ultimaAcao.set(maquina.machineId, agora());
      if (r.desfecho === "ok") return r.resultado ?? {};
      // NOD-96 PR 4: sem tela livre a ação não falha; o portão põe a tela na fila e tenta de novo na vez dela.
      if (r.desfecho === "esperando_tela") throw new EsperandoTela(r.quem ?? []);
      throw new FalhaComputador(r.motivo ?? "acao_falhou", { maquina: maquina.nome });
    },
    async ligados() {
      const ids = new Set<string>();
      const telas = o.canal.telasLigadas();
      for (const c of o.canal.ligados()) {
        ids.add(c);
        for (const [doPortao, agenteId] of idsDoPortao.get(c) ?? []) if (!agenteId || telas.has(`${c}:${agenteId}`)) ids.add(doPortao);
      }
      return ids;
    },
    async operar(idDoPortao, tipo, escopo) {
      const loc = await localizar(idDoPortao, escopo);
      const id = loc.computadorId ?? idDoPortao;
      // Sair de todos os sites limpa os cookies das telas abertas e Esquecer senhas apaga as senhas e religa as
      // telas: o supervisor exige o computador ligado nas duas.
      if (tipo === "sair_de_todos" || tipo === "esquecer_senhas") await iniciar(idDoPortao, escopo);
      const maquina = await maquinaViva(id, loc);
      ultimaAcao.set(maquina.machineId, agora());
      const r = await enviar(idDoPortao, loc, maquina, tipo, agora() + PRAZO_RESPOSTA_OPERACAO_MS, () => new FalhaComputador("sem_resposta", { maquina: maquina.nome }));
      ultimaAcao.set(maquina.machineId, agora());
      if (r.desfecho !== "ok") throw new FalhaComputador(r.motivo ?? "acao_falhou", { maquina: maquina.nome });
      log("info", "computador_operacao_concluida", { computador_id: id, tipo, maquina_id: maquina.machineId });
      return r.supervisorPub ? { supervisorPub: r.supervisorPub } : {};
    },
    async apagarPerfil(idDoPortao, agenteId, escopo) {
      const loc = await acharLoc(idDoPortao, escopo);
      if (!loc || !credencialOk) return;
      const id = loc.computadorId ?? idDoPortao;
      const alvo = escolherMaquina({ maquinaId: loc.maquinaId, hospedeiraId: loc.hospedeiraId, padraoId: loc.padraoId, conectadas: o.maquinas(loc.escopo) });
      const viva = alvo ? o.maquinas(loc.escopo).find((m) => m.machineId === alvo) : undefined;
      // Sem contato o perfil fica na máquina até o Redefinir (a tela some do banco do mesmo jeito).
      if (!viva) {
        log("aviso", "computador_perfil_nao_apagado", { computador_id: id, agente_id: agenteId, motivo: "maquina_sem_contato" });
        return;
      }
      try {
        const r = await enviar(idDoPortao, loc, viva, "apagar_perfil", agora() + PRAZO_RESPOSTA_PARAR_MS, () => new FalhaComputador("sem_resposta", { maquina: viva.nome }), { agenteId });
        if (r.desfecho !== "ok") log("aviso", "computador_perfil_nao_apagado", { computador_id: id, agente_id: agenteId, motivo: r.motivo ?? "desconhecido" });
      } catch (e) {
        log("aviso", "computador_perfil_nao_apagado", { computador_id: id, agente_id: agenteId, motivo: ehFalhaComputador(e) ? e.motivo : "desconhecido" });
      }
    },
    async maquinaDoComputador(id, escopo) {
      const loc = await acharLoc(id, escopo);
      if (!loc) return null;
      const conectadas = o.maquinas(loc.escopo);
      const alvo = escolherMaquina({ maquinaId: loc.maquinaId, hospedeiraId: loc.hospedeiraId, padraoId: loc.padraoId, conectadas }) ?? loc.maquinaId ?? loc.hospedeiraId;
      if (!alvo) return null;
      const viva = conectadas.find((m) => m.machineId === alvo);
      if (!viva) return { id: alvo, nome: (await o.nomeDaMaquina(loc.escopo, alvo).catch(() => null)) ?? "a máquina do computador", contato: null, foto: null };
      const f = o.canal.foto(loc.escopo, alvo);
      const foto = f?.computadorId === id
        ? { ligadoDesde: f.ligadoDesde ?? null, memoriaTotalMb: f.memoriaTotalMb ?? null, titulos: Object.fromEntries(f.telas.map((t) => [t.agenteId, t.titulo ?? null])) }
        : null;
      // NOD-93 (passo 9): a máquina escolhida é o Mac com a VM local — o preparo vai junto para a tela.
      return { id: alvo, nome: viva.nome, contato: viva.ultimoContato, foto, ...(viva.plataforma === "darwin" && viva.vmLocal ? { preparo: viva.vmLocal } : {}) };
    },
    ligando(id) {
      return iniciando.has(id);
    },
    motivoParaFicarAcordada(maquinaId: string): boolean {
      const foto = o.canal.fotoDaMaquina(maquinaId);
      return motivoParaFicarAcordada(foto ? [foto] : [], ultimaAcao.get(maquinaId) ?? null, agora());
    },
  };
}
