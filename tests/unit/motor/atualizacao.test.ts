import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scriptDeInstalacao } from "../../../src/adapters/http/motor-instalacao.ts";
import { ATUALIZACAO_PARADA, DRENAGEM_MAXIMA_MS, ESPERA_DEPOIS_DE_DESISTIR_MS, ESPERA_DEPOIS_DE_FALHAR_MS, ESPERA_DO_PEDIDO_MS, JANELA_OCIOSA_MS, motorDiferente, proximoPasso } from "../../../src/domain/atualizacao-do-motor.ts";
import { arquivoDoPedido, atualizacaoLigada, iniciarAtualizacao, shaDosArquivos } from "../../../motor/atualizacao.ts";

const sha = (t: string) => createHash("sha256").update(t).digest("hex");
const MIN = 60_000;

describe("o motor se atualiza sozinho (ADR-100): quando", () => {
  it("diferente = algum sha256 local não bate com o manifesto; arquivo que falta conta; manifesto vazio não", () => {
    expect(motorDiferente({ a: "1", b: "2" }, { a: "1", b: "2" })).toBe(false);
    expect(motorDiferente({ a: "1", b: "x" }, { a: "1", b: "2" })).toBe(true);
    expect(motorDiferente({ a: "1", b: null }, { a: "1", b: "2" })).toBe(true);
    expect(motorDiferente({ a: "1" }, {})).toBe(false);
  });

  it("igual: nada; diferente e sem turno: drena e pede na hora", () => {
    expect(proximoPasso(ATUALIZACAO_PARADA, { agora: 0, diferente: false, turnosRodando: 3 })).toMatchObject({ pedir: false, motivo: "igual", estado: ATUALIZACAO_PARADA });
    expect(proximoPasso(ATUALIZACAO_PARADA, { agora: 5, diferente: true, turnosRodando: 0 })).toEqual({ pedir: true, motivo: "pedido", estado: { pendenteDesde: 5, drenando: true, drenandoDesde: 5, pedidoEm: 5, falhouEm: null, desistiuEm: null } });
  });

  it("com turnos rodando espera um momento ocioso; passada a janela, drena (nunca interrompe) e pede quando acabam", () => {
    let p = proximoPasso(ATUALIZACAO_PARADA, { agora: 0, diferente: true, turnosRodando: 2 });
    expect(p).toMatchObject({ pedir: false, motivo: "esperando_ocioso", estado: { drenando: false, pendenteDesde: 0 } });
    p = proximoPasso(p.estado, { agora: JANELA_OCIOSA_MS - 1, diferente: true, turnosRodando: 2 });
    expect(p.motivo).toBe("esperando_ocioso");
    p = proximoPasso(p.estado, { agora: JANELA_OCIOSA_MS, diferente: true, turnosRodando: 2 });
    expect(p).toMatchObject({ pedir: false, motivo: "drenando", estado: { drenando: true, drenandoDesde: JANELA_OCIOSA_MS } });
    p = proximoPasso(p.estado, { agora: JANELA_OCIOSA_MS + DRENAGEM_MAXIMA_MS - 1, diferente: true, turnosRodando: 1 });
    expect(p.motivo).toBe("drenando");
    p = proximoPasso(p.estado, { agora: JANELA_OCIOSA_MS + DRENAGEM_MAXIMA_MS - 1, diferente: true, turnosRodando: 0 });
    expect(p).toMatchObject({ pedir: true, motivo: "pedido" });
  });

  it("emenda de 2026-10-15: a drenagem tem teto — com um turno de horas, volta a puxar e tenta de novo depois de uma hora", () => {
    // O caso de produção: um turno de delegação de horas segurava a VM inteira (nenhum outro bot andava).
    const T0 = JANELA_OCIOSA_MS;
    let p = proximoPasso({ ...ATUALIZACAO_PARADA, pendenteDesde: 0 }, { agora: T0, diferente: true, turnosRodando: 1 });
    expect(p.motivo).toBe("drenando");
    p = proximoPasso(p.estado, { agora: T0 + DRENAGEM_MAXIMA_MS, diferente: true, turnosRodando: 1 });
    expect(p).toMatchObject({ pedir: false, motivo: "drenagem_desistiu", estado: { drenando: false, drenandoDesde: null, desistiuEm: T0 + DRENAGEM_MAXIMA_MS } });
    const desistiu = T0 + DRENAGEM_MAXIMA_MS;
    // Na espera: puxa normalmente, mesmo com o turno longo ainda rodando.
    p = proximoPasso(p.estado, { agora: desistiu + ESPERA_DEPOIS_DE_DESISTIR_MS - 1, diferente: true, turnosRodando: 3 });
    expect(p).toMatchObject({ pedir: false, motivo: "esperando_nova_tentativa", estado: { drenando: false } });
    // Passada a espera, drena de novo na hora (a janela ociosa já passou) — e desiste de novo no teto.
    p = proximoPasso(p.estado, { agora: desistiu + ESPERA_DEPOIS_DE_DESISTIR_MS, diferente: true, turnosRodando: 1 });
    expect(p).toMatchObject({ motivo: "drenando", estado: { drenando: true, drenandoDesde: desistiu + ESPERA_DEPOIS_DE_DESISTIR_MS } });
    p = proximoPasso(p.estado, { agora: desistiu + ESPERA_DEPOIS_DE_DESISTIR_MS + DRENAGEM_MAXIMA_MS, diferente: true, turnosRodando: 1 });
    expect(p.motivo).toBe("drenagem_desistiu");
  });

  it("emenda de 2026-10-15: depois de desistir, um momento ocioso pede na hora (não espera a hora inteira)", () => {
    const desistiu = proximoPasso({ ...ATUALIZACAO_PARADA, pendenteDesde: 0, drenando: true, drenandoDesde: 0 }, { agora: DRENAGEM_MAXIMA_MS, diferente: true, turnosRodando: 1 });
    expect(desistiu.motivo).toBe("drenagem_desistiu");
    expect(proximoPasso(desistiu.estado, { agora: DRENAGEM_MAXIMA_MS + 5 * MIN, diferente: true, turnosRodando: 0 })).toMatchObject({ pedir: true, motivo: "pedido", estado: { desistiuEm: null } });
    // Ficar igual ao servidor limpa tudo.
    expect(proximoPasso(desistiu.estado, { agora: DRENAGEM_MAXIMA_MS + 1, diferente: false, turnosRodando: 1 }).estado).toEqual(ATUALIZACAO_PARADA);
  });

  it("emenda de 2026-10-15: o estado de antes (drenando, sem drenandoDesde) conta o teto a partir de agora", () => {
    const antigo = { pendenteDesde: 0, drenando: true, pedidoEm: null, falhouEm: null };
    const p = proximoPasso(antigo, { agora: 5 * 60 * MIN, diferente: true, turnosRodando: 1 });
    expect(p).toMatchObject({ motivo: "drenando", estado: { drenandoDesde: 5 * 60 * MIN } });
    expect(proximoPasso(p.estado, { agora: 5 * 60 * MIN + DRENAGEM_MAXIMA_MS, diferente: true, turnosRodando: 1 }).motivo).toBe("drenagem_desistiu");
  });

  it("o pedido que não vira reinício volta a puxar e tenta de novo depois de uma hora; ficar igual cancela tudo", () => {
    const pedido = proximoPasso(ATUALIZACAO_PARADA, { agora: 0, diferente: true, turnosRodando: 0 }).estado;
    expect(proximoPasso(pedido, { agora: ESPERA_DO_PEDIDO_MS - 1, diferente: true, turnosRodando: 0 }).motivo).toBe("esperando_reinicio");
    const falhou = proximoPasso(pedido, { agora: ESPERA_DO_PEDIDO_MS, diferente: true, turnosRodando: 0 });
    expect(falhou).toMatchObject({ pedir: false, motivo: "pedido_falhou", estado: { drenando: false, pedidoEm: null, falhouEm: ESPERA_DO_PEDIDO_MS } });
    expect(proximoPasso(falhou.estado, { agora: ESPERA_DO_PEDIDO_MS + 30 * MIN, diferente: true, turnosRodando: 0 }).motivo).toBe("esperando_nova_tentativa");
    expect(proximoPasso(falhou.estado, { agora: ESPERA_DO_PEDIDO_MS + ESPERA_DEPOIS_DE_FALHAR_MS, diferente: true, turnosRodando: 0 }).pedir).toBe(true);
    expect(proximoPasso(falhou.estado, { agora: 1, diferente: false, turnosRodando: 0 }).estado).toEqual(ATUALIZACAO_PARADA);
  });
});

describe("o motor se atualiza sozinho (ADR-100): no motor", () => {
  async function montar(conteudoServidor: string) {
    const dir = await mkdtemp(join(tmpdir(), "nod-motor-app-"));
    const pasta = await mkdtemp(join(tmpdir(), "nod-motor-cfg-"));
    for (const nome of ["nod-motor.mjs", "proxy.mjs", "hook-nativas.mjs"]) await writeFile(join(dir, nome), `// ${nome}\n`);
    const arquivos = { "nod-motor.mjs": sha(conteudoServidor), "proxy.mjs": sha("// proxy.mjs\n"), "hook-nativas.mjs": sha("// hook-nativas.mjs\n") };
    const buscar = (async () => new Response(JSON.stringify({ versao: "0.5.0", arquivos }), { status: 200 })) as typeof fetch;
    return { dir, pasta, buscar };
  }

  it("ligada só com a marca da instalação e, com a url, só se o root baixa do mesmo servidor", async () => {
    const etc = await mkdtemp(join(tmpdir(), "nod-etc-"));
    const marca = join(etc, "atualizar-sozinho");
    const servidor = join(etc, "servidor");
    expect(await atualizacaoLigada({ marca, servidor })).toBe(false);
    await writeFile(marca, "");
    await writeFile(servidor, "https://nod.exemplo.com\n");
    expect(await atualizacaoLigada({ marca, servidor })).toBe(true);
    expect(await atualizacaoLigada({ marca, servidor, url: "https://nod.exemplo.com" })).toBe(true);
    expect(await atualizacaoLigada({ marca, servidor, url: "https://outro.exemplo.com" })).toBe(false);
  });

  it("lê o sha256 dos três arquivos daqui (o que falta vem null)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nod-motor-app-"));
    await writeFile(join(dir, "proxy.mjs"), "x");
    expect(await shaDosArquivos(dir)).toEqual({ "nod-motor.mjs": null, "proxy.mjs": sha("x"), "hook-nativas.mjs": null });
  });

  it("diferente e sem turno: drena, espera o puxar em voo e grava o pedido para o root", async () => {
    const { dir, pasta, buscar } = await montar("// motor novo\n");
    const drenos: boolean[] = [];
    const a = iniciarAtualizacao({ url: "https://nod", dir, pastaDoMotor: pasta, turnosRodando: () => 0, drenar: (s) => drenos.push(s), buscar, intervaloMs: 3_600_000, esperaDoPuxarMs: 0, relogio: () => 42 });
    await a.agora();
    expect(drenos).toEqual([true]);
    expect(JSON.parse(await readFile(arquivoDoPedido(pasta), "utf8"))).toEqual({ versao: "0.5.0", em: 42 });
    a.parar();
    expect(drenos).toEqual([true, false]);
  });

  it("um turno que chegou durante a espera do puxar segura o pedido; igual ao servidor, nada acontece", async () => {
    const comTurno = await montar("// motor novo\n");
    // A decisão vê zero turnos; a conferência depois da espera do puxar vê o turno que chegou nela.
    let consultas = 0;
    const drenos: boolean[] = [];
    const a = iniciarAtualizacao({ url: "https://nod", dir: comTurno.dir, pastaDoMotor: comTurno.pasta, turnosRodando: () => (consultas++ < 1 ? 0 : 1), drenar: (s) => drenos.push(s), buscar: comTurno.buscar, intervaloMs: 3_600_000, esperaDoPuxarMs: 5, relogio: () => 0 });
    await a.agora();
    await expect(readFile(arquivoDoPedido(comTurno.pasta), "utf8")).rejects.toThrow();
    expect(drenos).toEqual([true]);
    a.parar();

    const igual = await montar("// nod-motor.mjs\n");
    const nada: boolean[] = [];
    const b = iniciarAtualizacao({ url: "https://nod", dir: igual.dir, pastaDoMotor: igual.pasta, turnosRodando: () => 0, drenar: (s) => nada.push(s), buscar: igual.buscar, intervaloMs: 3_600_000, esperaDoPuxarMs: 0 });
    await b.agora();
    await expect(readFile(arquivoDoPedido(igual.pasta), "utf8")).rejects.toThrow();
    expect(nada).toEqual([]);
    b.parar();
  });
});

describe("o motor se atualiza sozinho (ADR-100): na instalação", () => {
  const script = scriptDeInstalacao({ servidor: "https://nod.exemplo.com", versao: "0.5.0" });

  it("instala o atualizador do root, o .path que vigia o pedido, e liga por padrão (NOD_ATUALIZAR_SOZINHO=0 desliga)", () => {
    expect(script).toContain('echo "$NOD_SERVIDOR" | $SUDO tee /etc/nod-motor/servidor');
    expect(script).toContain("PathExists=/home/nod/.config/nod-motor/atualizar");
    expect(script).toContain("ExecStart=/usr/local/sbin/nod-motor-atualizar");
    expect(script).toContain('if [ "${NOD_ATUALIZAR_SOZINHO:-1}" = "0" ]; then');
    expect(script).toContain("$SUDO touch /etc/nod-motor/atualizar-sozinho");
    expect(script).toContain("systemctl enable --now nod-motor-atualizar.path");
    execFileSync("sh", ["-n"], { input: script });
    // O atualizador também é shell válido por si.
    const atualizador = /<<'NODATUALIZAR'\n([\s\S]*?)\nNODATUALIZAR\n/.exec(script)![1]!;
    execFileSync("sh", ["-n"], { input: atualizador });
    expect(atualizador).toContain("install -o root -g root -m 644");
    expect(atualizador).toContain('trap \'rm -rf "$TMP" "$APP.novo"; rm -f "$PEDIDO"\' EXIT');
  });

  it("o root só instala o que bate com o manifesto (a conferência roda de verdade aqui)", async () => {
    const atualizador = /<<'NODATUALIZAR'\n([\s\S]*?)\nNODATUALIZAR\n/.exec(script)![1]!;
    const codigo = /"\$NODE" -e '([^']*)'/.exec(atualizador)![1]!;
    const tmp = await mkdtemp(join(tmpdir(), "nod-atualizar-"));
    const nomes = ["nod-motor.mjs", "proxy.mjs", "hook-nativas.mjs"];
    for (const n of nomes) await writeFile(join(tmp, n), `// ${n}\n`);
    const manifesto = (arquivos: Record<string, string>) => writeFile(join(tmp, "manifesto.json"), JSON.stringify({ versao: "0.5.0", arquivos }));
    await manifesto(Object.fromEntries(nomes.map((n) => [n, sha(`// ${n}\n`)])));
    expect(execFileSync(process.execPath, ["-e", codigo, tmp, ...nomes], { encoding: "utf8" })).toBe("0.5.0");
    await manifesto({ ...Object.fromEntries(nomes.map((n) => [n, sha(`// ${n}\n`)])), "hook-nativas.mjs": sha("adulterado") });
    expect(() => execFileSync(process.execPath, ["-e", codigo, tmp, ...nomes], { stdio: "pipe" })).toThrow();
  });
});
