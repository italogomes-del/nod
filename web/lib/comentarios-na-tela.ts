import type { ComentarioDto, QuadroDto } from "../../src/contracts/quadro.ts";
import { comentariosDaTarefa, type CargaDosComentarios } from "../telas/comentarios-tarefa.ts";
import type { AgenteDoQuadro } from "../telas/quadro-real.ts";

/**
 * O estado dos comentários da tarefa aberta (NOD-417), fora do quadro-na-tela.ts para ele não crescer: lê ao abrir a
 * tarefa e a cada `quadro.mudou` dela, e manda o comentário novo. Uma leitura velha (outra tarefa, outro bot) é descartada.
 */
export interface ApiDosComentarios {
  comentariosDaTarefa?(agenteId: string, tarefaId: string): Promise<{ comentarios: ComentarioDto[] }>;
  comentarTarefa?(agenteId: string, tarefaId: string, texto: string): Promise<{ quadro: QuadroDto | null }>;
}

export function criarComentariosNaTela(o: { api: () => ApiDosComentarios | null; redesenhar: () => void }) {
  let estado: { agenteId: string; tarefaId: string; lista: ComentarioDto[]; carga: CargaDosComentarios } | null = null;
  let leitura = 0;

  async function reler(): Promise<void> {
    const a = o.api();
    const e = estado;
    if (!a?.comentariosDaTarefa || !e) return;
    const n = ++leitura;
    try {
      const r = await a.comentariosDaTarefa(e.agenteId, e.tarefaId);
      if (n !== leitura || estado !== e) return;
      estado = { ...e, lista: r.comentarios, carga: "ok" };
    } catch {
      if (n !== leitura || estado !== e) return;
      estado = { ...e, carga: "erro" };
    }
    o.redesenhar();
  }

  return {
    /** Com a API sem comentários (os testes antigos), a tarefa aberta fica como era. */
    ligados: () => !!o.api()?.comentariosDaTarefa,
    abrir(agenteId: string, tarefaId: string): void {
      if (estado?.agenteId === agenteId && estado.tarefaId === tarefaId) { void reler(); return; }
      estado = { agenteId, tarefaId, lista: [], carga: "carregando" };
      void reler();
    },
    fechar(): void { estado = null; leitura++; },
    reler,
    html(tarefaId: string, agente: AgenteDoQuadro, hora: (em: number) => string): string | undefined {
      if (!o.api()?.comentariosDaTarefa) return undefined;
      const e = estado?.tarefaId === tarefaId ? estado : null;
      return comentariosDaTarefa({ tarefaId, lista: e?.lista ?? [], carga: e?.carga ?? "carregando", agente, hora });
    },
    /** Manda o comentário; devolve o quadro novo (o card do responsável acende) ou null se falhou (o texto fica no campo). */
    async enviar(form: HTMLFormElement): Promise<{ quadro: QuadroDto | null } | null> {
      const a = o.api();
      const e = estado;
      const campo = form.querySelector<HTMLTextAreaElement>("textarea");
      const texto = campo?.value.trim() ?? "";
      if (!a?.comentarTarefa || !e || !campo || !texto || form.dataset["id"] !== e.tarefaId) return null;
      const botao = form.querySelector<HTMLButtonElement>('button[type="submit"]');
      if (botao) botao.disabled = true;
      try {
        const r = await a.comentarTarefa(e.agenteId, e.tarefaId, texto);
        if (estado?.tarefaId === e.tarefaId) campo.value = "";
        await reler();
        return r;
      } catch {
        return null;
      } finally {
        if (botao) botao.disabled = false;
      }
    },
  };
}
