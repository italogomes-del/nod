import { expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { ErroDeDominio } from "../../src/domain/erro.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { listarSuaVez, type DepsSuaVez } from "../../src/use-cases/listar-sua-vez.ts";
import { PRAZO_REABERTURA_MS, reabrirDecisao } from "../../src/use-cases/reabrir-decisao.ts";
import { emQuanto, foraDoArDesde, haQuanto, nadaEsperando } from "../../web/lib/relogio.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_LEAPY } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_LEAPY, pessoaId: PESSOA_MARLON };
const ANA = { tenantId: TENANT_LEAPY, pessoaId: PESSOA_ANA };
const H = 60 * 60 * 1000;
const DIA = 24 * H;

const deps = (trx: Tx, escopo: Escopo, agora: () => number): DepsSuaVez => ({ repos: criarRepos(trx, escopo), escopo, agora, tx: (fn) => fn(trx) });
const destino = { conector: "exemplo", ferramenta: "enviar_email", argumentos: { para: "bia@leapy.com.br" } };

/**
 * "Sua vez" por PESSOA sob RLS de duas pernas (ADR-007, EMENDA 1) com a decisora como sujeito da
 * consulta; vencida visível com desfecho; reabrir volta ao topo com prazo novo; estados negativos
 * ESCRITOS (E3.3). Tudo sob withRollback: cada teste cria as próprias linhas.
 */
describeIntegracao("Sua vez (listar-sua-vez + reabrir-decisao)", () => {
  it("ana não vê a decisão de marlon; a decisora designada vê a dela; vencida fica visível em cinza com desfecho", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const agora = Date.now();
      const deMarlon = await repos.decisoes.criar({ tipo: "aprovacao", agenteId, conversaId, prazoDecisaoEm: agora + DIA, frase: "3 e-mails" });
      await repos.itensAprovacao.criarLote(deMarlon?.id ?? "", [{ idx: 0, texto: "e-mail para bia", destino, origemSensivel: false }]);
      const paraAna = await repos.decisoes.criar({ tipo: "falta_de_dado", decisorId: PESSOA_ANA, agenteId, conversaId, prazoDecisaoEm: agora + DIA, frase: "falta o CNPJ" });
      const vaiVencer = await repos.decisoes.criar({ tipo: "gate_rotina", agenteId, conversaId, prazoDecisaoEm: agora + 1_000, frase: "rotina das 8h" });
      expect(await repos.decisoes.vencerPendentes(agora + 2_000)).toHaveLength(1);

      const { data: minha } = await listarSuaVez(deps(trx, MARLON, () => agora + 2_000));
      expect(minha.itens.map((i) => [i.decisao.id, i.estadoColuna])).toEqual([
        [deMarlon?.id, "pendente"],
        [vaiVencer?.id, "vencido"],
      ]);
      expect(minha.itens.map((i) => i.decisao.id)).not.toContain(paraAna?.id);
      expect(minha.itens[0]?.itensAprovacao.map((i) => i.textoFinal)).toEqual(["e-mail para bia"]);
      expect(minha.itens[0]?.agenteNome).toBe("Vera");
      expect(minha.itens[1]).toMatchObject({ itensAprovacao: [], decisao: { estado: "vencida", desfecho: { tipo: "expirou_sem_ninguem_ver" } } });
      expect(minha.vazio).toBe(false);

      await vincularEscopo(trx, ANA);
      const { data: daAna } = await listarSuaVez(deps(trx, ANA, () => agora + 2_000));
      expect(daAna.itens.map((i) => i.decisao.id)).toEqual([paraAna?.id]);
      expect(daAna.itens[0]?.agenteNome).toBe("agente");
    });
  });

  it("reabrir volta ao topo (reaberto, prazo novo, sem desfecho) e devolve o evento; pendente → estado_invalido; desconhecida → nao_encontrado", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const agora = Date.now();
      const antiga = await repos.decisoes.criar({ tipo: "aprovacao", agenteId, conversaId, prazoDecisaoEm: agora + 1_000, frase: "a" });
      const pendente = await repos.decisoes.criar({ tipo: "perfil", agenteId, conversaId, prazoDecisaoEm: agora + DIA, frase: "b" });
      await repos.decisoes.vencerPendentes(agora + 2_000);

      const d = deps(trx, MARLON, () => agora + 3_000);
      const r = await reabrirDecisao(d, { decisaoId: antiga?.id ?? "" });
      expect(r.data.decisao).toMatchObject({ id: antiga?.id, estado: "reaberta", desfecho: null, prazoDecisaoEm: new Date(agora + 3_000 + PRAZO_REABERTURA_MS).toISOString() });
      expect(r.events).toHaveLength(1);
      expect(r.events[0]).toMatchObject({
        kind: "decisao_criada",
        pessoaDestinoId: PESSOA_MARLON,
        conversaId,
        autoria: { autor_tipo: "pessoa", autor_id: PESSOA_MARLON, sob_procuracao_de: null, decidido_por: "pessoa" },
        dados: { decisao_id: antiga?.id, reaberta: true },
      });
      await repos.events.gravarComOutbox(r.events);
      expect((await repos.outbox.pendentes()).map((o) => o.tipo)).toEqual(["decisao_criada"]);

      const { data } = await listarSuaVez(d);
      expect(data.itens.map((i) => [i.decisao.id, i.estadoColuna])).toEqual([
        [antiga?.id, "reaberto"],
        [pendente?.id, "pendente"],
      ]);

      await expect(reabrirDecisao(d, { decisaoId: pendente?.id ?? "" })).rejects.toMatchObject({ codigo: "estado_invalido" });
      await expect(reabrirDecisao(d, { decisaoId: antiga?.id ?? "" })).rejects.toBeInstanceOf(ErroDeDominio);
      await expect(reabrirDecisao(d, { decisaoId: "00000000-0000-4000-8000-000000000000" })).rejects.toMatchObject({ codigo: "nao_encontrado" });
    });
  });

  it("'aguardando há 6h' e 'recusa automática em 18h' saem de coluna do banco (criado_em, prazo_decisao_em) e o cliente só interpola", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const criadaEm = Date.now();
      const d = await repos.decisoes.criar({ tipo: "aprovacao", agenteId, conversaId, prazoDecisaoEm: criadaEm + DIA, frase: "x" });
      // medido em 2026-09-17: criado_em e prazo tinham bases 4 ms diferentes; a fixture usa uma origem comum.
      await trx`update decisoes set criado_em = ${new Date(criadaEm)} where id = ${d?.id ?? ""}`;
      const [linha] = await trx<{ criado_em: Date }[]>`select criado_em from decisoes where id = ${d?.id ?? ""}`;
      const agora = (linha?.criado_em.getTime() ?? criadaEm) + 6 * H;
      const { data } = await listarSuaVez(deps(trx, MARLON, () => agora));
      const item = data.itens[0];
      expect(item?.aguardandoHaMs).toBe(6 * H);
      expect(item?.recusaAutomaticaEmMs).toBe(18 * H);
      expect(haQuanto(item?.aguardandoHaMs ?? 0)).toBe("há 6h");
      expect(emQuanto(item?.recusaAutomaticaEmMs ?? 0)).toBe("em 18h");
    });
  });

  it("listar = ver: carimba vista_em nas abertas (não nas vencidas), idempotente; marcarVista:false não toca", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const agora = Date.now();
      const aberta = await repos.decisoes.criar({ tipo: "pergunta", agenteId, conversaId, prazoDecisaoEm: agora + DIA, frase: "?" });
      const vencida = await repos.decisoes.criar({ tipo: "pergunta", agenteId, conversaId, prazoDecisaoEm: agora + 1, frase: "!" });
      await repos.decisoes.vencerPendentes(agora + 1_000);

      const semMarcar = await listarSuaVez(deps(trx, MARLON, () => agora + 2_000), { marcarVista: false });
      expect(semMarcar.data.itens.map((i) => i.decisao.vistaEm)).toEqual([null, null]);

      const marcada = await listarSuaVez(deps(trx, MARLON, () => agora + 2_000));
      expect(marcada.data.itens.find((i) => i.decisao.id === aberta?.id)?.decisao.vistaEm).toBe(new Date(agora + 2_000).toISOString());
      expect(marcada.data.itens.find((i) => i.decisao.id === vencida?.id)?.decisao.vistaEm).toBeNull();
      // A segunda listagem preserva o primeiro carimbo (coalesce).
      const deNovo = await listarSuaVez(deps(trx, MARLON, () => agora + 9_000));
      expect(deNovo.data.itens.find((i) => i.decisao.id === aberta?.id)?.decisao.vistaEm).toBe(new Date(agora + 2_000).toISOString());
      // E é o que separa os dois rótulos de expiração: a aberta, agora vista, vence como 'com alguém ciente'.
      const vencidas = await repos.decisoes.vencerPendentes(agora + 2 * DIA);
      expect(vencidas.map((v) => v.desfecho?.tipo)).toEqual(["expirou_com_alguem_ciente"]);
    });
  });

  it("vazio com carimbo da última decisão e motor 'fora do ar desde' como item escrito (E3.3)", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const agora = Date.now();
      const paraAna = await repos.decisoes.criar({ tipo: "permissao", decisorId: PESSOA_ANA, agenteId, conversaId, prazoDecisaoEm: agora + DIA, frase: "posso?" });
      const desde = Date.UTC(2026, 8, 16, 14, 3, 0);

      await vincularEscopo(trx, ANA);
      const daAna = criarRepos(trx, ANA);
      expect((await daAna.decisoes.decidir(paraAna?.id ?? "", { por: PESSOA_ANA, agora }))?.estado).toBe("decidida");
      await daAna.inventario.registrar("claude-cli", { estado: "ausente", motivo: "binário não encontrado", em: desde });

      const { data } = await listarSuaVez(deps(trx, ANA, () => agora + 2 * H));
      expect(data).toMatchObject({ itens: [], vazio: true, ultimaDecisaoEm: new Date(agora).toISOString(), foraDoAr: [{ nome: "claude-cli", desde }] });
      expect(nadaEsperando(data.ultimaDecisaoEm, agora + 2 * H)).toBe("Nada esperando por você · última decisão há 2h");
      expect(foraDoArDesde(data.foraDoAr[0]?.nome ?? "", data.foraDoAr[0]?.desde ?? 0)).toBe("claude-cli fora do ar desde 14:03");

      await daAna.inventario.registrar("claude-cli", { estado: "pronto", versao: "2.1.272", em: desde + 60_000 });
      expect((await listarSuaVez(deps(trx, ANA, () => agora))).data.foraDoAr).toEqual([]);
    });
  });
});
