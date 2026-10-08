import type { UsoDoMac } from "../../src/contracts/raio-x.ts";
import type { NivelPressao, TrabalhoDto } from "../../src/contracts/trabalho.ts";
import type { Estado } from "../estado/reducer.ts";
import { esc, iconeAgente } from "../lib/render.ts";
import { aberto, memoriaLegivel, pilulaMac, pontoTrabalho, seguradoPeloMac, situacaoDe, tempoDe } from "../lib/trabalhos.ts";
import { agente } from "./trabalhos.ts";

/**
 * Seu espaço › Este Mac (definido em 2026-10-08, ADR-085; protótipo "Nod — Ritmo do Mac", prancha 3): quanto do Mac os
 * bots estão usando agora, quem está trabalhando (com a memória de cada um) e quem espera a vez, e o quanto eles podem
 * usar antes de trabalho novo em segundo plano esperar. Não há limite de bots: o limite é o Mac (ADR-083).
 */

export const USOS: readonly { id: UsoDoMac; nome: string; explicacao: string }[] = [
  { id: "pouco", nome: "Pouco", explicacao: "Trabalho novo em segundo plano espera assim que o processador começa a apertar ou a memória entra em alerta. Bom para quando você está numa chamada ou precisa do Mac para outra coisa pesada." },
  { id: "equilibrado", nome: "Equilibrado", explicacao: "Trabalho novo em segundo plano espera quando o Mac fica apertado: memória em alerta ou processador cheio. Volta sozinho quando o Mac aliviar." },
  { id: "livre", nome: "O quanto precisar", explicacao: "Nada espera. O Nod só avisa quando a memória fica crítica." },
];

const NOME_MEMORIA: Record<NivelPressao, string> = { verde: "folgada", amarela: "em alerta", vermelha: "crítica" };
const NOME_PROCESSADOR: Record<NivelPressao, string> = { verde: "folgado", amarela: "apertando", vermelha: "cheio" };
/** A barra da memória acompanha o nível do macOS (ele não diz a porcentagem); a do processador é a carga por núcleo. */
const FRACAO_MEMORIA: Record<NivelPressao, number> = { verde: 0.35, amarela: 0.7, vermelha: 0.95 };

function medidor(nome: string, fracao: number | null, situacao: string, nivel: NivelPressao | null): string {
  const largura = fracao === null ? 0 : Math.round(Math.min(1, Math.max(0, fracao)) * 100);
  return `<div class="mac-medidor"><b>${esc(nome)}</b><span class="mac-barra nivel-${nivel ?? "sem"}" aria-hidden="true"><i style="width: ${largura}%"></i></span><span>${esc(situacao)}</span></div>`;
}

function linhaBot(estado: Estado, t: TrabalhoDto, fim: string, segurando: boolean): string {
  const bot = agente(estado, t.agenteId);
  return `<button type="button" class="mac-bot" data-act="abrir-trabalho" data-id="${esc(t.id)}">${pontoTrabalho(t, bot?.cor)}${bot ? iconeAgente(bot, "sm") : ""}<span class="mac-bot-txt"><b>${esc(bot?.nome ?? "bot")}</b><span>${esc(t.titulo)} · ${esc(situacaoDe(t, [], segurando))}</span></span><span class="mac-bot-fim">${esc(fim)}</span></button>`;
}

function grupo(titulo: string, legenda: string, linhas: string[]): string {
  if (linhas.length === 0) return "";
  return `<div class="mac-grupo"><span>${esc(titulo)} · ${linhas.length}</span><span>${esc(legenda)}</span></div>${linhas.join("")}`;
}

export function renderEsteMac(estado: Estado): string {
  const dto = estado.trabalhos;
  const lista = (dto?.trabalhos ?? []).filter(aberto);
  const segurando = dto?.segurando === true;
  const porMemoria = (a: TrabalhoDto, b: TrabalhoDto) => (b.memoriaMb ?? 0) - (a.memoriaMb ?? 0);
  const trabalhando = lista.filter((t) => t.estado === "rodando" && t.turnoVivoId !== null).sort(porMemoria);
  const esperandoVez = lista.filter((t) => seguradoPeloMac(t, segurando));
  const memoria = dto?.pressao ?? null;
  const processador = dto?.processador ?? null;
  const carga = dto?.cargaProcessador ?? null;
  const total = dto?.memoriaTotalMb ?? null;
  const usam = trabalhando.length === 0 ? "nenhum processo dos bots agora"
    : total !== null && total > 0 ? `${trabalhando.length === 1 ? "usa" : "usam"} ${memoriaLegivel(total)} do seu Mac` : "sem leitura de memória";
  const espera = !segurando ? { titulo: "Nada esperando", legenda: "trabalho novo começa na hora" }
    : esperandoVez.length === 0 ? { titulo: "Nada esperando ainda", legenda: "trabalho novo em segundo plano espera o Mac aliviar" }
      : { titulo: `${esperandoVez.length} esperando o Mac aliviar`, legenda: "começam sozinhos, um de cada vez, quando ele aliviar" };
  const resumo = `<div class="mac-agora">
      <div><b>${trabalhando.length} trabalhando</b><span>${esc(usam)}</span></div>
      <div><b>${esc(espera.titulo)}</b><span>${esc(espera.legenda)}</span></div>
    </div>`;
  const medidores = memoria === null && processador === null
    ? '<p class="mac-sem-leitura">O Mac ainda não mandou leitura. Ela chega com o app aberto e conectado.</p>'
    : medidor("Memória", memoria ? FRACAO_MEMORIA[memoria] : null, memoria ? NOME_MEMORIA[memoria] : "sem leitura", memoria)
      + medidor("Processador", carga, processador ? NOME_PROCESSADOR[processador] : "sem leitura (atualize o app)", processador);
  const grupos = grupo("Trabalhando", "os que mais usam memória primeiro", trabalhando.map((t) => linhaBot(estado, t, t.memoriaMb ? memoriaLegivel(t.memoriaMb) : tempoDe(t, estado.agora), segurando)))
    + grupo("Esperando o Mac aliviar", "começam sozinhos, na ordem da fila", esperandoVez.map((t) => linhaBot(estado, t, "", segurando)));
  const uso = estado.usoDoMac;
  const botoes = USOS.map((u) => `<button type="button" class="seg${u.id === uso ? " ativo" : ""}" data-act="uso-do-mac" data-uso="${u.id}" aria-pressed="${u.id === uso}">${esc(u.nome)}</button>`).join("");
  const explicacao = USOS.find((u) => u.id === uso)?.explicacao ?? "";
  return `<section class="espaco-secao este-mac">
      <h2>Este Mac</h2>
      <p class="intro">Quanto do seu Mac os bots podem usar. Não há limite de bots trabalhando: quando o Mac fica apertado, trabalho novo em segundo plano (rotinas e pedidos entre bots) espera um pouco. Conversa com você e ligação nunca esperam.</p>
      ${pilulaMac(segurando, esperandoVez.length, false)}
      <div class="espaco-cartao mac-cartao">${resumo}${medidores}${grupos}</div>
      <h3 class="espaco-subtitulo">Quanto os bots podem usar</h3>
      <div class="segmentado uso-do-mac" role="group" aria-label="Quanto os bots podem usar do Mac">${botoes}</div>
      <p class="intro" aria-live="polite">${esc(explicacao)}</p>
    </section>`;
}
