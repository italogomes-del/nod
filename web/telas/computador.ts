import type { AcaoComputador, ComputadorDto, ResultadoComputador, TelaComputador } from "../../src/contracts/computador.ts";
import type { Api } from "../lib/api.ts";
import { esc } from "../lib/render.ts";

export function abrirComputador(api: Api, agente: { id: string; nome: string }): void {
  document.querySelector<HTMLDialogElement>(".computador-dialog")?.close();
  const dialog = document.createElement("dialog");
  dialog.className = "computador-dialog";
  dialog.setAttribute("aria-label", `Computador de ${agente.nome}`);
  dialog.innerHTML = `<header class="computador-header"><div><span class="computador-kicker">COMPUTADOR DO BOT</span><h2>${esc(agente.nome)}</h2></div><span class="computador-status" role="status">Conectando…</span><button type="button" data-c="fechar" aria-label="Fechar computador">✕</button></header>
    <div class="computador-toolbar"><button data-c="iniciar">Ligar computador</button><button data-c="assumir">Assumir controle</button><button data-c="devolver">Devolver ao bot</button><button data-c="parar">Desligar</button><button data-c="atualizar">Atualizar tela</button><label>Bot pode agir<select aria-label="Permissão do bot"><option value="supervisionado">Com aprovação por ação</option><option value="autonomo">Nas tarefas que eu pedir</option></select></label></div>
    <p class="computador-ajuda" role="status">Seu navegador, logins e arquivos ficam neste computador.</p><p class="computador-erro" role="alert"></p>
    <div class="computador-layout"><section class="computador-desktop"><form class="computador-url"><label class="sr-only" for="computador-url">Endereço do navegador</label><input id="computador-url" name="url" placeholder="https://…" autocomplete="off" /><button>Abrir</button></form>
      <div class="computador-abas"></div><div class="computador-browser-dialog" hidden><p></p><input aria-label="Resposta ao diálogo do navegador" /><button data-c="aceitar-dialogo">Confirmar</button><button data-c="recusar-dialogo">Cancelar</button></div><div class="computador-viewport"><div class="computador-vazio">Um espaço de trabalho só deste bot.<small>Ligue o computador para abrir a tela.</small></div><img hidden alt="Tela do computador do bot" tabindex="0" draggable="false" /></div>
      <div class="computador-input"><form class="computador-texto"><input type="password" autocomplete="off" aria-label="Texto para digitar no computador" placeholder="Cole texto ou senha aqui para digitar na tela" /><button>Digitar</button></form><button data-c="enter">Enter</button><button data-c="tab">Tab</button><button data-c="esc">Esc</button><button data-c="audio">Ouvir 5 s</button></div><audio controls hidden></audio><p class="computador-dica">Assuma o controle para clicar e digitar. Clique na tela para usar o teclado. Senhas são enviadas diretamente ao computador.</p>
    </section><aside class="computador-lateral"><details open><summary>Arquivos</summary><p>Arquivos e downloads em /workspace</p><form class="computador-pasta"><input aria-label="Pasta" value="." /><button>Ver</button></form><label class="computador-upload">Enviar arquivo<input type="file" /></label><div class="computador-arquivos"></div></details>
      <details><summary>Terminal</summary><form class="computador-terminal"><textarea aria-label="Comando no computador" placeholder="python3 --version" rows="3"></textarea><button>Executar</button></form><pre class="computador-saida"></pre></details>
      <details open><summary>Atividade recente</summary><ol class="computador-atividade"></ol></details></aside></div>`;
  document.body.append(dialog); dialog.showModal();
  const q = <T extends Element = HTMLElement>(s: string) => dialog.querySelector<T>(s)!;
  let dto: ComputadorDto | undefined;
  let tela: TelaComputador | undefined;
  let ocupado = false;
  let operando = false;
  let configuracao: string | null = null;
  let terminou = false;
  let audioUrl: string | undefined;
  let proximaLeitura = 0;
  let fila: Promise<void> = Promise.resolve();
  let teclas = "";
  let timerTeclas: number | undefined;
  let timerClique: number | undefined;
  const erro = (texto: string) => { q(".computador-erro").textContent = texto; };
  const controla = () => dto?.computador.controle === "pessoa" && dto.ativo;
  function pintarEstado() {
    if (!dto) return;
    const c = dto.computador;
    q(".computador-status").textContent = configuracao === "iniciar" ? "Ligando computador…" : configuracao === "parar" ? "Desligando…" : !dto.disponivel ? "Ambiente indisponível" : !dto.ativo ? "Desligado" : c.controle === "pessoa" ? "Você está no controle" : c.controle === "aguardando_pessoa" ? "Precisa de você" : c.ocupadoAte && c.ocupadoAte > Date.now() ? "Bot trabalhando" : "Pronto para o bot";
    q(".computador-ajuda").textContent = dto.motivo ?? c.ajuda ?? "Entre nos seus apps uma vez neste computador. Use Devolver ao bot quando terminar.";
    q<HTMLSelectElement>("select").value = c.politica;
    q<HTMLButtonElement>('[data-c="iniciar"]').disabled = operando || !dto.disponivel || dto.ativo;
    q<HTMLButtonElement>('[data-c="parar"]').disabled = !dto.ativo && configuracao !== "iniciar";
    q<HTMLButtonElement>('[data-c="assumir"]').disabled = operando || !dto.ativo || c.controle === "pessoa";
    q<HTMLButtonElement>('[data-c="devolver"]').disabled = operando || !dto.ativo || c.controle === "bot";
    q<HTMLImageElement>("img").classList.toggle("controlavel", Boolean(controla()));
    q(".computador-atividade").innerHTML = dto.atividade.slice(0,12).map(a => `<li><b>${a.autor === "pessoa" ? "Você" : esc(agente.nome)}</b> · ${esc(a.tipo.replaceAll("_", " "))}<small>${esc(a.estado.replaceAll("_", " "))} · ${new Date(a.em).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small></li>`).join("") || "<li>Nenhuma ação ainda.</li>";
  }
  function resultado(r: ResultadoComputador) {
    if (terminou) return;
    if (r.tela) {
      tela = r.tela;
      q(".computador-browser-dialog").hidden = !tela.dialogo;
      q(".computador-browser-dialog p").textContent = tela.dialogo?.mensagem ?? "";
      const img = q<HTMLImageElement>("img"); img.src = `data:image/png;base64,${tela.imagem}`; img.hidden = false;
      q(".computador-vazio").hidden = true;
      const url = q<HTMLInputElement>(".computador-url input"); if (document.activeElement !== url) url.value = tela.url;
      q(".computador-abas").innerHTML = tela.abas.map((a,i) => `<button data-aba="${i}" class="${a.ativa ? "ativa" : ""}">${esc(a.titulo || a.url || "Nova aba")}</button>`).join("");
    }
    if (r.saida !== undefined) q(".computador-saida").textContent = r.saida + (r.codigoSaida === undefined ? "" : `\nCódigo de saída: ${r.codigoSaida}`);
    if (r.arquivos) q(".computador-arquivos").innerHTML = r.arquivos.map(a => `<button data-arquivo="${esc(a.caminho)}" data-diretorio="${a.diretorio}">${a.diretorio ? "▸" : "↓"} ${esc(a.nome)} <small>${a.diretorio ? "pasta" : `${Math.ceil(a.tamanho / 1024)} KB`}</small></button>`).join("") || "<p>Pasta vazia.</p>";
    if (r.arquivo) baixar(r.arquivo.nome, r.arquivo.base64);
    if (r.audio) {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      audioUrl = URL.createObjectURL(blob(r.audio.data, "audio/wav"));
      const audio = q<HTMLAudioElement>("audio"); audio.src = audioUrl; audio.hidden = false; void audio.play().catch(() => undefined);
    }
  }
  async function atualizar() { dto = await api.computador(agente.id); if (!terminou) pintarEstado(); }
  async function fazer(fn: () => Promise<void>, silencioso = false) {
    if (terminou || (silencioso && ocupado)) return;
    while (ocupado && !terminou) await new Promise<void>(r=>window.setTimeout(r,30));
    if (terminou) return;
    ocupado = true; operando = !silencioso; if (!silencioso) erro(""); pintarEstado();
    try { await fn(); }
    catch { if (!silencioso) erro("Não foi possível concluir. Atualize a tela antes de tentar novamente. Uma ação já iniciada pode ter ocorrido."); }
    finally { ocupado = false; operando = false; pintarEstado(); }
  }
  async function acao(a: AcaoComputador) { resultado(await api.acaoComputador(agente.id, a)); }
  async function interagir(a: AcaoComputador) {
    if (!controla()) { erro("Use Assumir controle antes de interagir."); return; }
    fila = fila.then(async () => {
      while (ocupado && !terminou) await new Promise<void>(r => window.setTimeout(r,30));
      if (terminou || !controla()) return;
      // definido em 2026-09-18: teclado preserva ordem e foco da pessoa; cliques mantêm o quadro visto ao clicar.
      const entrada = (a.tipo === "digitar" || a.tipo === "tecla") && tela ? { ...a, quadro: tela.quadro } : a;
      await fazer(async () => { await acao(entrada); await atualizar(); });
    });
    await fila;
  }
  function enviarTeclas() { if (timerTeclas) window.clearTimeout(timerTeclas);const texto=teclas;teclas="";if(texto&&tela)void interagir({tipo:"digitar",texto,quadro:tela.quadro}); }
  const imagem = q<HTMLImageElement>("img");
  const ponto = (e: MouseEvent) => { const b = imagem.getBoundingClientRect(); return { x: Math.min(1279,Math.max(0,Math.floor((e.clientX-b.left)*1280/b.width))), y: Math.min(799,Math.max(0,Math.floor((e.clientY-b.top)*800/b.height))) }; };
  let inicio: { x: number; y: number } | undefined;
  imagem.addEventListener("mousedown", e => { e.preventDefault(); imagem.focus(); inicio = ponto(e); });
  imagem.addEventListener("mouseup", e => {
    if (!tela || !inicio) return;
    const fim = ponto(e); const ini = inicio; inicio = undefined;
    if (Math.abs(fim.x-ini.x)+Math.abs(fim.y-ini.y)>8) void interagir({ tipo:"arrastar",...ini,destinoX:fim.x,destinoY:fim.y,quadro:tela.quadro });
    else {
      if (timerClique) window.clearTimeout(timerClique);
      const acao: AcaoComputador = { tipo:"clicar",...fim,quadro:tela.quadro,botao:e.button===2?3:1,vezes:e.detail>=2?2:1 };
      timerClique=window.setTimeout(()=>{void interagir(acao);},e.detail>=2?0:230);
    }
  });
  imagem.addEventListener("contextmenu", e => e.preventDefault());
  imagem.addEventListener("wheel", e => {if(!controla() || document.activeElement !== imagem)return;e.preventDefault();if(tela)void interagir({tipo:"rolar",delta:Math.max(-2000,Math.min(2000,e.deltaY)),quadro:tela.quadro});},{passive:false});
  imagem.addEventListener("keydown", e => {
    if (!tela || !controla() || ["Control","Meta","Alt","Shift"].includes(e.key)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") return;
    e.preventDefault();
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {teclas+=e.key;if(timerTeclas)window.clearTimeout(timerTeclas);timerTeclas=window.setTimeout(enviarTeclas,150);}
    else {
      enviarTeclas();
      const tecla = `${e.ctrlKey?"Control+":""}${e.metaKey?"Control+":""}${e.altKey?"Alt+":""}${e.shiftKey?"Shift+":""}${e.key===" "?"Space":e.key}`;
      void interagir({tipo:"tecla",tecla,quadro:tela.quadro});
    }
  });
  imagem.addEventListener("paste",e=>{e.preventDefault();enviarTeclas();const texto=e.clipboardData?.getData("text/plain");if(texto&&tela)void interagir({tipo:"digitar",texto,quadro:tela.quadro});});
  dialog.addEventListener("click", e => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("button"); if (!el) return;
    const cmd = el.dataset.c;
    if (cmd === "fechar") dialog.close();
    else if (cmd === "parar") { configuracao="parar";pintarEstado();void api.configurarComputador(agente.id,"parar").then(atualizar).catch(()=>erro("Não foi possível desligar o computador.")).finally(()=>{configuracao=null;pintarEstado();}); }
    else if ((cmd === "aceitar-dialogo" || cmd === "recusar-dialogo") && tela) void interagir({tipo:"dialogo",aceitar:cmd === "aceitar-dialogo",texto:q<HTMLInputElement>(".computador-browser-dialog input").value,quadro:tela.quadro});
    else if (cmd === "atualizar") void fazer(async()=>{await atualizar();if(dto?.ativo)await acao({tipo:"observar"});});
    else if (cmd === "audio") void fazer(()=>acao({tipo:"audio",segundos:5}));
    else if (["enter","tab","esc"].includes(cmd??"") && tela) void interagir({tipo:"tecla",tecla:cmd==="enter"?"Enter":cmd==="tab"?"Tab":"Escape",quadro:tela.quadro});
    else if (cmd) void fazer(async()=>{configuracao=cmd;pintarEstado();try{await api.configurarComputador(agente.id,cmd);await atualizar();if(dto?.ativo)await acao({tipo:"observar"});}finally{configuracao=null;}});
    else if (el.dataset.aba) void interagir({tipo:"abas",aba:Number(el.dataset.aba)});
    else if (el.dataset.arquivo) void fazer(async()=>{if(el.dataset.diretorio==="true")q<HTMLInputElement>(".computador-pasta input").value=el.dataset.arquivo!;await acao({tipo:el.dataset.diretorio==="true"?"arquivos":"ler_arquivo",caminho:el.dataset.arquivo!});});
  });
  q<HTMLSelectElement>("select").addEventListener("change", e=>{const v=(e.target as HTMLSelectElement).value;void fazer(async()=>{await api.configurarComputador(agente.id,v);await atualizar();});});
  q<HTMLFormElement>(".computador-url").onsubmit = e=>{e.preventDefault();void interagir({tipo:"navegar",url:q<HTMLInputElement>(".computador-url input").value});};
  q<HTMLFormElement>(".computador-texto").onsubmit = e=>{e.preventDefault();const input=q<HTMLInputElement>(".computador-texto input");const texto=input.value;input.value="";if(tela)void interagir({tipo:"digitar",texto,quadro:tela.quadro});};
  q<HTMLFormElement>(".computador-pasta").onsubmit = e=>{e.preventDefault();void fazer(()=>acao({tipo:"arquivos",caminho:q<HTMLInputElement>(".computador-pasta input").value}));};
  q<HTMLFormElement>(".computador-terminal").onsubmit = e=>{e.preventDefault();void interagir({tipo:"terminal",comando:q<HTMLTextAreaElement>("textarea").value});};
  q<HTMLInputElement>('input[type="file"]').onchange = e=>{
    const input=e.target as HTMLInputElement;const f=input.files?.[0];input.value="";if(!f)return;
    if(f.size>524288){erro("Envie arquivos de até 512 KB. Para arquivos maiores, use o navegador ou o terminal do computador.");return;}
    void f.arrayBuffer().then(b=>interagir({tipo:"gravar_arquivo",caminho:f.name,base64:btoa(Array.from(new Uint8Array(b),c=>String.fromCharCode(c)).join(""))}));
  };
  const timer = window.setInterval(()=>{
    if(document.hidden || terminou || Date.now()<proximaLeitura) return;
    proximaLeitura=Date.now()+2000;
    void fazer(async()=>{await atualizar();if(dto?.ativo && (dto.computador.ocupadoAte ?? 0) <= Date.now()) await acao({tipo:"observar"});},true);
  },2000);
  dialog.addEventListener("close",()=>{terminou=true;window.clearInterval(timer);if(timerTeclas)window.clearTimeout(timerTeclas);if(timerClique)window.clearTimeout(timerClique);teclas="";if(audioUrl)URL.revokeObjectURL(audioUrl);dialog.remove();});
  void fazer(async()=>{await atualizar();if(dto?.ativo)await acao({tipo:"observar"});});
}
function blob(base64: string, type: string): Blob { return new Blob([Uint8Array.from(atob(base64), c=>c.charCodeAt(0))],{type}); }
function baixar(nome: string, base64: string) { const url=URL.createObjectURL(blob(base64,"application/octet-stream"));const a=document.createElement("a");a.href=url;a.download=nome;a.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000); }
