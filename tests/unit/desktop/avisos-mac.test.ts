import { describe, expect, it } from "vitest";
import { GRUPO_AVISOS, lerAviso, lerContador, lerPreferencias, lerTemaDesktop, opcoesDoAviso, origemDe, remetenteWebValido } from "../../../desktop/avisos-mac.ts";

/**
 * O que o processo principal aceita da janela web (definido em 2026-09-24, "aviso no Mac"): a página é
 * remota, então remetente e argumentos são conferidos antes de tocar o macOS.
 */
describe("remetente da janela web", () => {
  const servidor = "https://nod.acme.com.br";

  it("só o frame de topo na origem do servidor configurado", () => {
    expect(remetenteWebValido({ frameUrl: "https://nod.acme.com.br/conversa/1", frameDeTopo: true, servidor })).toBe(true);
    expect(remetenteWebValido({ frameUrl: "https://nod.acme.com.br/", frameDeTopo: false, servidor })).toBe(false);
    expect(remetenteWebValido({ frameUrl: "https://nod.acme.com.br.evil.com/", frameDeTopo: true, servidor })).toBe(false);
    expect(remetenteWebValido({ frameUrl: "http://nod.acme.com.br/", frameDeTopo: true, servidor })).toBe(false);
    expect(remetenteWebValido({ frameUrl: "file:///Applications/nod.app/setup.html", frameDeTopo: true, servidor })).toBe(false);
    expect(remetenteWebValido({ frameUrl: "data:text/html,oi", frameDeTopo: true, servidor })).toBe(false);
  });

  it("sem servidor configurado, ninguém", () => {
    expect(remetenteWebValido({ frameUrl: "https://nod.acme.com.br/", frameDeTopo: true, servidor: undefined })).toBe(false);
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

  it("preferencias.json: ausente ou corrompido, os avisos nascem ligados e o tema segue o sistema", () => {
    expect(lerPreferencias(null)).toEqual({ avisos: true, tema: "sistema", som: true });
    expect(lerPreferencias("{")).toEqual({ avisos: true, tema: "sistema", som: true });
    expect(lerPreferencias('{"avisos":"sim"}')).toEqual({ avisos: true, tema: "sistema", som: true });
    expect(lerPreferencias('{"avisos":false}')).toEqual({ avisos: false, tema: "sistema", som: true });
  });

  it("preferencias.json: o tema só aceita sistema, claro e escuro (ADR-070)", () => {
    expect(lerPreferencias('{"avisos":false,"tema":"escuro"}')).toEqual({ avisos: false, tema: "escuro", som: true });
    expect(lerPreferencias('{"tema":"roxo"}')).toEqual({ avisos: true, tema: "sistema", som: true });
    expect(lerTemaDesktop("claro")).toBe("claro");
    expect(lerTemaDesktop("<script>")).toBeNull();
    expect(lerTemaDesktop(1)).toBeNull();
  });

  it("preferencias.json: o som (NOD-196) nasce ligado sem arquivo, corrompido, ausente ou não booleano", () => {
    expect(lerPreferencias(null).som).toBe(true);
    expect(lerPreferencias("{").som).toBe(true);
    expect(lerPreferencias("[]").som).toBe(true);
    expect(lerPreferencias('{"avisos":false}').som).toBe(true);
    expect(lerPreferencias('{"som":"nao"}').som).toBe(true);
    expect(lerPreferencias('{"som":0}').som).toBe(true);
    expect(lerPreferencias('{"som":null}').som).toBe(true);
    expect(lerPreferencias('{"som":false}')).toEqual({ avisos: true, tema: "sistema", som: false });
    // Com os avisos desligados, a escolha do som continua guardada.
    expect(lerPreferencias('{"avisos":false,"tema":"claro","som":false}')).toEqual({ avisos: false, tema: "claro", som: false });
  });

  it("preferencias.json: gravar e reler (JSON.stringify, como gravarPreferencias) mantém avisos, tema e som", () => {
    // definirSom grava `{ ...preferencias, som }`: trocar o som não pode apagar avisos nem tema, e vice-versa.
    for (const p of [
      { avisos: false, tema: "escuro" as const, som: false },
      { avisos: true, tema: "claro" as const, som: false },
      { avisos: false, tema: "sistema" as const, som: true },
    ]) {
      expect(lerPreferencias(JSON.stringify(p))).toEqual(p);
      expect(lerPreferencias(JSON.stringify({ ...p, som: !p.som }))).toEqual({ ...p, som: !p.som });
    }
    // Arquivo de antes da NOD-196 (sem `som`): avisos e tema ficam, o som nasce ligado.
    expect(lerPreferencias(JSON.stringify({ avisos: false, tema: "escuro" }))).toEqual({ avisos: false, tema: "escuro", som: true });
  });
});

describe("opcoesDoAviso (NOD-196)", () => {
  const aviso = { titulo: "Nina precisa de você", corpo: "Aprovar o envio?", alvo: { tipo: "sua-vez" as const } };

  it("som desligado → silent: true; ligado → silent: false; título, corpo e grupo iguais aos de antes", () => {
    expect(opcoesDoAviso(aviso, { som: false })).toEqual({ title: "Nina precisa de você", body: "Aprovar o envio?", groupId: "nod-sua-vez", silent: true });
    expect(opcoesDoAviso(aviso, { som: true })).toEqual({ title: "Nina precisa de você", body: "Aprovar o envio?", groupId: "nod-sua-vez", silent: false });
    expect(GRUPO_AVISOS).toBe("nod-sua-vez");
  });

  it("não leva o alvo nem nada além das quatro opções ao macOS", () => {
    expect(Object.keys(opcoesDoAviso(aviso, { som: true })).sort()).toEqual(["body", "groupId", "silent", "title"]);
  });
});

describe("NOD-114: alvo da task e um grupo por bot", () => {
  const trabalho = { tipo: "trabalho" as const, trabalhoId: "tr-1", agenteId: "ag-1", conversaId: "c-1" };

  it("lerAlvo aceita o alvo trabalho e recusa id fora do padrão", () => {
    expect(lerAviso({ titulo: "Nina", corpo: "x", alvo: trabalho })).toEqual({ titulo: "Nina", corpo: "x", alvo: trabalho });
    expect(lerAviso({ titulo: "Nina", corpo: "x", alvo: { ...trabalho, trabalhoId: "../../etc" } })).toBeNull();
    expect(lerAviso({ titulo: "Nina", corpo: "x", alvo: { ...trabalho, agenteId: "a b" } })).toBeNull();
    expect(lerAviso({ titulo: "Nina", corpo: "x", alvo: { ...trabalho, conversaId: "x".repeat(65) } })).toBeNull();
    expect(lerAviso({ titulo: "Nina", corpo: "x", alvo: { tipo: "trabalho", trabalhoId: "tr-1", agenteId: "ag-1" } })).toBeNull();
  });

  it("o grupo é o bot: id validado, copiado, e vira um groupId por bot dentro do grupo do nod", () => {
    const aviso = lerAviso({ titulo: "Nina", corpo: "x", alvo: { tipo: "sua-vez" }, grupo: "ag-1" });
    expect(aviso).toEqual({ titulo: "Nina", corpo: "x", alvo: { tipo: "sua-vez" }, grupo: "ag-1" });
    expect(lerAviso({ titulo: "Nina", corpo: "x", alvo: { tipo: "sua-vez" }, grupo: "../x" })).toBeNull();
    expect(lerAviso({ titulo: "Nina", corpo: "x", alvo: { tipo: "sua-vez" }, grupo: 3 })).toBeNull();
    expect(opcoesDoAviso(aviso!, { som: true }).groupId).toBe(`${GRUPO_AVISOS}:ag-1`);
    expect(opcoesDoAviso({ ...aviso!, grupo: "ag-2" }, { som: true }).groupId).not.toBe(opcoesDoAviso(aviso!, { som: true }).groupId);
  });
});
