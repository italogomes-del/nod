import { randomBytes, randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { NivelPressao } from "../../src/contracts/trabalho.ts";
import type { Tx } from "../../src/shared/types.ts";
import { criarTrabalho, listarTrabalhos } from "../../src/use-cases/trabalhos.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * A tela fala por máquina (definido em 2026-10-09): o `puxar` de cada máquina já decidia pela leitura DELA, mas a lista de
 * trabalhos usava a pior entre todas e dizia "Seu Mac está ocupado" com a VM cheia e o Mac folgado. Agora cada trabalho
 * espera pelo portão da máquina dele — o alvo do turno, pela mesma regra do `reivindicar` (alvo-da-maquina.ts) — e a
 * lista traz cada máquina com a própria leitura.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const MAC = randomUUID();

type Leitura = { nivel: NivelPressao; portao: NivelPressao | null; totalMb: number };

async function montar(trx: Tx) {
  const ada = await agenteComConversa(trx, MARLON, { nome: "Ada" });
  const eli = await agenteComConversa(trx, MARLON, { nome: "Eli" });
  const { deps, repos } = depsSobre(trx, MARLON);
  const c = await repos.maquinaTokens.criar({ nome: "nod-motor-teste", prefixo: randomBytes(4).toString("hex"), hash: randomBytes(32) });
  if (!c) throw new Error("chave");
  const vm = c.id;
  // Ada trabalha na VM; Eli não tem escolha: com o servidor no Mac (ADR-092), roda no Mac.
  await repos.agentes.definirMaquina([ada.agenteId], vm);
  const rotina = async (b: { agenteId: string; conversaId: string }, titulo: string) => {
    const w = (await criarTrabalho(deps, { agenteId: b.agenteId, conversaId: b.conversaId, titulo, origem: "rotina" })).trabalho;
    const t = await repos.turnos.enfileirar({ executor: "catcher", conversaId: b.conversaId, agenteId: b.agenteId, origem: "rotina", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "faça", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli", trabalhoId: w.id });
    if (!t) throw new Error("turno");
    return { trabalho: w, turno: t };
  };
  const leituras = new Map<string, Leitura>();
  const linha = (id: string, l: Leitura) => ({ machineId: id, nivel: l.nivel, totalMb: l.totalMb, processador: l.portao, fila: null, portao: l.portao, uso: null, carga: null, disco: null, discoNivel: null, discoMedido: false });
  const services = {
    ...deps.services,
    trabalhosVivos: {
      ultimaFerramenta: () => null,
      // A junta de antes (o pior), que os campos de topo continuam mostrando.
      memoria: () => (leituras.size === 0 ? null : { nivel: [...leituras.values()].some((l) => l.nivel !== "verde") ? ("amarela" as const) : ("verde" as const), totalMb: [...leituras.values()].reduce((s, l) => s + l.totalMb, 0), processador: [...leituras.values()].some((l) => l.portao === "vermelha") ? ("vermelha" as const) : ("verde" as const) }),
    },
    maquinas: {
      leituras: () => [...leituras].map(([id, l]) => linha(id, l)),
      identificar: (_: unknown, id: string) => (id === MAC ? { nome: "Este Mac", ehMac: true } : id === vm ? { nome: "nod-motor-teste", ehMac: false } : null),
      macDoServidor: MAC,
    },
  };
  const listar = async () => (await listarTrabalhos({ ...deps, services }, {})).data;
  return { ada, eli, repos, vm, rotina, leituras, listar };
}

describeIntegracao("a tela fala por máquina (2026-10-09)", () => {
  it("VM sem memória e Mac folgado: só a rotina do bot da VM espera, com o nome dela; a do Mac segue na fila", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const daVm = await m.rotina(m.ada, "Verificar o Slack");
      const doMac = await m.rotina(m.eli, "Consultar o ClickUp");
      // ADR-097: no equilibrado (o padrão) só a memória e o disco seguram; o processador cheio, não.
      m.leituras.set(m.vm, { nivel: "amarela", portao: "vermelha", totalMb: 700 });
      m.leituras.set(MAC, { nivel: "verde", portao: "verde", totalMb: 400 });

      const dto = await m.listar();
      const de = (id: string) => dto.trabalhos.find((t) => t.id === id);
      expect(de(daVm.trabalho.id)).toMatchObject({ esperaDoMac: "memoria", maquina: { id: m.vm, nome: "nod-motor-teste", ehMac: false } });
      expect(de(doMac.trabalho.id)).toMatchObject({ esperaDoMac: null, maquina: { id: MAC, nome: "Este Mac", ehMac: true } });
      expect(dto.maquinas).toEqual([
        expect.objectContaining({ id: m.vm, nome: "nod-motor-teste", ehMac: false, motivoEspera: "memoria", memoriaBotsMb: 700 }),
        expect.objectContaining({ id: MAC, nome: "Este Mac", ehMac: true, motivoEspera: null, memoriaBotsMb: 400 }),
      ]);
      // Os campos de topo continuam pelo pior (a web e o app de antes).
      expect(dto.segurando).toBe(true);

      // A mesma regra do reivindicar: a VM (só como alvo, ADR-092) leva a rotina da Ada, não a do Eli.
      const pego = await m.repos.turnos.reivindicar({ machineId: m.vm, agora: Date.now(), soComoAlvo: true });
      expect(pego?.id).toBe(daVm.turno.id);
    });
  });

  it("o inverso: Mac cheio e VM folgada — só a rotina do Mac espera", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const daVm = await m.rotina(m.ada, "Verificar o Slack");
      const doMac = await m.rotina(m.eli, "Consultar o ClickUp");
      m.leituras.set(m.vm, { nivel: "verde", portao: "verde", totalMb: 0 });
      m.leituras.set(MAC, { nivel: "amarela", portao: "verde", totalMb: 400 });

      const dto = await m.listar();
      const de = (id: string) => dto.trabalhos.find((t) => t.id === id);
      expect(de(daVm.trabalho.id)).toMatchObject({ esperaDoMac: null, maquina: { id: m.vm } });
      expect(de(doMac.trabalho.id)).toMatchObject({ esperaDoMac: "memoria", maquina: { id: MAC, ehMac: true } });
    });
  });

  it("chave da VM revogada: o alvo cai para o Mac (a fila nunca prende o turno numa máquina que não volta)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const daVm = await m.rotina(m.ada, "Verificar o Slack");
      await m.repos.maquinaTokens.revogar(m.vm, Date.now());
      m.leituras.set(MAC, { nivel: "amarela", portao: "verde", totalMb: 400 });
      const dto = await m.listar();
      expect(dto.trabalhos.find((t) => t.id === daVm.trabalho.id)).toMatchObject({ esperaDoMac: "memoria", maquina: { id: MAC } });
    });
  });

  it("sem leitura da máquina do trabalho, ele não espera — mesmo com outra máquina cheia", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const daVm = await m.rotina(m.ada, "Verificar o Slack");
      m.leituras.set(MAC, { nivel: "verde", portao: "vermelha", totalMb: 400 });
      const dto = await m.listar();
      expect(dto.trabalhos.find((t) => t.id === daVm.trabalho.id)).toMatchObject({ esperaDoMac: null, maquina: { id: m.vm } });
    });
  });
});
