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
import { computadorPadrao } from "../../src/domain/computador.ts";
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
  // NOD-162: cada CHAMADA de driver.iniciar (onde o container nasce e liga), para travar o adiamento.
  const inicios:string[]=[];
  const novos:{agente:Agente;conversa:Conversa}[]=[];
  let bloquear: (()=>Promise<void>)|undefined;
  const driver: DriverComputador={
    ambiente:async()=>({disponivel:true,motivo:null}),
    estado:async id=>({disponivel:true,ativo:ativos.has(id),motivo:null}),
    iniciar:async id=>{inicios.push(id);ativos.add(id);},parar:async id=>{ativos.delete(id);},ligados:async()=>new Set(ativos),
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
  const emitirPlano=(b=bot)=>srv.app.dentro(srv.pessoa,async d=>{
    await d.tx(async trx=>{await trx`update agentes set confirmado = true where id = ${b.agente.id}`;});
    const t=await d.repos.turnos.enfileirar({agenteId:b.agente.id,conversaId:b.conversa.id,origem:"conversa",prazoEm:Date.now()+600000,profundidade:0,entradaTexto:"Use seu computador",entradaConfianca:"confiavel",modelo:"auto",harness:"auto"});
    plano=(await emitirPlanoTurno(d,{turnoId:t!.id,machineId:randomUUID(),executor:"catcher"})).data;
  });
  beforeEach(()=>emitirPlano(),30000);
  afterAll(async()=>{if(srv){await srv.fechar();await limparPessoaE2E(srv.db,srv.dbDono,srv.pessoa,{agentes:[bot.agente.id,...novos.map(n=>n.agente.id)],conversas:[bot.conversa.id,...novos.map(n=>n.conversa.id)]});await srv.desligar();}if(raizArquivos)await rm(raizArquivos,{recursive:true,force:true});},30000);
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
    expect(await readFile(join(raizArquivos,c.computador.id!,"relatorio.txt"),"utf8")).toBe("Relatório revisado");
  });
  it("excluir desliga processos; restaurar conserva o vínculo sem religar",async()=>{
    const c=await consultar();
    expect((await srv.chamar("DELETE",`agentes/${bot.agente.id}`)).status).toBe(200);
    expect(ativos.has(c.computador.id!)).toBe(false);
    expect((await srv.chamar("GET",`agentes/${bot.agente.id}/computador`)).status).toBe(404);
    expect((await srv.chamar("POST",`agentes/${bot.agente.id}/restaurar`,{})).status).toBe(200);
    const restaurado=await consultar();expect(restaurado.computador.id).toBe(c.computador.id);expect(restaurado.computador.habilitado).toBe(false);
  });
  // NOD-162: o computador só nasce na primeira ferramenta computador_* que executa. Um bot novo por caso, para o
  // vínculo começar nulo; o contador `inicios` conta chamadas de driver.iniciar.
  const botNovo=async()=>{const b=await srv.json<{agente:Agente;conversa:Conversa}>("POST","agentes",{dono:"pessoa",interativo:true});novos.push(b);return b;};
  // Lido por SQL, não pelo GET (até a NOD-192, o GET do painel criava a linha em `computadores`).
  const vinculo=(b:{agente:Agente})=>srv.app.dentro(srv.pessoa,d=>d.tx(async trx=>(await trx<{computador_id:string|null}[]>`select computador_id from agentes where id = ${b.agente.id}`)[0]!.computador_id));
  it("(a) plano emitido e turno sem computador_*: nenhum iniciar e agentes.computador_id nulo",async()=>{
    const b=await botNovo();const antes=inicios.length;
    await emitirPlano(b);
    expect(plano.catalogo.ferramentas.some(f=>f.nome==="computador_observar")).toBe(true);
    expect(inicios.length).toBe(antes);
    expect(await vinculo(b)).toBeNull();
  });
  it("(b) a 1ª computador_observar chama iniciar uma vez e cria o vínculo",async()=>{
    const b=await botNovo();await emitirPlano(b);const antes=inicios.length;
    expect(await vinculo(b)).toBeNull();
    expect(await chamar("computador_observar")).toMatchObject({ok:true});
    const id=await vinculo(b);
    expect(id).not.toBeNull();
    expect(inicios.slice(antes)).toEqual([id]);
  });
  it("(c) supervisionado (padrão, modo manual): card pendente não liga; aprovar liga uma vez; recusar não liga",async()=>{
    const b=await botNovo();await emitirPlano(b);const antes=inicios.length;
    const r=await chamar("computador_interagir",{tipo:"clicar",x:1,y:1,quadro});
    if(!("aguardar" in r))throw new Error("aprovação ausente");
    expect(inicios.length).toBe(antes);
    const id=await vinculo(b);
    const [item]=await srv.app.dentro(srv.pessoa,d=>d.repos.itensAprovacao.listar(r.aguardar));
    expect((await srv.chamar("POST",`decisoes/${r.aguardar}/decidir`,{itens:[{id:item!.id,selecionado:true}]})).status).toBe(200);
    expect(inicios.slice(antes)).toEqual([id]);
    await emitirPlano(b);
    const outra=await chamar("computador_interagir",{tipo:"clicar",x:2,y:2,quadro});
    if(!("aguardar" in outra))throw new Error("aprovação ausente");
    const [recusado]=await srv.app.dentro(srv.pessoa,d=>d.repos.itensAprovacao.listar(outra.aguardar));
    expect((await srv.chamar("POST",`decisoes/${outra.aguardar}/decidir`,{itens:[{id:recusado!.id,selecionado:false}]})).status).toBe(200);
    expect(inicios.slice(antes)).toEqual([id]);
  });
  it("(d) GET do computador (painel) não chama iniciar e mostra desligado",async()=>{
    const b=await botNovo();const antes=inicios.length;
    const c=await srv.json<ComputadorDto>("GET",`agentes/${b.agente.id}/computador`);
    expect(c.ativo).toBe(false);
    expect(inicios.length).toBe(antes);
  });
  // NOD-192: abrir o painel só lê — não cria a linha, não preenche o vínculo e não pega FOR UPDATE.
  // Pelo escopo da pessoa: o dono do banco não vê as linhas (FORCE RLS só com policies para nod_app).
  const linhas=()=>srv.app.dentro(srv.pessoa,d=>d.tx(async trx=>(await trx<{n:number}[]>`select count(*)::int as n from computadores`)[0]!.n));
  it("(e) GET de bot sem computador: 200 com o padrão desligado, nada gravado; a 1ª ação cria uma vez só",async()=>{
    // Um computador de outro bot antes: prova que a contagem enxerga as linhas desta pessoa.
    const comLinha=await botNovo();await srv.json("POST",`agentes/${comLinha.agente.id}/computador`,{operacao:"iniciar"});
    const b=await botNovo();const antes=await linhas();
    expect(antes).toBeGreaterThan(0);
    const c=await srv.json<ComputadorDto>("GET",`agentes/${b.agente.id}/computador`);
    expect(c).toEqual({computador:computadorPadrao(b.agente.id),disponivel:true,ativo:false,motivo:null,atividade:[]});
    await srv.json<ComputadorDto>("GET",`agentes/${b.agente.id}/computador`);
    expect(await linhas()).toBe(antes);
    expect(await vinculo(b)).toBeNull();
    expect((await srv.chamar("GET",`agentes/${randomUUID()}/computador`)).status).toBe(404);
    const outra=srv.sessaoDe({tenantId:srv.pessoa.tenantId,pessoaId:randomUUID()});
    expect((await srv.chamar("GET",`agentes/${b.agente.id}/computador`,undefined,outra)).status).toBe(404);
    // "Ligar": cria o vínculo uma vez; o GET seguinte é o de um computador que existe.
    const ini=inicios.length;
    await srv.json("POST",`agentes/${b.agente.id}/computador`,{operacao:"iniciar"});
    const id=await vinculo(b);
    expect(id).not.toBeNull();expect(await linhas()).toBe(antes+1);expect(inicios.slice(ini)).toEqual([id]);
    const depois=await srv.json<ComputadorDto>("GET",`agentes/${b.agente.id}/computador`);
    expect(depois.computador.id).toBe(id);expect(depois.ativo).toBe(true);
    expect(await linhas()).toBe(antes+1);
  });
  it("(f) GET de bot com computador: a linha do banco e o estado do driver, como antes",async()=>{
    const b=await botNovo();
    await srv.json("POST",`agentes/${b.agente.id}/computador`,{operacao:"iniciar"});
    await srv.json("POST",`agentes/${b.agente.id}/computador`,{operacao:"autonomo"});
    const linha=await srv.app.dentro(srv.pessoa,d=>d.repos.computadores.buscarVinculo(b.agente.id));
    const atividade=await srv.app.dentro(srv.pessoa,d=>d.repos.computadores.atividade(linha!.id));
    const c=await srv.json<ComputadorDto>("GET",`agentes/${b.agente.id}/computador`);
    expect(c).toEqual({computador:linha,atividade,...await driver.estado(linha!.id)});
    expect(c.computador.politica).toBe("autonomo");
  });
  it("(g) o GET não espera uma transação que segura o agente e o computador em FOR UPDATE",async()=>{
    for (const comComputador of [false,true]) {
      const b=await botNovo();
      if(comComputador)await srv.json("POST",`agentes/${b.agente.id}/computador`,{operacao:"iniciar"});
      const status=await srv.app.dentro(srv.pessoa,d=>d.tx(async trx=>{
        await trx`select id from agentes where id = ${b.agente.id} for update`;
        await trx`select c.id from computadores c join agentes a on a.tenant_id = c.tenant_id and a.computador_id = c.id where a.id = ${b.agente.id} for update of c`;
        const prazo=new Promise<"esperou">(r=>setTimeout(()=>r("esperou"),5000));
        return Promise.race([srv.chamar("GET",`agentes/${b.agente.id}/computador`).then(r=>r.status),prazo]);
      }));
      expect(status).toBe(200);
    }
  },30000);
});
