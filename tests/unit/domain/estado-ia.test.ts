import { describe, expect, it } from "vitest";
import { ESTADOS_IA, type InstalacaoDaIa, type LoginDaIa } from "../../../src/contracts/estado-ia.ts";
import type { Inventario } from "../../../src/contracts/inventario.ts";
import { estadoDaIa, MENSAGEM_DO_ESTADO } from "../../../src/domain/estado-ia.ts";
import { configInvalida, faltaNode } from "../../../src/domain/saida-do-cli.ts";

const T = 1_800_000_000_000;
const de = (inventario: Inventario | null, extra: Partial<Parameters<typeof estadoDaIa>[0]> = {}) => estadoDaIa({ ia: "codex-cli", inventario, agora: T, ...extra });
const LOGIN: LoginDaIa = { fase: "aguardando", url: "https://auth.openai.com/codex/device", codigoDoDispositivo: "ABCD-EFGHI", pedeCodigo: false, codigoEnviado: false, expiraEm: T + 900_000, verificarDeNovo: false, mensagem: "Abra o link" };
const INSTALANDO: InstalacaoDaIa = { fase: "instalando", linha: "npm http fetch GET 200", tentativa: 1, mensagem: "Instalando o Codex…" };

describe("estado único da IA (2026-10-09)", () => {
  it("cada inventário vira um estado, sem confundir config quebrada nem falta de node com falta de login", () => {
    expect(de(null).estado).toBe("procurando");
    expect(de({ estado: "pronto", versao: "0.162.1", em: T })).toMatchObject({ estado: "pronta", versao: "0.162.1" });
    expect(de({ estado: "ausente", motivo: "x", em: T }).estado).toBe("nao_instalada");
    expect(de({ estado: "ausente", motivo: "x", causa: "cli_antigo", versao: "0.147.0", minima: "0.159.0", em: T })).toMatchObject({ estado: "desatualizada", versao: "0.147.0", minima: "0.159.0" });
    expect(de({ estado: "ausente", motivo: "x", causa: "sem_node", em: T }).estado).toBe("sem_node");
    expect(de({ estado: "ausente", motivo: "x", causa: "config_invalida", em: T }).estado).toBe("config_invalida");
    expect(de({ estado: "ausente", motivo: "x", causa: "sonda_lenta", em: T }).estado).toBe("lenta");
    expect(de({ estado: "nao_autenticado", motivo: "x", causa: "sonda_lenta", em: T }).estado).toBe("lenta");
    expect(de({ estado: "nao_autenticado", motivo: "x", em: T }).estado).toBe("falta_entrar");
    expect(de({ estado: "nao_autenticado", motivo: "x", causa: "conta_sem_acesso", em: T })).toMatchObject({ estado: "sem_acesso", causa: "conta_sem_acesso" });
    expect(de({ estado: "nao_autenticado", motivo: "x", causa: "teste_falhou", em: T })).toMatchObject({ estado: "sem_acesso", causa: "teste_falhou" });
  });

  it("instalando › entrando › testando › o inventário; o que já terminou vai junto sem mudar o estado", () => {
    const inv: Inventario = { estado: "nao_autenticado", motivo: "x", em: T };
    expect(de(inv, { instalacao: INSTALANDO, login: LOGIN, testando: true })).toMatchObject({ estado: "instalando", instalacao: INSTALANDO });
    expect(de(inv, { login: LOGIN, testando: true })).toMatchObject({ estado: "entrando", login: LOGIN });
    expect(de(inv, { testando: true }).estado).toBe("testando");
    const fim = { ...LOGIN, fase: "falhou" as const, causa: "login_por_codigo_bloqueado" as const };
    expect(de(inv, { login: fim })).toMatchObject({ estado: "falta_entrar", login: fim });
  });

  it("no limite só com um prazo futuro e a IA pronta; o detalhe diz qual binário e de onde", () => {
    const pronto: Inventario = { estado: "pronto", versao: "2.1.296", em: T };
    expect(de(pronto, { limiteAte: T + 3_600_000 })).toMatchObject({ estado: "no_limite", ate: T + 3_600_000, versao: "2.1.296" });
    expect(de(pronto, { limiteAte: T - 1 }).estado).toBe("pronta");
    expect(de(pronto, { binario: { caminho: "~/.nvm/versions/node/v26.7.0/bin/codex", origem: "nvm" } }).detalhe).toEqual({ binario: "~/.nvm/versions/node/v26.7.0/bin/codex", origem: "nvm" });
  });

  it("todo estado tem frase", () => {
    for (const e of ESTADOS_IA) expect(MENSAGEM_DO_ESTADO[e].length).toBeGreaterThan(3);
  });
});

describe("o que a saída do CLI diz sobre o próprio CLI (2026-10-09)", () => {
  it("falta de node: o `env` do macOS e as variações de shell", () => {
    expect(faltaNode("env: node: No such file or directory")).toBe(true);
    expect(faltaNode("/usr/bin/env: ‘node’: No such file or directory")).toBe(true);
    expect(faltaNode("sh: node: command not found")).toBe(true);
    expect(faltaNode("codex-cli 0.162.1")).toBe(false);
  });

  it("config quebrada da pessoa conta; a recusa de uma chave do próprio nod (-c override) não", () => {
    expect(configInvalida("Error loading configuration: /Users/a/.codex/config.toml:1:9: string values must be quoted")).toBe(true);
    expect(configInvalida("Error loading config.toml: unknown configuration field `x` in -c/--config override")).toBe(false);
    expect(configInvalida("Not logged in")).toBe(false);
  });
});
