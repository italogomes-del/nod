import { constants, createCipheriv, createPublicKey, publicEncrypt, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { CodigoCifrado } from "../../../src/contracts/contas-ia.ts";
import type { PedidoDeInstalacao, ProgressoDeInstalacao } from "../../../src/contracts/instalacoes-ssh.ts";
import { gerarParDoLogin } from "../../../src/shared/cifra-do-codigo.ts";
import { iniciarInstaladora, INTERVALO_INSTALACOES_MS, INTERVALO_SEM_ROTA_MS, type PonteDeInstalacoes } from "../../../src/shared/instaladora.ts";
import type { instalarPorSsh, ResultadoSsh, Sistema } from "../../../src/shared/instalador-ssh.ts";

const par = gerarParDoLogin();
/** O que o navegador faz (web/lib/cifra.ts): AES-GCM com a chave envolvida em RSA-OAEP. */
function cifrar(texto: string, publica = par.publica): CodigoCifrado {
  const chave = randomBytes(32), iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", chave, iv);
  const dados = Buffer.concat([c.update(texto, "utf8"), c.final(), c.getAuthTag()]);
  const envolvida = publicEncrypt({ key: createPublicKey({ key: Buffer.from(publica, "base64"), format: "der", type: "spki" }), oaepHash: "sha256", padding: constants.RSA_PKCS1_OAEP_PADDING }, chave);
  return { chave: envolvida.toString("base64"), iv: iv.toString("base64"), dados: dados.toString("base64") };
}

const pedido = (p: Partial<PedidoDeInstalacao> = {}): PedidoDeInstalacao => ({
  id: "p1", host: "vm", porta: 22, usuario: "root", metodo: "senha", impressaoConhecida: null, convite: "c".repeat(32), servidor: "https://nod", ...p,
});

function montar(puxadas: (PedidoDeInstalacao[] | null | "sem_rota")[], instalar: typeof instalarPorSsh) {
  const relatos: ProgressoDeInstalacao[] = [];
  const chavesPuxadas: string[] = [];
  const agendados: { fn: () => void; ms: number }[] = [];
  const ponte: PonteDeInstalacoes = {
    async puxar(chave) { chavesPuxadas.push(chave); return puxadas.shift() ?? []; },
    async progresso(p) { relatos.push(p); return true; },
  };
  const inst = iniciarInstaladora({ ponte, sistema: {} as Sistema, agendar: (fn, ms) => { agendados.push({ fn, ms }); return { cancelar: () => undefined }; }, esperar: async () => undefined, instalar, par });
  const proxima = async () => { const a = agendados.shift()!; a.fn(); await new Promise((r) => setTimeout(r, 5)); return a.ms; };
  return { inst, relatos, chavesPuxadas, agendados, proxima };
}
const ate = () => new Promise((r) => setTimeout(r, 10));

describe("instaladora", () => {
  it("decifra a credencial, instala, relata as etapas em ordem e o fim; manda a chave pública na puxada", async () => {
    const recebidas: unknown[] = [];
    const instalar: typeof instalarPorSsh = async (p, cred, _s, aoProgresso) => {
      recebidas.push(cred);
      aoProgresso?.({ etapa: "conferencia", impressao: `SHA256:${"a".repeat(43)}` });
      aoProgresso?.({ etapa: "pacotes" });
      return { ok: true, impressao: null, conferencia: {} as never, avisos: [] };
    };
    const m = montar([[pedido({ cifrado: cifrar(JSON.stringify({ senha: "s3nh4!" })) })]], instalar);
    await ate();
    expect(m.chavesPuxadas).toEqual([par.publica]);
    expect(recebidas).toEqual([{ senha: "s3nh4!" }]);
    expect(m.relatos).toEqual([{ id: "p1", etapa: "conferencia", impressao: `SHA256:${"a".repeat(43)}` }, { id: "p1", etapa: "pacotes" }, { id: "p1", etapa: "pronta" }]);
    expect(m.agendados[0]!.ms).toBe(INTERVALO_INSTALACOES_MS);
    expect(m.inst.emAndamento()).toEqual([]);
    expect(JSON.stringify(m.relatos)).not.toContain("s3nh4!");
  });

  it("cifrado para outro par (instaladora reiniciou): nao_pareou, sem instalar", async () => {
    let chamou = false;
    const outro = gerarParDoLogin();
    const m = montar([[pedido({ cifrado: cifrar("{}", outro.publica) })]], async () => { chamou = true; return {} as ResultadoSsh; });
    await ate();
    expect(chamou).toBe(false);
    expect(m.relatos).toEqual([{ id: "p1", erro: "nao_pareou" }]);
  });

  it("credencial que não serve: ssh_recusou_login; falha do ssh: o motivo, a impressão nova e as linhas", async () => {
    const m1 = montar([[pedido({ cifrado: cifrar(JSON.stringify({ senha: "a\nb" })) })]], async () => ({} as ResultadoSsh));
    await ate();
    expect(m1.relatos).toEqual([{ id: "p1", erro: "ssh_recusou_login" }]);

    const nova = `SHA256:${"n".repeat(43)}`;
    const m2 = montar([[pedido({ cifrado: cifrar(JSON.stringify({ senha: "x" })) })]], async () => ({ ok: false, motivo: "chave_do_servidor_mudou", impressao: nova, linhas: ["l1"] }));
    await ate();
    expect(m2.relatos).toEqual([{ id: "p1", erro: "chave_do_servidor_mudou", impressao: nova, linhas: ["l1"] }]);
  });

  it("apelido não precisa de cifrado; o cancelamento aborta a instalação em andamento sem relatar", async () => {
    let sinal: AbortSignal | undefined;
    let soltar: () => void = () => undefined;
    const instalar: typeof instalarPorSsh = async (_p, cred, _s, _a, s) => {
      expect(cred).toEqual({});
      sinal = s;
      await new Promise<void>((r) => { soltar = r; });
      return { ok: false, motivo: "instalacao_falhou", linhas: [] };
    };
    const m = montar([[pedido({ metodo: "apelido" })], [pedido({ metodo: "apelido", cancelado: true })]], instalar);
    await ate();
    expect(m.inst.emAndamento()).toEqual(["p1"]);
    // Na próxima puxada o mesmo pedido ainda em andamento não roda de novo; o cancelado aborta.
    await m.proxima();
    expect(sinal?.aborted).toBe(true);
    soltar();
    await ate();
    expect(m.relatos).toEqual([]);
    expect(m.inst.emAndamento()).toEqual([]);
  });

  it("servidor sem a rota: espera 5 min; sem resposta: tenta de novo em 3 s", async () => {
    const m = montar(["sem_rota", null], async () => ({} as ResultadoSsh));
    await ate();
    expect(m.agendados[0]!.ms).toBe(INTERVALO_SEM_ROTA_MS);
    expect(await m.proxima()).toBe(INTERVALO_SEM_ROTA_MS);
    expect(m.agendados[0]!.ms).toBe(INTERVALO_INSTALACOES_MS);
  });

  it("parar aborta o que roda e não agenda mais", async () => {
    let sinal: AbortSignal | undefined;
    const m = montar([[pedido({ metodo: "apelido" })]], async (_p, _c, _s, _a, s) => { sinal = s; return new Promise(() => undefined); });
    await ate();
    m.inst.parar();
    expect(sinal?.aborted).toBe(true);
  });
});
