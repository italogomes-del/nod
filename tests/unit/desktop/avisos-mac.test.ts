import { describe, expect, it } from "vitest";
import { lerAviso, lerContador, lerPreferencias, origemDe, remetenteWebValido } from "../../../desktop/avisos-mac.ts";

/**
 * O que o processo principal aceita da janela web (definido em 2026-09-24, "aviso no Mac"): a página é
 * remota, então remetente e argumentos são conferidos antes de tocar o macOS.
 */
describe("remetente da janela web", () => {
  const servidor = "https://nod.leapy.com.br";

  it("só o frame de topo na origem do servidor configurado", () => {
    expect(remetenteWebValido({ frameUrl: "https://nod.leapy.com.br/conversa/1", frameDeTopo: true, servidor })).toBe(true);
    expect(remetenteWebValido({ frameUrl: "https://nod.leapy.com.br/", frameDeTopo: false, servidor })).toBe(false);
    expect(remetenteWebValido({ frameUrl: "https://nod.leapy.com.br.evil.com/", frameDeTopo: true, servidor })).toBe(false);
    expect(remetenteWebValido({ frameUrl: "http://nod.leapy.com.br/", frameDeTopo: true, servidor })).toBe(false);
    expect(remetenteWebValido({ frameUrl: "file:///Applications/nod.app/setup.html", frameDeTopo: true, servidor })).toBe(false);
    expect(remetenteWebValido({ frameUrl: "data:text/html,oi", frameDeTopo: true, servidor })).toBe(false);
  });

  it("sem servidor configurado, ninguém", () => {
    expect(remetenteWebValido({ frameUrl: "https://nod.leapy.com.br/", frameDeTopo: true, servidor: undefined })).toBe(false);
    expect(origemDe("não é url")).toBeNull();
    expect(origemDe("data:text/html,oi")).toBeNull();
  });
});

describe("argumentos", () => {
  it("o aviso vem copiado, com texto dentro do teto e alvo conhecido", () => {
    const alvo = { tipo: "conversa", conversaId: "7f0c1b8e-1111-4a2b-9c3d-000000000001", agenteId: "7f0c1b8e-1111-4a2b-9c3d-000000000002", extra: "x" };
    expect(lerAviso({ titulo: "Nina precisa de você", corpo: "Posso ler o Gmail?", alvo, html: "<b>" })).toEqual({
      titulo: "Nina precisa de você",
      corpo: "Posso ler o Gmail?",
      alvo: { tipo: "conversa", conversaId: alvo.conversaId, agenteId: alvo.agenteId },
    });
    expect(lerAviso({ titulo: "2 pedidos esperando por você", corpo: "", alvo: { tipo: "sua-vez" } })).toMatchObject({ alvo: { tipo: "sua-vez" } });
  });

  it("recusa título vazio, texto longo, alvo estranho e o que não é objeto", () => {
    expect(lerAviso({ titulo: " ", corpo: "x", alvo: { tipo: "sua-vez" } })).toBeNull();
    expect(lerAviso({ titulo: "x".repeat(121), corpo: "x", alvo: { tipo: "sua-vez" } })).toBeNull();
    expect(lerAviso({ titulo: "x", corpo: "x".repeat(301), alvo: { tipo: "sua-vez" } })).toBeNull();
    expect(lerAviso({ titulo: "x", corpo: "x", alvo: { tipo: "conversa", conversaId: "../../etc", agenteId: "a" } })).toBeNull();
    expect(lerAviso({ titulo: "x", corpo: "x", alvo: { tipo: "url", url: "https://evil.com" } })).toBeNull();
    expect(lerAviso("oi")).toBeNull();
    expect(lerAviso(null)).toBeNull();
  });

  it("o número do Dock é inteiro de 0 a 9999", () => {
    expect(lerContador(3)).toBe(3);
    expect(lerContador(0)).toBe(0);
    expect(lerContador(123_456)).toBe(9_999);
    expect(lerContador(-1)).toBeNull();
    expect(lerContador(1.5)).toBeNull();
    expect(lerContador("3")).toBeNull();
  });

  it("preferencias.json: ausente ou corrompido, os avisos nascem ligados", () => {
    expect(lerPreferencias(null)).toEqual({ avisos: true });
    expect(lerPreferencias("{")).toEqual({ avisos: true });
    expect(lerPreferencias('{"avisos":"sim"}')).toEqual({ avisos: true });
    expect(lerPreferencias('{"avisos":false}')).toEqual({ avisos: false });
  });
});
