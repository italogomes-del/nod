import type { PonteInterna } from "../../contracts/ponte.ts";
import { log } from "../../obs/log.ts";

/** O que o pool precisa de um laço: parar. `turnoAtual` é o do laço da L4, repassado para diagnóstico. */
type LacoDoPool = { parar(): Promise<void>; turnoAtual?(): string | null };

export type PoolDeLacos = {
  parar(): Promise<void>;
  /** Laços vivos (ocupados + o ocioso). */
  tamanho(): number;
  /** Turnos rodando agora, um por laço ocupado. */
  turnosAtuais(): string[];
};

/**
 * Pool ELÁSTICO de laços por pessoa (definido em 2026-09-24, sem teto por decisão do Marlon). Antes um
 * laço só rodava um turno por vez, e a Nina em 30 min de triagem deixava Taga, Gil e as rotinas
 * esperando — sem motivo, porque o reivindicar já só serializa a MESMA conversa e o MESMO agente.
 *
 * Regra: sempre exatamente UM laço ocioso puxando. Quando um laço pega turno e nenhum outro ficou
 * ocioso, sobe mais um; quando um laço volta a puxar e já existe outro ocioso, ele se aposenta. O teto
 * natural é o banco: um turno por agente, então o paralelismo máximo é o número de agentes com trabalho.
 * JS é de uma thread e as contagens são lidas e escritas sem await no meio: dois ociosos nunca se
 * aposentam juntos. O laço em si não muda — o pool só envolve o `puxar` da ponte que cada um recebe.
 */
export function iniciarPoolDeLacos(criar: (ponte: PonteInterna) => LacoDoPool, ponte: PonteInterna): PoolDeLacos {
  type Vaga = { laco: LacoDoPool | null; ocupado: boolean; aposentado: boolean };
  const vagas = new Set<Vaga>();
  let parando = false;
  const ociosos = () => [...vagas].filter((v) => !v.ocupado && !v.aposentado).length;

  function subir(): void {
    const vaga: Vaga = { laco: null, ocupado: false, aposentado: false };
    vagas.add(vaga);
    const envolvida: PonteInterna = {
      ...ponte,
      puxar: async (pessoaId, maquina) => {
        vaga.ocupado = false;
        if (parando || vaga.aposentado) return null;
        if (ociosos() > 1) {
          vaga.aposentado = true;
          vagas.delete(vaga);
          // Sem await: parar() espera a corrida do próprio laço, que está AQUI dentro. Devolver null faz o
          // laço ver `parado` logo depois e sair; não há adapter vivo entre turnos.
          void vaga.laco?.parar();
          return null;
        }
        const plano = await ponte.puxar(pessoaId, maquina);
        if (plano) {
          vaga.ocupado = true;
          if (!parando && ociosos() === 0) subir();
        }
        return plano;
      },
    };
    vaga.laco = criar(envolvida);
  }

  subir();
  return {
    async parar() {
      parando = true;
      const todas = [...vagas];
      vagas.clear();
      for (const v of todas) {
        try {
          await v.laco?.parar();
        } catch (e) {
          log("erro", "laco_do_pool_nao_parou", { erro: e instanceof Error ? e.name : "desconhecido" });
        }
      }
    },
    tamanho: () => vagas.size,
    turnosAtuais: () => [...vagas].map((v) => v.laco?.turnoAtual?.() ?? null).filter((t): t is string => t !== null),
  };
}
