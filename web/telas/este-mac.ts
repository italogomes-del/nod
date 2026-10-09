import type { UsoDoMac } from "../../src/contracts/raio-x.ts";
import type { DiscoDoMac, MotivoEsperaMac, NivelPressao, TrabalhoDto } from "../../src/contracts/trabalho.ts";
import type { Estado } from "../estado/reducer.ts";
import { esc, iconeAgente } from "../lib/render.ts";
import { aberto, foraDoMac, memoriaLegivel, pilulaMac, pontoTrabalho, seguradoPeloMac, situacaoDe, tempoDe, textoDaEspera } from "../lib/trabalhos.ts";
import { agente } from "./trabalhos.ts";

/**
 * Seu espaço › Este Mac (definido em 2026-10-08, ADR-085; protótipo "Nod — Ritmo do Mac", prancha 3): quanto do Mac os
 * bots estão usando agora, quem está trabalhando (com a memória de cada um) e quem espera a vez, e o quanto eles podem
 * usar antes de trabalho novo em segundo plano esperar. Não há limite de bots: o limite é o Mac (ADR-083).
 */

export const USOS: readonly { id: UsoDoMac; nome: string; explicacao: string }[] = [
  { id: "pouco", nome: "Pouco", explicacao: "Trabalho novo em segundo plano espera assim que o processador começa a apertar ou a memória entra em alerta. Bom para quando você está numa chamada ou precisa do Mac para outra coisa pesada." },
  { id: "equilibrado", nome: "Equilibrado", explicacao: "Trabalho novo em segundo plano espera quando o Mac fica apertado: memória em alerta ou processador cheio. Volta sozinho quando o Mac aliviar." },
  { id: "livre", nome: "O quanto precisar", explicacao: "Nada espera, nem com a memória crítica. Só o disco quase sem espaço segura trabalho novo, em qualquer opção." },
];

const NOME_MEMORIA: Record<NivelPressao, string> = { verde: "folgada", amarela: "em alerta", vermelha: "crítica" };
const NOME_PROCESSADOR: Record<NivelPressao, string> = { verde: "folgado", amarela: "apertando", vermelha: "cheio" };
/** A barra da memória acompanha o nível do macOS (ele não diz a porcentagem); a do processador é a carga por núcleo. */
const FRACAO_MEMORIA: Record<NivelPressao, number> = { verde: 0.35, amarela: 0.7, vermelha: 0.95 };

/**
 * Uma linha de medida: nome, barra e o status curto à vista; o detalhe, quando há, atrás de um clique (revisto em
 * 2026-10-09, #219: memória e disco entram com o porquê da espera — memória `marlon-design-limpo-info-escondida`).
 */
function medidor(nome: string, fracao: number | null, situacao: string, nivel: NivelPressao | null, detalhe = ""): string {
  const largura = fracao === null ? 0 : Math.round(Math.min(1, Math.max(0, fracao)) * 100);
  const miolo = `<b>${esc(nome)}</b><span class="mac-barra nivel-${nivel ?? "sem"}" aria-hidden="true"><i style="width: ${largura}%"></i></span><span>${esc(situacao)}</span>`;
  if (!detalhe) return `<div class="mac-medidor">${miolo}</div>`;
  return `<details class="mac-det"><summary class="mac-medidor">${miolo}</summary><p class="mac-det-txt">${esc(detalhe)}</p></details>`;
}

/** "17 GB", "8,4 GB", "900 MB": o disco em números redondos (a casa decimal só abaixo de 10 GB). */
export function discoLegivel(mb: number): string {
  if (mb < 1024) return `${Math.round(mb)} MB`;
  const gb = mb / 1024;
  return `${gb.toLocaleString("pt-BR", { maximumFractionDigits: gb < 10 ? 1 : 0 })} GB`;
}

function detalheDaMemoria(memoria: NivelPressao, uso: UsoDoMac, totalBots: number | null): string {
  const dosBots = totalBots !== null && totalBots > 0 ? ` Os bots usam ${memoriaLegivel(totalBots)} agora.` : "";
  if (memoria === "vermelha") return `O macOS está quase sem memória e pode fechar apps.${uso === "livre" ? " Com \"O quanto precisar\", nada espera por isso." : " Rotinas e pedidos entre bots que ainda não começaram esperam até ele liberar memória, mesmo os que já esperam há mais de 1 hora; o que você pede começa."}${dosBots}`;
  if (memoria === "amarela") return `O macOS avisou pouca memória.${uso === "livre" ? " Com \"O quanto precisar\", nada espera por isso." : " Rotinas e pedidos entre bots que ainda não começaram esperam; o que você pede começa."}${dosBots}`;
  return `O macOS diz que a memória está folgada.${dosBots}`;
}

/** Os limites vêm do servidor (`DiscoDoMac`): a web só mostra, quem decide é o domínio. */
function detalheDoDisco(d: DiscoDoMac): string {
  const base = `${discoLegivel(d.livreMb)} livres de ${discoLegivel(d.totalMb)}. Com menos de ${discoLegivel(d.alertaMb)} livres, rotinas e pedidos entre bots esperam; com menos de ${discoLegivel(d.criticoMb)}, nenhuma task nova começa, em qualquer opção. As que já rodam continuam.`;
  return d.nivel === "verde" ? base : `${base} As pastas dos bots ficam em ~/nod.`;
}

function linhaBot(estado: Estado, t: TrabalhoDto, fim: string, segurando: boolean): string {
  const bot = agente(estado, t.agenteId);
  return `<button type="button" class="mac-bot" data-act="abrir-trabalho" data-id="${esc(t.id)}">${pontoTrabalho(t, bot?.cor)}${bot ? iconeAgente(bot, "sm") : ""}<span class="mac-bot-txt"><b>${esc(bot?.nome ?? "bot")}</b><span>${esc(t.titulo)} · ${esc(situacaoDe(t, [], segurando, estado.agora))}</span></span><span class="mac-bot-fim">${esc(fim)}</span></button>`;
}

function grupo(titulo: string, legenda: string, linhas: string[]): string {
  if (linhas.length === 0) return "";
  return `<div class="mac-grupo"><span>${esc(titulo)} · ${linhas.length}</span><span>${esc(legenda)}</span></div>${linhas.join("")}`;
}

export function renderEsteMac(estado: Estado): string {
  const dto = estado.trabalhos;
  const lista = (dto?.trabalhos ?? []).filter(aberto);
  const segurando = dto?.segurando === true;
  const motivo: MotivoEsperaMac | null = dto?.motivoEspera ?? null;
  const tudoNovo = dto?.seguraTudoNovo === true;
  const disco = dto?.disco ?? null;
  const porMemoria = (a: TrabalhoDto, b: TrabalhoDto) => (b.memoriaMb ?? 0) - (a.memoriaMb ?? 0);
  const trabalhando = lista.filter((t) => t.estado === "rodando" && t.turnoVivoId !== null).sort(porMemoria);
  const esperandoVez = lista.filter((t) => seguradoPeloMac(t, segurando));
  // ADR-086: quem espera um colega ou a hora marcada não ocupa o Mac — aparece à parte, para a pessoa ver que a espera
  // não custa nada aqui (protótipo "Nod — Ritmo do Mac", quadros 1–2).
  const fora = lista.filter((t) => foraDoMac(t));
  const memoria = dto?.pressao ?? null;
  const processador = dto?.processador ?? null;
  const carga = dto?.cargaProcessador ?? null;
  const total = dto?.memoriaTotalMb ?? null;
  const usam = trabalhando.length === 0 ? "nenhum processo dos bots agora"
    : total !== null && total > 0 ? `${trabalhando.length === 1 ? "usa" : "usam"} ${memoriaLegivel(total)} do seu Mac` : "sem leitura de memória";
  // #219: "esperando o Mac liberar memória" / "esperando espaço no disco" / "esperando o Mac aliviar".
  const esperandoO = textoDaEspera(motivo);
  const oQue = esperandoO.replace(/^esperando /, "");
  const espera = !segurando ? { titulo: "Nada esperando", legenda: "trabalho novo começa na hora" }
    : esperandoVez.length === 0 ? { titulo: "Nada esperando ainda", legenda: `trabalho novo${tudoNovo ? "" : " em segundo plano"} espera ${oQue}` }
      : { titulo: `${esperandoVez.length} ${esperandoO}`, legenda: tudoNovo ? "começam sozinhos, na ordem da fila, quando houver folga" : "começam sozinhos, um de cada vez, quando ele aliviar" };
  const resumo = `<div class="mac-agora">
      <div><b>${trabalhando.length} trabalhando</b><span>${esc(usam)}</span></div>
      <div><b>${esc(espera.titulo)}</b><span>${esc(espera.legenda)}</span></div>
    </div>`;
  const medidores = memoria === null && processador === null
    ? '<p class="mac-sem-leitura">O Mac ainda não mandou leitura. Ela chega com o app aberto e conectado.</p>'
    : medidor("Memória", memoria ? FRACAO_MEMORIA[memoria] : null, memoria ? NOME_MEMORIA[memoria] : "sem leitura", memoria, memoria ? detalheDaMemoria(memoria, estado.usoDoMac, total) : "")
      + medidor("Processador", carga, processador ? NOME_PROCESSADOR[processador] : "sem leitura (atualize o app)", processador)
      // #219: o disco ocupado na barra, o livre no status; a cor pelo nível que o servidor mandou.
      + (disco
        ? medidor("Disco", 1 - disco.livreMb / disco.totalMb, `${discoLegivel(disco.livreMb)} livres`, disco.nivel, detalheDoDisco(disco))
        : medidor("Disco", null, "sem leitura (atualize o app)", null));
  const grupos = grupo("Trabalhando", "os que mais usam memória primeiro", trabalhando.map((t) => linhaBot(estado, t, t.memoriaMb ? memoriaLegivel(t.memoriaMb) : tempoDe(t, estado.agora), segurando)))
    + grupo(esperandoO.charAt(0).toUpperCase() + esperandoO.slice(1), "começam sozinhos, na ordem da fila", esperandoVez.map((t) => linhaBot(estado, t, "", segurando)))
    + grupo("Fora do Mac", "esperando sem ocupar o Mac; voltam sozinhas", fora.map((t) => linhaBot(estado, t, "", segurando)));
  const uso = estado.usoDoMac;
  const botoes = USOS.map((u) => `<button type="button" class="seg${u.id === uso ? " ativo" : ""}" data-act="uso-do-mac" data-uso="${u.id}" aria-pressed="${u.id === uso}">${esc(u.nome)}</button>`).join("");
  const explicacao = USOS.find((u) => u.id === uso)?.explicacao ?? "";
  return `<section class="espaco-secao este-mac">
      <h2>Este Mac</h2>
      <p class="intro">Quanto do seu Mac os bots podem usar. Não há limite de bots trabalhando: quando o Mac fica apertado, trabalho novo em segundo plano (rotinas e pedidos entre bots) espera um pouco. Com o disco quase sem espaço, nenhuma task nova começa. Conversa com você e ligação nunca esperam.</p>
      ${pilulaMac(segurando, esperandoVez.length, false, motivo)}
      <div class="espaco-cartao mac-cartao">${resumo}${medidores}${grupos}</div>
      <h3 class="espaco-subtitulo">Quanto os bots podem usar</h3>
      <div class="segmentado uso-do-mac" role="group" aria-label="Quanto os bots podem usar do Mac">${botoes}</div>
      <p class="intro" aria-live="polite">${esc(explicacao)}</p>
    </section>`;
}
