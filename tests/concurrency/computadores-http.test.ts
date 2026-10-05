import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lerTexto, gravarTexto } from "../../infra/computador/texto.mjs";
import type { AcaoComputador, ComputadorDto, DriverComputador, ResultadoComputador } from "../../src/contracts/computador.ts";
import type { Agente } from "../../src/contracts/agente.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
import type { PlanoTurno } from "../../src/contracts/plano-turno.ts";
import type { ItemAprovacao } from "../../src/contracts/item-aprovacao.ts";
import type { ResultadoChamada } from "../../src/use-cases/chamar-ferramenta.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";
const quadro="a".repeat(64);
describeIntegracao("computadores: autorização e controle pelo servidor completo",()=>{
  let srv: ServidorCompleto;
  let bot: {agente:Agente;conversa:Conversa};
  let plano: PlanoTurno;
  let raizArquivos: string;
  const efeitos: {id:string;acao:AcaoComputador}[]=[];
  const ativos=new Set<string>();
  let bloquear: (()=>Promise<void>)|undefined;
  const driver: DriverComputador={
    estado:async id=>({disponivel:true,ativo:ativos.has(id),motivo:null}),
    iniciar:async id=>{ativos.add(id);},parar:async id=>{ativos.delete(id);},ligados:async()=>new Set(ativos),
    executar:async(id,acao)=>{
      efeitos.push({id,acao});await bloquear?.();
      if (acao.tipo === "ler_texto" || acao.tipo === "gravar_texto") {
        const pasta = join(raizArquivos, id); await mkdir(pasta, {recursive:true});
        return acao.tipo === "ler_texto" ? lerTexto(join(pasta, acao.caminho), acao.inicio, acao.revisao) : gravarTexto(join(pasta, acao.caminho), acao.texto, acao.revisao);
      }
      return {tela:{quadro,imagem:"iVBORw0KGgo=",largura:1280,altura:800,titulo:"Teste",url:"https://example.com",texto:"Site não confiável",abas:[]}};
    },
  };
  beforeAll(async()=>{
    raizArquivos = await mkdtemp(join(tmpdir(), "nod-computador-http-"));
    srv=await servidorCompleto({computador:driver,env:{NOD_MODO:"compartilhado"},intervalos:{orquestradorMs:3600000,schedulerMs:3600000,expiracaoMs:3600000}});
    bot=await srv.json("POST","agentes",{dono:"pessoa",interativo:true});
  },30000);
  // O plano é lido no PUXAR: desde a emenda da ADR-037 (24/09), computador desligado sai do catálogo —
  // quem liga no meio do teste emite o plano de novo.
  const emitirPlano=()=>srv.app.dentro(srv.pessoa,async d=>{
    await d.tx(async trx=>{await trx`update agentes set confirmado = true where id = ${bot.agente.id}`;});
    const t=await d.repos.turnos.enfileirar({agenteId:bot.agente.id,conversaId:bot.conversa.id,origem:"conversa",prazoEm:Date.now()+600000,profundidade:0,entradaTexto:"Use seu computador",entradaConfianca:"confiavel",modelo:"auto",harness:"auto"});
    plano=(await emitirPlanoTurno(d,{turnoId:t!.id,machineId:randomUUID(),executor:"catcher"})).data;
  });
  beforeEach(emitirPlano,30000);
  afterAll(async()=>{if(srv){await srv.fechar();await limparPessoaE2E(srv.db,srv.dbDono,srv.pessoa,{agentes:[bot.agente.id],conversas:[bot.conversa.id]});await srv.desligar();}if(raizArquivos)await rm(raizArquivos,{recursive:true,force:true});},30000);
  const consultar=()=>srv.json<ComputadorDto>("GET",`agentes/${bot.agente.id}/computador`);
  const configurar=(operacao:string)=>srv.json("POST",`agentes/${bot.agente.id}/computador`,{operacao});
  const humano=(acao:AcaoComputador)=>srv.chamar("POST",`agentes/${bot.agente.id}/computador/acoes`,acao);
  async function chamar(nome:string,argumentos:Record<string,unknown>={}):Promise<ResultadoChamada>{
    const r=await fetch(`${srv.url}/api/interno/ferramentas/${nome}`,{method:"POST",headers:{authorization:`Bearer ${plano.tokenDeTurno}`,"content-type":"application/json"},body:JSON.stringify({argumentos})});
    expect(r.status).toBe(200);return await r.json() as ResultadoChamada;
  }
  it("um plano autorizado recebe ferramentas de computador e screenshot MCP, sem confiar no site",async()=>{
    expect(plano.catalogo.ferramentas.some(f=>f.nome==="computador_observar")).toBe(true);
    expect(await chamar("computador_observar")).toMatchObject({ok:true,confianca:"nao_confiavel",imagem:{mimeType:"image/png"}});
    expect((await consultar()).ativo).toBe(true);
    const outra=srv.sessaoDe({tenantId:srv.pessoa.tenantId,pessoaId:randomUUID()});
    expect((await srv.chamar("GET",`agentes/${bot.agente.id}/computador`,undefined,outra)).status).toBe(404);
  });
  it("aprovação prepara antes de executar, executa uma vez e não permite alterar a descrição da ação",async()=>{
    const antes=efeitos.length;
    const r=await chamar("computador_navegar",{url:"https://example.com"});
    expect(r).toHaveProperty("aguardar");expect(efeitos.length).toBe(antes);
    if(!("aguardar" in r))throw new Error("aprovação ausente");
    const itens=await srv.app.dentro(srv.pessoa,d=>d.repos.itensAprovacao.listar(r.aguardar));
    const item=itens[0]!;
    expect((await srv.chamar("POST",`decisoes/${r.aguardar}/decidir`,{itens:[{id:item.id,selecionado:true,textoFinal:"Uma ação diferente"}]})).status).toBe(400);
    const resposta=await srv.chamar("POST",`decisoes/${r.aguardar}/decidir`,{itens:[{id:item.id,selecionado:true}]});
    expect(resposta.status).toBe(200);expect(efeitos.length).toBe(antes+1);
    expect((await srv.chamar("POST",`decisoes/${r.aguardar}/decidir`,{itens:[{id:item.id,selecionado:true}]})).status).toBe(409);
    const guardado=await srv.app.dentro(srv.pessoa,d=>d.repos.computadores.buscarAcao(String(item.destino.argumentos.acaoId)));
    expect(guardado).toMatchObject({estado:"concluida",argumentosCifrados:null});
  });
  it("takeover bloqueia bot, humano digita sem gravar segredo e devolver permite o bot continuar",async()=>{
    await configurar("assumir");const antes=efeitos.length;
    expect(await chamar("computador_observar")).toMatchObject({ok:true,conteudo:expect.stringContaining("aguardando_pessoa")});
    expect(efeitos.length).toBe(antes);
    expect((await humano({tipo:"digitar",texto:"SEGREDO-APENAS-NA-SESSAO",quadro})).status).toBe(200);
    expect(JSON.stringify(await consultar())).not.toContain("SEGREDO-APENAS-NA-SESSAO");
    await configurar("devolver");await configurar("autonomo");
    expect(await chamar("computador_navegar",{url:"https://example.com"})).toMatchObject({ok:true});
    expect((await humano({tipo:"clicar",x:1,y:1,quadro})).status).toBe(403);
  });
  it("a reserva impede duas ações simultâneas; desligar impede religamento por ação atrasada",async()=>{
    await configurar("assumir");let iniciou!:()=>void;let liberar!:()=>void;
    const inicio=new Promise<void>(r=>{iniciou=r;});const espera=new Promise<void>(r=>{liberar=r;});
    bloquear=async()=>{iniciou();await espera;};
    const primeira=humano({tipo:"terminal",comando:"echo teste"});await inicio;
    expect((await humano({tipo:"observar"})).status).toBe(409);
    await configurar("parar");liberar();await primeira;bloquear=undefined;
    expect((await consultar()).ativo).toBe(false);
    expect((await humano({tipo:"observar"})).status).toBe(403);
    expect((await consultar()).ativo).toBe(false);
  });
  it("pedido de login retoma por Devolver, preservando a inteligência original",async()=>{
    await configurar("iniciar");await configurar("devolver");await emitirPlano();
    const r=await chamar("computador_pedir_ajuda",{motivo:"Entrar no portal"});expect(r).toMatchObject({ok:true});
    const c=await consultar();expect(c.computador).toMatchObject({controle:"aguardando_pessoa",ajuda:"Entrar no portal"});
    await configurar("assumir");await configurar("devolver");
    const d=await srv.app.dentro(srv.pessoa,x=>x.repos.decisoes.buscar(c.computador.ajudaDecisaoId!));
    expect(d!.estado).toBe("decidida");
    const itens:ItemAprovacao[]=await srv.app.dentro(srv.pessoa,x=>x.repos.itensAprovacao.listar(d!.id));expect(itens).toHaveLength(0);
    const tela=await (await humano({tipo:"observar"})).json() as ResultadoComputador;expect(tela.tela!.quadro).toBe(quadro);
  });
  it("texto passa pelo catálogo, aprovação e revisão antes de alterar arquivos reais",async()=>{
    await configurar("supervisionado");
    const antes=efeitos.length;
    const r=await chamar("computador_gravar_texto",{caminho:"relatorio.txt",texto:"Primeiro relatório",revisao:"novo"});
    expect(r).toHaveProperty("aguardar");expect(efeitos.length).toBe(antes);
    if(!("aguardar" in r))throw new Error("aprovação ausente");
    const itens=await srv.app.dentro(srv.pessoa,d=>d.repos.itensAprovacao.listar(r.aguardar));
    expect((await srv.chamar("POST",`decisoes/${r.aguardar}/decidir`,{itens:[{id:itens[0]!.id,selecionado:true}]})).status).toBe(200);
    const leitura=await chamar("computador_ler_texto",{caminho:"relatorio.txt"});
    expect(leitura).toMatchObject({ok:true,confianca:"nao_confiavel"});
    if(!("conteudo" in leitura))throw new Error("leitura ausente");
    const dado=JSON.parse(leitura.conteudo) as ResultadoComputador;
    expect(dado.texto!.conteudo).toBe("Primeiro relatório");
    await configurar("autonomo");
    expect(await chamar("computador_gravar_texto",{caminho:"relatorio.txt",texto:"Relatório revisado",revisao:dado.texto!.revisao})).toMatchObject({ok:true,isError:false});
    expect(await chamar("computador_gravar_texto",{caminho:"relatorio.txt",texto:"versão antiga",revisao:dado.texto!.revisao})).toMatchObject({ok:true,isError:true});
    const c=await consultar();
    expect(await readFile(join(raizArquivos,c.computador.id,"relatorio.txt"),"utf8")).toBe("Relatório revisado");
  });
  it("excluir desliga processos; restaurar conserva o vínculo sem religar",async()=>{
    const c=await consultar();
    expect((await srv.chamar("DELETE",`agentes/${bot.agente.id}`)).status).toBe(200);
    expect(ativos.has(c.computador.id)).toBe(false);
    expect((await srv.chamar("GET",`agentes/${bot.agente.id}/computador`)).status).toBe(404);
    expect((await srv.chamar("POST",`agentes/${bot.agente.id}/restaurar`,{})).status).toBe(200);
    const restaurado=await consultar();expect(restaurado.computador.id).toBe(c.computador.id);expect(restaurado.computador.habilitado).toBe(false);
  });
});
