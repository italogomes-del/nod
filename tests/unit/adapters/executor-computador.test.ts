import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { iniciarComputador, type CanalDoMotor, type LacoComputador } from "../../../src/adapters/executor/computador.ts";
import type { ComandoComputador, EstadoComputadorRelatado, MensagemAoSupervisor, ResultadoComandoComputador } from "../../../src/contracts/computador-motor.ts";

/** NOD-96 PR 3: o laço do motor com um supervisor falso no socket (o real é do PR 2) e uma ponte falsa. */
const comando = (id: string): ComandoComputador => ({ id, computadorId: "00000000-0000-4000-8000-0000000000c1", tipo: "acao", uso: "equilibrado", prazoMs: 1, assinatura: "x" });
const esperarAte = async (cond: () => boolean) => { for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 10)); expect(cond()).toBe(true); };

let limpar: (() => void)[] = [];
afterEach(() => { for (const f of limpar) f(); limpar = []; });

function supervisorFalso(caminho: string, responder: (m: MensagemAoSupervisor, s: Socket) => void): Promise<{ recebidas: MensagemAoSupervisor[]; servidor: Server }> {
  const recebidas: MensagemAoSupervisor[] = [];
  const servidor = createServer((s) => {
    let resto = "";
    s.setEncoding("utf8");
    s.on("data", (d: string) => {
      resto += d;
      let i: number;
      while ((i = resto.indexOf("\n")) >= 0) { const m = JSON.parse(resto.slice(0, i)) as MensagemAoSupervisor; resto = resto.slice(i + 1); recebidas.push(m); responder(m, s); }
    });
  });
  limpar.push(() => servidor.close());
  return new Promise((r) => servidor.listen(caminho, () => r({ recebidas, servidor })));
}

function ponteFalsa(fila: (ComandoComputador[] | "sem_rota" | null)[]) {
  const resultados: ResultadoComandoComputador[] = [];
  const estados: EstadoComputadorRelatado[] = [];
  let aceitar = true;
  const canal: CanalDoMotor = {
    puxar: async () => { await new Promise((r) => setTimeout(r, 5)); return fila.shift() ?? []; },
    resultado: async (r) => { if (!aceitar) return false; resultados.push(r); return true; },
    estado: async (e) => { if (!aceitar) return false; estados.push(e); return true; },
  };
  return { canal, resultados, estados, recusar: (v: boolean) => { aceitar = !v; } };
}

function pasta() { const d = mkdtempSync(join(tmpdir(), "nod-comp-")); limpar.push(() => rmSync(d, { recursive: true, force: true })); return join(d, "ctl.sock"); }
function laco(l: LacoComputador) { limpar.unshift(() => l.parar()); return l; }

describe("laço do computador no motor", () => {
  it("repassa o comando como veio e posta a resposta; pede a foto e posta", async () => {
    const sock = pasta();
    const foto = { tipo: "estado", computadorId: "", ligado: false, supervisorPub: "p", telas: [] };
    const sup = await supervisorFalso(sock, (m, s) => {
      if (m.tipo === "comando") s.write(`${JSON.stringify({ tipo: "resultado", id: m.comando.id, desfecho: "ok", resultado: { saida: "oi" } })}\n`);
      else s.write(`${JSON.stringify(foto)}\n`);
    });
    const p = ponteFalsa([[comando("c1")]]);
    laco(iniciarComputador({ canal: p.canal, socket: sock, batimentoMs: 60_000, dormir: async () => undefined }));
    await esperarAte(() => p.resultados.length === 1 && p.estados.length >= 1);
    expect(sup.recebidas.find((m) => m.tipo === "comando")).toEqual({ tipo: "comando", comando: comando("c1") });
    expect(p.resultados[0]).toEqual({ id: "c1", desfecho: "ok", resultado: { saida: "oi" } });
    expect(p.estados[0]).toEqual({ computadorId: "", ligado: false, supervisorPub: "p", telas: [] });
  });

  it("supervisor fora do ar: o comando volta na hora como nao_iniciou", async () => {
    const p = ponteFalsa([[comando("c1")]]);
    laco(iniciarComputador({ canal: p.canal, socket: pasta(), batimentoMs: 60_000, dormir: async () => undefined }));
    await esperarAte(() => p.resultados.length === 1);
    expect(p.resultados[0]).toEqual({ id: "c1", desfecho: "falhou", motivo: "nao_iniciou" });
  });

  it("servidor fora: o relato fica guardado e vai no batimento seguinte", async () => {
    const p = ponteFalsa([[comando("c1")]]);
    p.recusar(true);
    const l = laco(iniciarComputador({ canal: p.canal, socket: pasta(), batimentoMs: 60_000, dormir: async () => undefined }));
    await new Promise((r) => setTimeout(r, 100));
    expect(p.resultados).toEqual([]);
    p.recusar(false);
    await l.batimento();
    expect(p.resultados.map((r) => r.id)).toEqual(["c1"]);
  });

  it("servidor sem a flag (404): dorme 10 min antes de puxar de novo", async () => {
    const sonos: number[] = [];
    const p = ponteFalsa(["sem_rota"]);
    laco(iniciarComputador({ canal: p.canal, socket: pasta(), batimentoMs: 60_000, dormir: async (ms) => { sonos.push(ms); await new Promise((r) => setTimeout(r, 1_000)); } }));
    await esperarAte(() => sonos.length > 0);
    expect(sonos[0]).toBe(600_000);
  });


  describe("ganchos (NOD-93, ADR-127 §3)", () => {
    it("antesDeRepassar: null segue ao supervisor; resposta volta na hora sem tocar o socket; erro vira nao_iniciou", async () => {
      const sock = pasta();
      const sup = await supervisorFalso(sock, (m, s) => {
        if (m.tipo === "comando") s.write(`${JSON.stringify({ tipo: "resultado", id: m.comando.id, desfecho: "ok" })}\n`);
      });
      const p = ponteFalsa([[comando("segue"), comando("segura"), comando("quebra")]]);
      const vistos: string[] = [];
      laco(iniciarComputador({
        canal: p.canal, socket: sock, batimentoMs: 60_000, dormir: async () => undefined,
        antesDeRepassar: async (c) => {
          vistos.push(c.id);
          if (c.id === "segura") return { desfecho: "esperando_tela", progresso: { pct: 79, etapa: "baixando" } };
          if (c.id === "quebra") throw new Error("x");
          return null;
        },
      }));
      await esperarAte(() => p.resultados.length === 3);
      expect(vistos).toEqual(["segue", "segura", "quebra"]);
      expect(sup.recebidas.filter((m) => m.tipo === "comando").map((m) => m.tipo === "comando" && m.comando.id)).toEqual(["segue"]);
      // A resposta do supervisor chega pelo socket, depois das que o gancho deu na hora: a ordem não importa.
      expect([...p.resultados].sort((x, y) => x.id.localeCompare(y.id))).toEqual([
        { id: "quebra", desfecho: "falhou", motivo: "nao_iniciou" },
        { id: "segue", desfecho: "ok" },
        { id: "segura", desfecho: "esperando_tela", progresso: { pct: 79, etapa: "baixando" } },
      ]);
    });

    it("aoRelato vê cada foto do supervisor (sem o tipo) e a foto ainda sobe; erro no gancho não para o fio", async () => {
      const sock = pasta();
      const foto = { tipo: "estado", computadorId: "c", ligado: true, supervisorPub: "p", telas: [] };
      await supervisorFalso(sock, (m, s) => { if (m.tipo === "pedir_estado") s.write(`${JSON.stringify(foto)}\n`); });
      const p = ponteFalsa([]);
      const fotos: EstadoComputadorRelatado[] = [];
      const l = laco(iniciarComputador({ canal: p.canal, socket: sock, batimentoMs: 60_000, dormir: async () => undefined, aoRelato: (e) => { fotos.push(e); throw new Error("x"); } }));
      await esperarAte(() => p.estados.length === 1);
      await l.batimento();
      await esperarAte(() => p.estados.length === 2);
      expect(fotos).toEqual([{ computadorId: "c", ligado: true, supervisorPub: "p", telas: [] }, { computadorId: "c", ligado: true, supervisorPub: "p", telas: [] }]);
    });
  });
});
