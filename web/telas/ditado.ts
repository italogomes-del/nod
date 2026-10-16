import type { FalhaDitado } from "../lib/ditado-protocolo.ts";
import { ICONE_LIGACAO } from "./ligacao.ts";

/**
 * O microfone do campo de mensagem (definido em 2026-10-11, ADR-095; referência do Grok em docs/referencias/ditado-grok/).
 *
 * - 🎤 começa a gravar: o placeholder vira "Ouvindo…", aparece a pílula `■ 0:08 ••••` e o ➤ vira ↑.
 * - ■ para e põe o texto no campo, para conferir e enviar (o jeito do computador).
 * - ↑ (ou Enter) para e envia direto, sem prévia (o jeito do celular). Esc descarta.
 *
 * O composer nunca é regravado dentro da conversa (AGENTS.md): o botão e a pílula nascem escondidos no
 * `htmlComposer` e o controle (ditado-controle.ts) só troca classes, textos e `hidden` nos nós que já existem. Este
 * arquivo não abre microfone: é o HTML e os textos, sem o motor.
 */

const QUADRADO = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="1" y="1" width="12" height="12" rx="2.5" fill="currentColor"/></svg>';
/** definido em 2026-10-11 (as fotos do Grok): 12 barras no nível; no computador o CSS as mostra como pontos. */
const BARRAS = 12;

/** O botão do microfone (escondido até a disponibilidade chegar) e a pílula da gravação. */
export function htmlBotaoDitado(): string {
  return `<button type="button" class="mic" data-act="ditar" aria-label="Ditar mensagem" title="Ditar" hidden>${ICONE_LIGACAO.microfone(20)}</button>`;
}

export function htmlPilulaDitado(): string {
  const barras = Array.from({ length: BARRAS }, () => "<i></i>").join("");
  return `<div class="ditado" id="composer-ditado" hidden><button type="button" class="ditado-parar" data-act="ditado-parar" aria-label="Parar e revisar o texto" title="Parar e revisar">${QUADRADO}</button><span class="ditado-ouvindo" role="timer" aria-live="off"><span class="ditado-tempo" id="ditado-tempo">0:00</span><span class="ditado-nivel" id="ditado-nivel" aria-hidden="true">${barras}</span></span></div>`;
}

/** 0:08, 1:05, 4:59. */
export function formatarTempo(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** O ditado entra no campo depois do que já estava escrito, separado por um espaço. */
export function juntarAoCampo(campo: string, ditado: string): string {
  const novo = ditado.trim();
  if (!novo) return campo;
  const antes = campo.replace(/\s+$/, "");
  return antes ? `${antes} ${novo}` : novo;
}

/** O aviso de cada falha. `noApp` muda onde liberar o microfone (Ajustes do Sistema × navegador). */
export function textoDaFalha(f: FalhaDitado | "vazio" | "teto" | "tela-bloqueou", noApp: boolean): string {
  switch (f) {
    case "microfone-negado":
      return noApp ? "Libere o microfone em Ajustes do Sistema › Privacidade › Microfone para ditar." : "Libere o microfone para este site nos ajustes do navegador para ditar.";
    case "microfone-restrito":
      return "O microfone deste Mac está bloqueado por quem administra o computador.";
    case "microfone-indisponivel":
      return "Nenhum microfone encontrado. Conecte um e tente de novo.";
    case "sem_consentimento":
      return "Confirme o aviso sobre a voz antes de ditar.";
    case "sem_permissao":
      return "O ditado não está liberado para a sua conta.";
    case "vazio":
      return "Não ouvi nada. Tente de novo, falando perto do microfone.";
    case "teto":
      return "O ditado chegou a 5 minutos e parou. O texto está no campo.";
    case "tela-bloqueou":
      return "A gravação parou quando a tela saiu da frente. Toque no microfone de novo.";
    case "ja_ditando":
    case "voz_fora":
    case "falhou":
    case "caiu":
      return "Não consegui transcrever agora. Digite ou tente de novo.";
  }
}
