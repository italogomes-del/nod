import { randomBytes, randomInt } from "node:crypto";
import { PLATAFORMAS_MAQUINA, type PlataformaMaquina } from "../contracts/ponte.ts";
import type { Escopo } from "../shared/types.ts";

/**
 * Pareamento por código, sem navegador na máquina (ADR-088, o fluxo de dispositivo da RFC 8628). Puro e SEM banco
 * (src/services), em memória como o pareamento do Mac (ADR-069): um pedido vive minutos, e um reinício do servidor só
 * obriga a pessoa a rodar o pareamento de novo.
 *
 *   máquina: pedir(nome) ──► codigoDispositivo (segredo, fica na máquina) + codigoPessoa ("K7QM-4F2X", vai para a tela)
 *   pessoa, com sessão: ver(codigoPessoa) → "Conectar vm-sp (Linux)?" → aprovar(codigoPessoa, escopo)
 *   máquina, a cada `intervalo`: trocar(codigoDispositivo) ──► pendente | aprovado (escopo + nome, uma vez só) | inválido
 *
 * O código da pessoa sozinho não entrega a chave: quem troca precisa do codigoDispositivo, que nunca sai da máquina. A
 * chave nasce na troca, no escopo de quem aprovou. Errar o código conta por pessoa, para o código curto não ser adivinhado.
 */
export type PedidoDispositivo = { nome: string; plataforma: PlataformaMaquina };
export type TrocaDispositivo = { estado: "pendente" } | { estado: "aprovado"; escopo: Escopo; nome: string } | { estado: "invalido" };

export interface PareamentoDispositivo {
  pedir(e: { nome: string; plataforma: PlataformaMaquina }): { codigoDispositivo: string; codigoPessoa: string; intervaloS: number; prazoS: number };
  /** O pedido do código, para a tela confirmar; null = não existe, venceu, já foi aprovado ou a pessoa errou demais. */
  ver(e: { codigoPessoa: string; escopo: Escopo }): PedidoDispositivo | null;
  aprovar(e: { codigoPessoa: string; escopo: Escopo }): boolean;
  trocar(e: { codigoDispositivo: string }): TrocaDispositivo;
}

/** definido em 2026-10-09: 10 min entre a instalação mostrar o código e a pessoa digitá-lo (ela pode ir buscar o Mac). */
export const PRAZO_DISPOSITIVO_MS = 600_000;
/** O motor pergunta a cada 5 s (RFC 8628 §3.5, o padrão do `interval`). */
export const INTERVALO_DISPOSITIVO_S = 5;
/** definido em 2026-10-09: 10 códigos errados por pessoa em 10 min; depois, nenhum código vale até a janela passar. */
export const MAX_ERROS_POR_PESSOA = 10;
const JANELA_ERROS_MS = 600_000;
const MAX_PEDIDOS = 1_000;
/** Sem 0/O, 1/I/L e U (RFC 8628 §6.1): 31 símbolos, 8 caracteres ≈ 2^39 combinações para um código que vive 10 min. */
const ALFABETO = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODIGO_DISPOSITIVO = /^[A-Za-z0-9_-]{43}$/;

/** "k7qm 4f2x", "K7QM-4F2X" e "k7qm4f2x" são o mesmo código: maiúsculas, sem separador. */
export function normalizarCodigoPessoa(v: string): string {
  return v.toUpperCase().replace(/[\s-]/g, "");
}
/** Para mostrar: "K7QM-4F2X". */
export function formatarCodigoPessoa(v: string): string {
  const n = normalizarCodigoPessoa(v);
  return n.length === 8 ? `${n.slice(0, 4)}-${n.slice(4)}` : n;
}
export function lerPlataforma(v: unknown): PlataformaMaquina | null {
  return PLATAFORMAS_MAQUINA.find((p) => p === v) ?? null;
}

type Pedido = PedidoDispositivo & { codigoPessoa: string; ate: number; aprovadoPor: Escopo | null };

export function criarPareamentoDispositivo(agora: () => number = Date.now): PareamentoDispositivo {
  const porDispositivo = new Map<string, Pedido>();
  const porPessoa = new Map<string, string>();
  const erros = new Map<string, { n: number; desde: number }>();
  const varrer = () => {
    const t = agora();
    for (const [c, p] of porDispositivo) if (p.ate <= t) { porDispositivo.delete(c); porPessoa.delete(p.codigoPessoa); }
    for (const [k, e] of erros) if (t - e.desde >= JANELA_ERROS_MS) erros.delete(k);
  };
  const chaveDe = (escopo: Escopo) => `${escopo.tenantId}:${escopo.pessoaId}`;
  const bloqueada = (escopo: Escopo) => (erros.get(chaveDe(escopo))?.n ?? 0) >= MAX_ERROS_POR_PESSOA;
  const errou = (escopo: Escopo) => {
    const k = chaveDe(escopo);
    const e = erros.get(k);
    erros.set(k, e ? { n: e.n + 1, desde: e.desde } : { n: 1, desde: agora() });
  };
  /** O pedido aberto do código; conta um erro quando o código não existe (a pessoa digitou errado ou alguém tenta adivinhar). */
  const aberto = (codigoPessoa: string, escopo: Escopo): Pedido | null => {
    varrer();
    if (bloqueada(escopo)) return null;
    const dispositivo = porPessoa.get(normalizarCodigoPessoa(codigoPessoa));
    const p = dispositivo ? porDispositivo.get(dispositivo) : undefined;
    if (!p || p.aprovadoPor) { errou(escopo); return null; }
    return p;
  };
  const novoCodigoPessoa = () => {
    for (;;) {
      let c = "";
      for (let i = 0; i < 8; i++) c += ALFABETO[randomInt(ALFABETO.length)];
      if (!porPessoa.has(c)) return c;
    }
  };
  return {
    pedir({ nome, plataforma }) {
      varrer();
      while (porDispositivo.size >= MAX_PEDIDOS) {
        const [c, p] = porDispositivo.entries().next().value as [string, Pedido];
        porDispositivo.delete(c); porPessoa.delete(p.codigoPessoa);
      }
      const codigoDispositivo = randomBytes(32).toString("base64url");
      const codigoPessoa = novoCodigoPessoa();
      porDispositivo.set(codigoDispositivo, { nome, plataforma, codigoPessoa, ate: agora() + PRAZO_DISPOSITIVO_MS, aprovadoPor: null });
      porPessoa.set(codigoPessoa, codigoDispositivo);
      return { codigoDispositivo, codigoPessoa: formatarCodigoPessoa(codigoPessoa), intervaloS: INTERVALO_DISPOSITIVO_S, prazoS: PRAZO_DISPOSITIVO_MS / 1000 };
    },
    ver({ codigoPessoa, escopo }) {
      const p = aberto(codigoPessoa, escopo);
      return p ? { nome: p.nome, plataforma: p.plataforma } : null;
    },
    aprovar({ codigoPessoa, escopo }) {
      const p = aberto(codigoPessoa, escopo);
      if (!p) return false;
      p.aprovadoPor = escopo;
      return true;
    },
    trocar({ codigoDispositivo }) {
      if (!CODIGO_DISPOSITIVO.test(codigoDispositivo)) return { estado: "invalido" };
      varrer();
      const p = porDispositivo.get(codigoDispositivo);
      if (!p) return { estado: "invalido" };
      if (!p.aprovadoPor) return { estado: "pendente" };
      porDispositivo.delete(codigoDispositivo);
      porPessoa.delete(p.codigoPessoa);
      return { estado: "aprovado", escopo: p.aprovadoPor, nome: p.nome };
    },
  };
}
