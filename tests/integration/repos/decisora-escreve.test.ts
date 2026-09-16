import { expect, it } from "vitest";
import { DECISOES } from "../../../src/db/schema/decisoes.ts";
import { vincularEscopo } from "../../../src/db/tx.ts";
import { criarRepos } from "../../../src/repositories/index.ts";
import { expectRejected } from "../../helpers/expect-rejected.ts";
import { agenteComConversa } from "../../helpers/fabricas.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_LEAPY } from "../../helpers/ids.ts";
import { describeIntegracao } from "../../helpers/integracao.ts";
import { withRollback } from "../../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_LEAPY, pessoaId: PESSOA_MARLON };
const ANA = { tenantId: TENANT_LEAPY, pessoaId: PESSOA_ANA };
const DIA = 24 * 60 * 60 * 1000;
const destino = (i: number) => ({ conector: "exemplo", ferramenta: "enviar_email", argumentos: { para: `p${i}@leapy.com.br` } });

/**
 * 0003: a perna extra da EMENDA 1 passa a ESCREVER pela policy nod_decisora (PERMISSIVE, só FOR
 * UPDATE, USING e WITH CHECK por decisor_id). Tudo sob o role nod_app: quem concede é o Postgres,
 * não um filtro na aplicação. Ana é a decisora designada de uma decisão de Marlon e nada mais.
 */
describeIntegracao("decisora designada escreve (0003, policy nod_decisora)", () => {
  it("ana decide a decisão de marlon dirigida a ela, marca os itens, e NÃO decide (nem vê) a outra", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const agora = Date.now();
      const paraAna = await repos.decisoes.criar({ tipo: "aprovacao", decisorId: PESSOA_ANA, agenteId, conversaId, prazoDecisaoEm: agora + DIA, frase: "2 e-mails; quem decide: Ana" });
      const soMarlon = await repos.decisoes.criar({ tipo: "aprovacao", agenteId, conversaId, prazoDecisaoEm: agora + DIA, frase: "só de marlon" });
      const itens = await repos.itensAprovacao.criarLote(paraAna?.id ?? "", [
        { idx: 0, texto: "e-mail para bia", destino: destino(0), origemSensivel: false },
        { idx: 1, texto: "e-mail para caio", destino: destino(1), origemSensivel: true, justificativa: "veio de conector que toca aprendiz" },
      ]);
      const itemDeMarlon = (await repos.itensAprovacao.criarLote(soMarlon?.id ?? "", [{ idx: 0, texto: "x", destino: destino(2), origemSensivel: false }]))[0];

      await vincularEscopo(trx, ANA);
      const comoAna = criarRepos(trx, ANA);

      // Ana vê só a dela (leitura pela perna extra, como antes).
      expect((await comoAna.decisoes.listarSuaVez(agora)).map((d) => d.id)).toEqual([paraAna?.id]);
      expect(await comoAna.decisoes.buscar(soMarlon?.id ?? "")).toBeNull();
      expect((await comoAna.itensAprovacao.listar(paraAna?.id ?? "")).map((i) => i.idx)).toEqual([0, 1]);
      expect(await comoAna.itensAprovacao.buscar(itemDeMarlon?.id ?? "")).toBeNull();

      // Marca o item sensível como PESSOA (CHECK item_sensivel_marcado_exige_pessoa satisfeito por ela).
      const marcado = await comoAna.itensAprovacao.marcar(itens[1]?.id ?? "", { selecionado: true, agora });
      expect(marcado).toMatchObject({ selecionado: true, marcadoPor: PESSOA_ANA });
      expect(await comoAna.itensAprovacao.marcar(itemDeMarlon?.id ?? "", { selecionado: false, agora })).toBeNull();

      // Marca vista e DECIDE — o UPDATE passa pelo WITH CHECK da nod_decisora, não pela owner_id.
      expect(await comoAna.decisoes.marcarVista(paraAna?.id ?? "", agora)).toBe(true);
      const decidida = await comoAna.decisoes.decidir(paraAna?.id ?? "", { por: PESSOA_ANA, agora });
      expect(decidida).toMatchObject({ estado: "decidida", ownerId: PESSOA_MARLON, decisorId: PESSOA_ANA, desfecho: { tipo: "decidida", por: PESSOA_ANA } });
      // Segunda vez: já decidida → null (idempotência na rota).
      expect(await comoAna.decisoes.decidir(paraAna?.id ?? "", { por: PESSOA_ANA, agora })).toBeNull();
      // A que não é dirigida a ela: null pelo repo E zero linhas pelo SQL cru (a policy não a enxerga).
      expect(await comoAna.decisoes.decidir(soMarlon?.id ?? "", { por: PESSOA_ANA, agora })).toBeNull();
      expect(await comoAna.decisoes.marcarVista(soMarlon?.id ?? "", agora)).toBe(false);
      const cru = await trx`update decisoes set estado = 'decidida' where id = ${soMarlon?.id ?? ""}`;
      expect(cru.count).toBe(0);

      // Marlon (dono) vê o desfecho gravado pela decisora, com decidida_por = ana.
      await vincularEscopo(trx, MARLON);
      expect((await repos.decisoes.buscar(paraAna?.id ?? ""))?.desfecho).toEqual({ tipo: "decidida", por: PESSOA_ANA, em: new Date(agora).toISOString() });
      const [linha] = await trx<{ decidida_por: string; vista_em: Date | null }[]>`select decidida_por, vista_em from decisoes where id = ${paraAna?.id ?? ""}`;
      expect(linha?.decidida_por).toBe(PESSOA_ANA);
      expect(linha?.vista_em).not.toBeNull();
      expect((await repos.itensAprovacao.buscar(itens[1]?.id ?? ""))?.marcadoPor).toBe(PESSOA_ANA);
    });
  });

  it("a policy só afrouxa UPDATE: INSERT em nome da dona continua 42501 e as pernas são imutáveis sob o UPDATE da decisora", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const agora = Date.now();
      const paraAna = await repos.decisoes.criar({ tipo: "pergunta", decisorId: PESSOA_ANA, agenteId, conversaId, prazoDecisaoEm: agora + DIA, frase: "?" });
      const item = (await repos.itensAprovacao.criarLote(paraAna?.id ?? "", [{ idx: 0, texto: "x", destino: destino(0), origemSensivel: false }]))[0];

      await vincularEscopo(trx, ANA);
      // INSERT: a decisora não cria decisão em nome de Marlon (WITH CHECK da nod_pessoa; nod_decisora é FOR UPDATE).
      await expectRejected(
        trx,
        () => trx`insert into decisoes (tenant_id, owner_id, decisor_id, agente_id, conversa_id, tipo, prazo_decisao_em, frase)
          values (${TENANT_LEAPY}, ${PESSOA_MARLON}, ${PESSOA_ANA}, ${agenteId}, ${conversaId}, 'pergunta', now(), 'ana fingindo marlon')`,
        "42501",
      );
      // UPDATE que tenta virar dona ou trocar a decisora: trigger P0001 (nunca chega a passar pelo WITH CHECK).
      const e1 = await expectRejected(trx, () => trx`update decisoes set owner_id = ${PESSOA_ANA} where id = ${paraAna?.id ?? ""}`, "P0001");
      expect(e1.message).toContain("imutáveis");
      await expectRejected(trx, () => trx`update decisoes set decisor_id = ${PESSOA_MARLON} where id = ${paraAna?.id ?? ""}`, "P0001");
      await expectRejected(trx, () => trx`update itens_aprovacao set owner_id = ${PESSOA_ANA} where id = ${item?.id ?? ""}`, "P0001");
      // O UPDATE legítimo da mesma linha continua passando depois dos SAVEPOINTs desfeitos.
      expect((await criarRepos(trx, ANA).decisoes.decidir(paraAna?.id ?? "", { por: PESSOA_ANA, agora }))?.estado).toBe("decidida");

      // A policy e os triggers existem com os nomes declarados em src/db/schema/decisoes.ts.
      const policies = await trx<{ tablename: string; policyname: string; cmd: string; permissive: string }[]>`
        select tablename, policyname, cmd, permissive from pg_policies where policyname = ${DECISOES.policyDecisora} order by tablename`;
      expect(policies).toEqual([
        { tablename: DECISOES.tabela, policyname: DECISOES.policyDecisora, cmd: "UPDATE", permissive: "PERMISSIVE" },
        { tablename: DECISOES.itens.tabela, policyname: DECISOES.itens.policyDecisora, cmd: "UPDATE", permissive: "PERMISSIVE" },
      ]);
      const triggers = await trx<{ tgname: string }[]>`select tgname from pg_trigger where tgname in (${DECISOES.trigger}, ${DECISOES.itens.trigger}) order by tgname`;
      expect(triggers.map((t) => t.tgname)).toEqual([DECISOES.trigger, DECISOES.itens.trigger].sort());
    });
  });
});
