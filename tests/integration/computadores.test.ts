import { expect, it } from "vitest";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_LEAPY } from "../helpers/ids.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import { randomUUID } from "node:crypto";
const escopo = {tenantId:TENANT_LEAPY,pessoaId:PESSOA_MARLON};
describeIntegracao("computador persistente por bot",()=>{
  it("mantém IDs distintos, vínculo estável e libera somente a reserva correta",async()=>{
    await withRollback(escopo,async trx=>{
      const a=await agenteComConversa(trx,escopo);const b=await agenteComConversa(trx,escopo);
      const c=await a.repos.computadores.obter(a.agenteId);const outro=await b.repos.computadores.obter(b.agenteId);
      expect(c!.id).not.toBe(outro!.id);expect(c!.id).not.toBe(a.agenteId);
      expect((await a.repos.computadores.obter(a.agenteId))!.id).toBe(c!.id);
      const lease=randomUUID();const ate=Date.now()+60000;
      await a.repos.computadores.ocupar(c!.id,lease,ate);
      await a.repos.computadores.liberar(c!.id,randomUUID());
      expect((await a.repos.computadores.travar(c!.id))!.ocupadoAte).toBe(ate);
      await a.repos.computadores.liberar(c!.id,lease);
      expect((await a.repos.computadores.travar(c!.id))!.ocupadoAte).toBeNull();
    });
  });
  it("outra pessoa não vê nem muda computador, arquivos ou ações de um bot compartilhado em leitura",async()=>{
    await withRollback(escopo,async trx=>{
      const a=await agenteComConversa(trx,escopo);
      const c=await a.repos.computadores.obter(a.agenteId);
      const acao=await a.repos.computadores.registrar({computadorId:c!.id,autor:"bot",tipo:"digitar",estado:"pendente",argumentosCifrados:"cifrado"});
      await trx`update agentes set visibility = 'equipe' where id = ${a.agenteId}`;
      const ana={tenantId:TENANT_LEAPY,pessoaId:PESSOA_ANA};await vincularEscopo(trx,ana);
      const repos=criarRepos(trx,ana);
      expect(await repos.computadores.obter(a.agenteId)).toBeNull();
      expect(await repos.computadores.travar(c!.id)).toBeNull();
      expect(await repos.computadores.buscarAcao(acao.id)).toBeNull();
      expect(await trx`select * from computadores where id = ${c!.id}`).toHaveLength(0);
      expect(await trx`update computadores set controle = 'pessoa' where id = ${c!.id} returning id`).toHaveLength(0);
      await vincularEscopo(trx,escopo);
      expect((await a.repos.computadores.travar(c!.id))!.controle).toBe("bot");
    });
  });
});
