import { describe, expect, it } from "vitest";
import { ETAPAS_INSTALACAO, MOTIVOS_INSTALACAO } from "../../../src/contracts/instalacoes-ssh.ts";
import { ERROS_DO_SCRIPT, ETAPAS_DO_SCRIPT } from "../../../src/adapters/http/motor-instalacao.ts";
import {
  INSTALADORA_VIVA_MS, MAX_CREDENCIAL, MAX_INSTALACOES_POR_PESSOA, PRAZO_INSTALACAO_MS,
  credencialValida, criarInstalacoesPorSsh, hostValido, usuarioValido, type NovoPedido,
} from "../../../src/services/instalacoes-por-ssh.ts";

/**
 * NOD-94 (emenda 11 da ADR-090): os pedidos de instalação por SSH em memória. A credencial cifrada sai do servidor UMA
 * vez, para a instaladora escolhida; pedidos por pessoa têm teto e prazo; nada atravessa pessoa nem tenant.
 */
const MARLON = { tenantId: "t1", pessoaId: "marlon" };
const ANA = { tenantId: "t1", pessoaId: "ana" };
const MARLON_OUTRO_TENANT = { tenantId: "t2", pessoaId: "marlon" };
const VM = "11111111-1111-4111-8111-111111111111";
const MAC = "22222222-2222-4222-8222-222222222222";
const PUB = "TUlJQklqQU5CZ2txaGtpRzl3MEJBUUVGQUFPQ0FROEFNSUlCQ2dLQ0FRRUE=";
const CIFRADO = { chave: "QUJD", iv: "REVG", dados: "R0hJ" };
const IMP_A = `SHA256:${"a".repeat(43)}`;
const IMP_B = `SHA256:${"b".repeat(43)}`;

function montar() {
  let agora = 1_760_000_000_000;
  const inst = criarInstalacoesPorSsh(() => agora);
  let convites = 0;
  const pedido = (o: Partial<NovoPedido> = {}): NovoPedido => ({
    escopo: MARLON, host: "vm.exemplo.com", porta: 22, usuario: "root", metodo: "chave", impressaoConhecida: null, servidor: "https://nod.exemplo.com",
    criarConvite: () => `convite-${++convites}`, ...o,
  });
  return { inst, pedido, convites: () => convites, passar: (ms: number) => { agora += ms; } };
}

describe("instalações por SSH", () => {
  it("as etapas e os motivos do contrato cobrem os do script de instalação", () => {
    expect([...ETAPAS_INSTALACAO]).toEqual([...ETAPAS_DO_SCRIPT]);
    for (const m of ERROS_DO_SCRIPT) expect(MOTIVOS_INSTALACAO).toContain(m);
  });

  it("sem instaladora viva o pedido é recusado (e o convite nem nasce); a padrão é a que puxou por último", () => {
    const { inst, pedido, convites, passar } = montar();
    expect(inst.pedir(pedido())).toBe("sem_instaladora");
    expect(convites()).toBe(0);
    inst.anunciarInstaladora(MARLON, VM, { chavePublica: PUB, plataforma: "linux" });
    passar(1_000);
    inst.anunciarInstaladora(MARLON, MAC, { chavePublica: "QUFB", plataforma: "darwin" });
    expect(inst.instaladoras(MARLON).map((i) => i.machineId)).toEqual([MAC, VM]);
    expect(inst.pedir(pedido())).toMatchObject({ origemId: MAC, chavePublica: "QUFB" });
    expect(inst.pedir(pedido({ origemId: VM }))).toMatchObject({ origemId: VM, chavePublica: PUB });
    // Escolher uma máquina que não é instaladora viva não cai na padrão.
    expect(inst.pedir(pedido({ origemId: "33333333-3333-4333-8333-333333333333" }))).toBe("sem_instaladora");
    // Parada há mais de 15 s, não é oferecida.
    passar(INSTALADORA_VIVA_MS + 1);
    expect(inst.instaladoras(MARLON)).toEqual([]);
  });

  it("o modo apelido só sai pelo Mac", () => {
    const { inst, pedido } = montar();
    inst.anunciarInstaladora(MARLON, VM, { chavePublica: PUB, plataforma: "linux" });
    expect(inst.pedir(pedido({ metodo: "apelido", usuario: "" }))).toBe("apelido_so_no_mac");
    inst.anunciarInstaladora(MARLON, MAC, { chavePublica: PUB, plataforma: "darwin" });
    const r = inst.pedir(pedido({ metodo: "apelido", usuario: "", origemId: MAC }));
    if (typeof r === "string") throw new Error(r);
    // Sem credencial: a instaladora recebe o pedido na próxima puxada.
    expect(inst.ver(MARLON, r.id)?.pedeCredencial).toBe(false);
    expect(inst.pendentes(MARLON, MAC)).toEqual([expect.objectContaining({ id: r.id, metodo: "apelido" })]);
  });

  it("a credencial cifrada sai do servidor UMA vez, só para a instaladora do pedido; nunca aparece na tela", () => {
    const { inst, pedido } = montar();
    inst.anunciarInstaladora(MARLON, VM, { chavePublica: PUB, plataforma: "linux" });
    const r = inst.pedir(pedido());
    if (typeof r === "string") throw new Error(r);
    // Sem a credencial, a instaladora ainda não vê o pedido.
    expect(inst.pendentes(MARLON, VM)).toEqual([]);
    expect(inst.ver(MARLON, r.id)).toMatchObject({ estado: "esperando", pedeCredencial: true });
    expect(inst.entregarCredencial(MARLON, r.id, CIFRADO)).toBe("ok");
    expect(inst.entregarCredencial(MARLON, r.id, CIFRADO)).toBe("nao_pede");
    expect(JSON.stringify(inst.ver(MARLON, r.id))).not.toContain(CIFRADO.dados);
    expect(inst.pendentes(MARLON, MAC)).toEqual([]);
    expect(inst.pendentes(ANA, VM)).toEqual([]);
    expect(inst.pendentes(MARLON, VM)).toEqual([{ id: r.id, host: "vm.exemplo.com", porta: 22, usuario: "root", metodo: "chave", impressaoConhecida: null, convite: "convite-1", servidor: "https://nod.exemplo.com", cifrado: CIFRADO }]);
    expect(inst.pendentes(MARLON, VM)).toEqual([]);
    expect(inst.ver(MARLON, r.id)).toMatchObject({ estado: "conferindo", pedeCredencial: false });
    // Com o pedido já entregue, uma credencial nova é recusada.
    expect(inst.entregarCredencial(MARLON, r.id, CIFRADO)).toBe("nao_pede");
  });

  it("o progresso anda pelas etapas; só a instaladora do pedido relata; o pareamento põe pronta", () => {
    const { inst, pedido } = montar();
    inst.anunciarInstaladora(MARLON, VM, { chavePublica: PUB, plataforma: "linux" });
    const r = inst.pedir(pedido());
    if (typeof r === "string") throw new Error(r);
    // Antes da entrega, nada é aceito.
    expect(inst.progresso(MARLON, VM, { id: r.id, etapa: "conferencia" }).aceito).toBe(false);
    inst.entregarCredencial(MARLON, r.id, CIFRADO);
    inst.pendentes(MARLON, VM);
    expect(inst.progresso(MARLON, MAC, { id: r.id, etapa: "pacotes" }).aceito).toBe(false);
    expect(inst.progresso(ANA, VM, { id: r.id, etapa: "pacotes" }).aceito).toBe(false);
    expect(inst.progresso(MARLON, VM, { id: r.id, etapa: "conferencia", impressao: IMP_A }).pedido).toMatchObject({ estado: "conferindo", etapa: "conferencia" });
    expect(inst.progresso(MARLON, VM, { id: r.id, etapa: "node" }).pedido).toMatchObject({ estado: "instalando", etapa: "node" });
    expect(inst.progresso(MARLON, VM, { id: r.id, etapa: "pareamento" }).pedido).toMatchObject({ estado: "pareando" });
    expect(inst.progresso(MARLON, VM, { id: r.id, impressao: "não é impressão", etapa: "pronta" }).aceito).toBe(false);
    // O convite de outra pessoa não fecha o pedido.
    expect(inst.pareada(ANA, "convite-1", "m")).toBeNull();
    expect(inst.pareada(MARLON, "convite-1", "maquina-nova")).toEqual({ id: r.id, host: "vm.exemplo.com", porta: 22, usuario: "root", impressao: IMP_A });
    expect(inst.ver(MARLON, r.id)).toMatchObject({ estado: "pronta", maquinaId: "maquina-nova" });
    // O "pronta" do script que chega depois do pareamento é aceito e não muda nada.
    expect(inst.progresso(MARLON, VM, { id: r.id, etapa: "pronta" })).toMatchObject({ aceito: true, pedido: { estado: "pronta" } });
    expect(inst.progresso(MARLON, VM, { id: r.id, erro: "instalacao_falhou" }).aceito).toBe(false);
  });

  it("host key trocada: mostra as duas impressões; confiar na nova volta a esperar a credencial", () => {
    const { inst, pedido } = montar();
    inst.anunciarInstaladora(MARLON, VM, { chavePublica: PUB, plataforma: "linux" });
    const r = inst.pedir(pedido({ impressaoConhecida: IMP_A }));
    if (typeof r === "string") throw new Error(r);
    inst.entregarCredencial(MARLON, r.id, CIFRADO);
    expect(inst.pendentes(MARLON, VM)[0]?.impressaoConhecida).toBe(IMP_A);
    expect(inst.confiarNova(MARLON, r.id)).toBeNull();
    inst.progresso(MARLON, VM, { id: r.id, erro: "chave_do_servidor_mudou", impressao: IMP_B });
    expect(inst.ver(MARLON, r.id)).toMatchObject({ estado: "erro", motivo: "chave_do_servidor_mudou", impressoes: { antiga: IMP_A, nova: IMP_B } });
    expect(inst.confiarNova(ANA, r.id)).toBeNull();
    expect(inst.confiarNova(MARLON, r.id)).toEqual({ host: "vm.exemplo.com", porta: 22, impressao: IMP_B });
    expect(inst.ver(MARLON, r.id)).toMatchObject({ estado: "esperando", pedeCredencial: true, impressoes: null, motivo: null });
    // O relato atrasado da rodada anterior não vale mais.
    expect(inst.progresso(MARLON, VM, { id: r.id, etapa: "pacotes" }).aceito).toBe(false);
    inst.entregarCredencial(MARLON, r.id, CIFRADO);
    expect(inst.pendentes(MARLON, VM)[0]).toMatchObject({ impressaoConhecida: IMP_B, cifrado: CIFRADO });
  });

  it("instalacao_falhou guarda no máximo 20 linhas, cada uma cortada", () => {
    const { inst, pedido } = montar();
    inst.anunciarInstaladora(MARLON, VM, { chavePublica: PUB, plataforma: "linux" });
    const r = inst.pedir(pedido());
    if (typeof r === "string") throw new Error(r);
    inst.entregarCredencial(MARLON, r.id, CIFRADO);
    inst.pendentes(MARLON, VM);
    const linhas = Array.from({ length: 30 }, (_, i) => `linha ${i} ${"x".repeat(400)}`);
    inst.progresso(MARLON, VM, { id: r.id, erro: "instalacao_falhou", etapa: "node", linhas });
    const v = inst.ver(MARLON, r.id)!;
    expect(v).toMatchObject({ estado: "erro", motivo: "instalacao_falhou" });
    expect(v.linhas).toHaveLength(20);
    expect(v.linhas[0]).toMatch(/^linha 10 /);
    expect(v.linhas.every((l) => l.length <= 300)).toBe(true);
  });

  it("expira: sem credencial vira tempo_esgotado; pareando vira nao_pareou; terminado some depois de 10 min", () => {
    const { inst, pedido, passar } = montar();
    inst.anunciarInstaladora(MARLON, VM, { chavePublica: PUB, plataforma: "linux" });
    const a = inst.pedir(pedido());
    const b = inst.pedir(pedido({ host: "outra.exemplo.com" }));
    if (typeof a === "string" || typeof b === "string") throw new Error("pedido");
    expect(a.expiraEm).toBe(b.expiraEm);
    inst.entregarCredencial(MARLON, b.id, CIFRADO);
    inst.pendentes(MARLON, VM);
    inst.progresso(MARLON, VM, { id: b.id, etapa: "pareamento" });
    passar(PRAZO_INSTALACAO_MS);
    expect(inst.ver(MARLON, a.id)).toMatchObject({ estado: "erro", motivo: "tempo_esgotado" });
    expect(inst.ver(MARLON, b.id)).toMatchObject({ estado: "erro", motivo: "nao_pareou" });
    expect(inst.entregarCredencial(MARLON, a.id, CIFRADO)).toBe("nao_pede");
    passar(10 * 60_000 + 1);
    expect(inst.ver(MARLON, a.id)).toBeNull();
  });

  it("limite por pessoa: o quarto pedido aberto é recusado; cancelar libera a vaga e avisa a instaladora uma vez", () => {
    const { inst, pedido } = montar();
    inst.anunciarInstaladora(MARLON, VM, { chavePublica: PUB, plataforma: "linux" });
    inst.anunciarInstaladora(ANA, VM, { chavePublica: PUB, plataforma: "linux" });
    const ids: string[] = [];
    for (let i = 0; i < MAX_INSTALACOES_POR_PESSOA; i++) {
      const r = inst.pedir(pedido({ host: `vm${i}.exemplo.com` }));
      if (typeof r === "string") throw new Error(r);
      ids.push(r.id);
    }
    expect(inst.pedir(pedido())).toBe("muitos_pedidos");
    // O limite é de cada pessoa.
    expect(typeof inst.pedir(pedido({ escopo: ANA }))).toBe("object");
    inst.entregarCredencial(MARLON, ids[0]!, CIFRADO);
    inst.pendentes(MARLON, VM);
    expect(inst.cancelar(ANA, ids[0]!)).toBeNull();
    expect(inst.cancelar(MARLON, ids[0]!)).toBe("convite-1");
    expect(inst.cancelar(MARLON, ids[0]!)).toBeNull();
    expect(inst.pendentes(MARLON, VM)).toEqual([expect.objectContaining({ id: ids[0], cancelado: true })]);
    expect(inst.pendentes(MARLON, VM)).toEqual([]);
    // O cancelado não pareia: o convite dele não fecha nada.
    expect(inst.pareada(MARLON, "convite-1", "m")).toBeNull();
    expect(typeof inst.pedir(pedido())).toBe("object");
  });

  it("escopo por tenant: a mesma pessoa em outro tenant não vê, não cancela e não recebe o pedido", () => {
    const { inst, pedido } = montar();
    inst.anunciarInstaladora(MARLON, VM, { chavePublica: PUB, plataforma: "linux" });
    const r = inst.pedir(pedido());
    if (typeof r === "string") throw new Error(r);
    expect(inst.ver(MARLON_OUTRO_TENANT, r.id)).toBeNull();
    expect(inst.entregarCredencial(MARLON_OUTRO_TENANT, r.id, CIFRADO)).toBe("sem_pedido");
    expect(inst.cancelar(MARLON_OUTRO_TENANT, r.id)).toBeNull();
    expect(inst.instaladoras(MARLON_OUTRO_TENANT)).toEqual([]);
    expect(inst.pedir(pedido({ escopo: MARLON_OUTRO_TENANT }))).toBe("sem_instaladora");
    inst.entregarCredencial(MARLON, r.id, CIFRADO);
    expect(inst.pendentes(MARLON_OUTRO_TENANT, VM)).toEqual([]);
    expect(inst.pareada(MARLON_OUTRO_TENANT, "convite-1", "m")).toBeNull();
  });

  it("a instaladora que reiniciou (par novo) derruba os pedidos dela em nao_pareou", () => {
    const { inst, pedido } = montar();
    inst.anunciarInstaladora(MARLON, VM, { chavePublica: PUB, plataforma: "linux" });
    const r = inst.pedir(pedido());
    if (typeof r === "string") throw new Error(r);
    inst.entregarCredencial(MARLON, r.id, CIFRADO);
    inst.anunciarInstaladora(MARLON, VM, { chavePublica: PUB, plataforma: "linux" });
    expect(inst.ver(MARLON, r.id)?.estado).toBe("esperando");
    inst.anunciarInstaladora(MARLON, VM, { chavePublica: "QUFB", plataforma: "linux" });
    expect(inst.ver(MARLON, r.id)).toMatchObject({ estado: "erro", motivo: "nao_pareou" });
    expect(inst.pendentes(MARLON, VM)).toEqual([]);
  });

  it("validação: host e usuário que viram opção do ssh ou shell são recusados; credencial tem teto de 16 KB", () => {
    expect(hostValido("vm.exemplo.com")).toBe("vm.exemplo.com");
    expect(hostValido("2001:db8::1")).toBe("2001:db8::1");
    expect(hostValido("-oProxyCommand=sh")).toBeNull();
    expect(hostValido("vm;rm -rf /")).toBeNull();
    expect(hostValido("")).toBeNull();
    expect(usuarioValido("ubuntu")).toBe("ubuntu");
    expect(usuarioValido("-l")).toBeNull();
    expect(usuarioValido("a b")).toBeNull();
    expect(credencialValida({ ...CIFRADO, dados: "A".repeat(MAX_CREDENCIAL) })).not.toBeNull();
    expect(credencialValida({ ...CIFRADO, dados: "A".repeat(MAX_CREDENCIAL + 4) })).toBeNull();
    expect(credencialValida({ ...CIFRADO, dados: "não é base64" })).toBeNull();
  });
});
