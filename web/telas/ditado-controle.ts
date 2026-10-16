import type { DisponibilidadeDitado } from "../../src/contracts/ditado.ts";
import { iniciarDitado, type MotorDitado } from "../lib/ditado.ts";
import type { EventoDitado } from "../lib/ditado-protocolo.ts";
import { esc } from "../lib/render.ts";
import { formatarTempo, textoDaFalha } from "./ditado.ts";
import { dialogo } from "./gestao-agentes.ts";
import { TEXTO_CONSENTIMENTO } from "./ligacao.ts";

/**
 * Controle do ditado no campo (definido em 2026-10-11, ADR-095): liga o 🎤, a pílula e o ↑ ao motor (web/lib/ditado.ts).
 * Muda só os nós que o `htmlComposer` já criou; o texto vai ao campo pelo `aoTexto` do main.
 */

export type DepsDitado = {
  tenantId(): string | null;
  disponibilidade(): Promise<DisponibilidadeDitado | null>;
  consentir(versao: number): Promise<unknown>;
  /** O texto chegou: põe no campo (`campo`) ou põe e envia (`enviar`). Só é chamado com texto. */
  aoTexto(texto: string, destino: "campo" | "enviar"): void;
  avisar(texto: string): void;
  noApp(): boolean;
};

export type ControleDitado = {
  /** Mostra ou esconde o 🎤 conforme a disponibilidade (chamado depois de cada render do campo). */
  atualizar(): void;
  /** 🎤: começa a gravar (pede o aviso da voz antes da primeira vez). */
  comecar(): void;
  /** ■ ou ↑ com a gravação aberta. */
  concluir(destino: "campo" | "enviar"): void;
  descartar(): void;
  /** Gravando ou transcrevendo: o ↑ e o Enter são do ditado. */
  ativo(): boolean;
};

export function criarControleDitado(d: DepsDitado): ControleDitado {
  let disp: DisponibilidadeDitado | null = null;
  let lendo: Promise<void> | null = null;
  let motor: MotorDitado | null = null;
  let fase: "parado" | "abrindo" | "gravando" | "transcrevendo" = "parado";
  let destino: "campo" | "enviar" = "campo";
  let desde = 0;
  let relogio: number | null = null;
  let placeholderAntes = "";

  const caixa = () => document.querySelector<HTMLElement>("#composer .composer .box");
  const ta = () => document.getElementById("composer-texto") as HTMLTextAreaElement | null;

  function lerDisponibilidade(): Promise<void> {
    // Servidor sem a rota (anterior à ADR-095) ou fora do ar: o 🎤 fica escondido até a próxima sessão, sem pedir de novo
    // a cada render.
    lendo ??= d.disponibilidade().then((r) => { disp = r; }, () => { disp = { disponivel: false, motivo: "voz_fora" }; }).finally(() => {
      lendo = null;
      // Sem sessão ainda (null): o próximo render pergunta de novo; com resposta, o 🎤 aparece ou some agora.
      if (disp !== null) atualizar();
    });
    return lendo;
  }

  function atualizar(): void {
    const mic = document.querySelector<HTMLButtonElement>('#composer [data-act="ditar"]');
    if (!mic) return;
    if (disp === null && !lendo) void lerDisponibilidade();
    mic.hidden = !disp?.disponivel;
    // O render do campo reescreve o placeholder; com a gravação aberta ele volta a dizer "Ouvindo…".
    if (fase !== "parado") mostrar(fase);
  }

  function mostrar(f: typeof fase): void {
    fase = f;
    const box = caixa();
    const pilula = document.getElementById("composer-ditado");
    const campo = ta();
    const gravando = f !== "parado";
    box?.classList.toggle("gravando", gravando);
    box?.classList.toggle("transcrevendo", f === "transcrevendo");
    if (pilula) pilula.hidden = !gravando;
    const enviar = box?.querySelector<HTMLButtonElement>('[data-act="enviar"]');
    if (enviar) {
      enviar.dataset.modo = gravando ? "ditado" : "";
      enviar.setAttribute("aria-label", gravando ? "Parar e enviar" : "Enviar");
    }
    if (campo) {
      if (gravando && !campo.readOnly) placeholderAntes = campo.placeholder;
      campo.readOnly = gravando;
      campo.placeholder = f === "transcrevendo" ? "Transcrevendo…" : f === "gravando" ? "Ouvindo…" : f === "abrindo" ? "Abrindo o microfone…" : placeholderAntes || campo.placeholder;
    }
    if (!gravando && relogio !== null) {
      window.clearInterval(relogio);
      relogio = null;
    }
  }

  function aoEvento(ev: EventoDitado): void {
    if (ev.t === "gravando") {
      // O tempo conta da hora em que o microfone e o servidor ficaram prontos, não do clique.
      desde = Date.now();
      mostrar("gravando");
    }
    else if (ev.t === "nivel") pulsar(ev.valor);
    else if (ev.t === "transcrevendo") mostrar("transcrevendo");
    else if (ev.t === "texto") {
      motor = null;
      mostrar("parado");
      const texto = ev.texto.trim();
      if (!texto) return d.avisar(textoDaFalha("vazio", d.noApp()));
      // O teto (5 min) nunca envia sozinho: o texto vai ao campo, para a pessoa conferir.
      d.aoTexto(texto, ev.teto ? "campo" : destino);
      if (ev.teto) d.avisar(textoDaFalha("teto", d.noApp()));
    } else {
      motor = null;
      mostrar("parado");
      if (ev.codigo === "sem_consentimento" && disp?.disponivel) disp = { ...disp, consentimentoNecessario: true };
      d.avisar(textoDaFalha(ev.codigo, d.noApp()));
    }
  }

  function pulsar(valor: number): void {
    const nivel = document.getElementById("ditado-nivel");
    if (!nivel) return;
    // As barras andam da direita para a esquerda: a última é o quadro de agora.
    const barras = [...nivel.children] as HTMLElement[];
    for (let i = 0; i < barras.length - 1; i++) barras[i]?.style.setProperty("--nivel-ditado", barras[i + 1]?.style.getPropertyValue("--nivel-ditado") || "0");
    barras.at(-1)?.style.setProperty("--nivel-ditado", valor.toFixed(2));
  }

  /** Abre o motor no gesto (o Safari do iPhone exige); o canal espera o consentimento gravar, quando ele foi pedido agora. */
  function gravar(antesDeConectar?: Promise<unknown>): void {
    const tenantId = d.tenantId();
    if (!tenantId || motor) return;
    destino = "campo";
    desde = Date.now();
    const tempo = document.getElementById("ditado-tempo");
    if (tempo) tempo.textContent = "0:00";
    for (const b of document.querySelectorAll<HTMLElement>("#ditado-nivel i")) b.style.setProperty("--nivel-ditado", "0");
    mostrar("abrindo");
    relogio = window.setInterval(() => {
      const t = document.getElementById("ditado-tempo");
      if (t && fase === "gravando") t.textContent = formatarTempo(Date.now() - desde);
    }, 250);
    motor = iniciarDitado({ tenantId, aoEvento, antesDeConectar });
  }

  function pedirConsentimento(versao: number): void {
    const dlg = dialogo(`<div class="ligacao-consentimento"><h2>Antes de ditar</h2><p>${esc(TEXTO_CONSENTIMENTO)}</p><div class="acoes"><button class="bt" type="button" data-nao>Agora não</button><button class="bt pri" type="button" data-sim>Concordo e ditar</button></div></div>`);
    dlg.querySelector("[data-nao]")?.addEventListener("click", () => dlg.close());
    dlg.querySelector("[data-sim]")?.addEventListener("click", () => {
      dlg.close();
      // Dentro do clique: o microfone abre já; o canal só conecta depois de o servidor gravar o aceite.
      const aceite = d.consentir(versao).then(() => {
        if (disp?.disponivel) disp = { ...disp, consentimentoNecessario: false };
      });
      gravar(aceite);
    });
    dlg.querySelector<HTMLButtonElement>("[data-sim]")?.focus();
  }

  return {
    atualizar,
    comecar() {
      if (motor || !disp?.disponivel) return;
      if (disp.consentimentoNecessario) return pedirConsentimento(disp.versaoConsentimento);
      gravar();
    },
    concluir(qual) {
      if (!motor || fase === "transcrevendo") return;
      destino = qual;
      motor.concluir(qual);
    },
    descartar() {
      if (!motor) return;
      motor.descartar();
      motor = null;
      mostrar("parado");
    },
    ativo: () => motor !== null,
  };
}
