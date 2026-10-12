/**
 * Quando o motor de uma máquina Linux se atualiza sozinho (ADR-100). Puro: o relógio, os turnos e a comparação dos
 * arquivos chegam de fora.
 *
 * O motor é "o mesmo" do servidor quando os três arquivos têm o mesmo sha256 do manifesto. A versão do package.json não
 * basta: em 11/10 seis merges saíram com a mesma `0.4.0-rc.8`.
 *
 *   diferente ──► pendente ──(nenhum turno rodando)──────────────► drenar + pedir ──► (o root troca e reinicia)
 *                     └──(JANELA_OCIOSA_MS sem um momento ocioso)──► drenar ──(os turnos acabam)──┘
 *
 * Nunca interrompe um turno: drenar só para de puxar trabalho novo; o que roda termina e entrega. O pedido que não vira
 * reinício em ESPERA_DO_PEDIDO_MS (atualizador ausente, servidor fora) volta a puxar e tenta de novo depois de
 * ESPERA_DEPOIS_DE_FALHAR_MS.
 */

/** Os arquivos do motor (dist/motor): o servidor os serve e o manifesto traz o sha256 de cada um (ADR-090, ADR-100). */
export const ARQUIVOS_DO_MOTOR = ["nod-motor.mjs", "proxy.mjs", "hook-nativas.mjs"] as const;
export type ArquivoDoMotor = (typeof ARQUIVOS_DO_MOTOR)[number];

/** Sem um momento ocioso nesse tempo, o motor para de puxar trabalho novo para conseguir se atualizar. */
export const JANELA_OCIOSA_MS = 30 * 60_000;
/** O pedido feito e o motor ainda de pé depois disso: o atualizador falhou. */
export const ESPERA_DO_PEDIDO_MS = 10 * 60_000;
/** Depois de uma falha, a próxima tentativa. */
export const ESPERA_DEPOIS_DE_FALHAR_MS = 60 * 60_000;

export type EstadoDaAtualizacao = {
  /** Desde quando o motor sabe que está diferente do servidor (null = igual). */
  pendenteDesde: number | null;
  drenando: boolean;
  /** Quando o pedido ao atualizador foi feito (null = ainda não). */
  pedidoEm: number | null;
  falhouEm: number | null;
};

export const ATUALIZACAO_PARADA: EstadoDaAtualizacao = { pendenteDesde: null, drenando: false, pedidoEm: null, falhouEm: null };

export type PassoDaAtualizacao = { estado: EstadoDaAtualizacao; pedir: boolean; motivo: "igual" | "esperando_ocioso" | "drenando" | "pedido" | "esperando_reinicio" | "pedido_falhou" | "esperando_nova_tentativa" };

/** Os arquivos diferem do manifesto: algum sha256 local não bate (arquivo que falta conta como diferente). */
export function motorDiferente(locais: Readonly<Record<string, string | null>>, manifesto: Readonly<Record<string, string>>): boolean {
  const nomes = Object.keys(manifesto);
  return nomes.length === 0 ? false : nomes.some((n) => locais[n] !== manifesto[n]);
}

export function proximoPasso(e: EstadoDaAtualizacao, o: { agora: number; diferente: boolean; turnosRodando: number }): PassoDaAtualizacao {
  if (!o.diferente) return { estado: ATUALIZACAO_PARADA, pedir: false, motivo: "igual" };
  const pendenteDesde = e.pendenteDesde ?? o.agora;
  if (e.pedidoEm !== null) {
    if (o.agora - e.pedidoEm < ESPERA_DO_PEDIDO_MS) return { estado: { ...e, pendenteDesde }, pedir: false, motivo: "esperando_reinicio" };
    return { estado: { pendenteDesde, drenando: false, pedidoEm: null, falhouEm: o.agora }, pedir: false, motivo: "pedido_falhou" };
  }
  if (e.falhouEm !== null && o.agora - e.falhouEm < ESPERA_DEPOIS_DE_FALHAR_MS) return { estado: { ...e, pendenteDesde, drenando: false }, pedir: false, motivo: "esperando_nova_tentativa" };
  if (o.turnosRodando === 0) return { estado: { pendenteDesde, drenando: true, pedidoEm: o.agora, falhouEm: null }, pedir: true, motivo: "pedido" };
  if (e.drenando || o.agora - pendenteDesde >= JANELA_OCIOSA_MS) return { estado: { ...e, pendenteDesde, drenando: true }, pedir: false, motivo: "drenando" };
  return { estado: { ...e, pendenteDesde }, pedir: false, motivo: "esperando_ocioso" };
}
