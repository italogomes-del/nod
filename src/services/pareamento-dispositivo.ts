import { conviteValido } from "../shared/convite.ts";
import { randomBytes, randomInt } from "node:crypto";
import { PLATAFORMAS_MAQUINA, type PlataformaMaquina } from "../contracts/ponte.ts";
import type { Escopo } from "../shared/types.ts";

/**
 * Pareamento por código, sem navegador na máquina (ADR-090, o fluxo de dispositivo da RFC 8628). Puro e SEM banco
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
/** `pedidoHaS`: há quantos segundos a máquina pediu — a confirmação mostra, para a pessoa notar um pedido que não é dela. */
export type PedidoDispositivo = { nome: string; plataforma: PlataformaMaquina; pedidoHaS: number };
export type TrocaDispositivo = { estado: "pendente" } | { estado: "aprovado"; escopo: Escopo; nome: string } | { estado: "invalido" };

export interface PareamentoDispositivo {
  /**
   * null = cheio (pedidos demais abertos): quem chama responde 429, e nenhum pedido válido é despejado. Com `convite`
   * válido (ADR-102), o pedido fica ligado a ele: a tela de quem criou o convite o vê sem a pessoa digitar o código.
   */
  pedir(e: { nome: string; plataforma: PlataformaMaquina; convite?: string }): { codigoDispositivo: string; codigoPessoa: string; intervaloS: number; prazoS: number } | null;
  /** ADR-102: o convite de uso único que vai no comando de instalação (30 min). */
  criarConvite(escopo: Escopo): { convite: string; expiraEm: number };
  /**
   * O pedido que chegou com o convite, para a tela confirmar ("A vm-bots apareceu. Conectar?"). `pendente` = ainda não
   * chegou; `invalido` = não existe, venceu ou é de outra pessoa.
   */
  verConvite(e: { convite: string; escopo: Escopo }): { estado: "pendente" } | { estado: "invalido" } | { estado: "conflito" } | { estado: "chegou"; codigo: string; pedido: PedidoDispositivo };
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
export const MAX_PEDIDOS_DISPOSITIVO = 1_000;
/** definido em 2026-10-13 (ADR-102): o convite vale 30 min e uma vez (o tempo de criar a VM e colar o comando). */
export const PRAZO_CONVITE_MS = 30 * 60_000;
const MAX_CONVITES = 1_000;
/** Revisão do PR #306: convites abertos por pessoa; o mais antigo DELA sai (antes, qualquer um despejava os dos outros). */
export const MAX_CONVITES_POR_PESSOA = 5;
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

type Pedido = { nome: string; plataforma: PlataformaMaquina; codigoPessoa: string; criado: number; ate: number; aprovadoPor: Escopo | null };

export function criarPareamentoDispositivo(agora: () => number = Date.now): PareamentoDispositivo {
  const porDispositivo = new Map<string, Pedido>();
  const porPessoa = new Map<string, string>();
  const erros = new Map<string, { n: number; desde: number }>();
  const convites = new Map<string, { escopo: Escopo; ate: number; codigoPessoa: string | null; conflito: boolean }>();
  const varrer = () => {
    const t = agora();
    for (const [c, p] of porDispositivo) if (p.ate <= t) { porDispositivo.delete(c); porPessoa.delete(p.codigoPessoa); }
    for (const [c, v] of convites) if (v.ate <= t) convites.delete(c);
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
    pedir({ nome, plataforma, convite }) {
      varrer();
      // Revisão do PR: a rota é pública; despejar o mais antigo deixaria qualquer um derrubar os pareamentos dos outros.
      if (porDispositivo.size >= MAX_PEDIDOS_DISPOSITIVO) return null;
      const codigoDispositivo = randomBytes(32).toString("base64url");
      const codigoPessoa = novoCodigoPessoa();
      // ADR-102: o convite válido e ainda não usado liga este pedido à tela de quem o criou; inválido, o pedido segue
      // como o de sempre (o código no terminal), e a pessoa ainda pode digitá-lo.
      const v = conviteValido(convite) ? convites.get(convite) : undefined;
      // Revisão do PR #306: o convite anda em URL (log de proxy, histórico do shell). Um segundo pedido com o mesmo
      // convite o derruba: a tela avisa e a pessoa gera outro, em vez de aprovar sem saber qual máquina chegou primeiro.
      if (v && v.codigoPessoa !== null) v.conflito = true;
      if (v && v.codigoPessoa === null) v.codigoPessoa = codigoPessoa;
      porDispositivo.set(codigoDispositivo, { nome, plataforma, codigoPessoa, criado: agora(), ate: agora() + PRAZO_DISPOSITIVO_MS, aprovadoPor: null });
      porPessoa.set(codigoPessoa, codigoDispositivo);
      return { codigoDispositivo, codigoPessoa: formatarCodigoPessoa(codigoPessoa), intervaloS: INTERVALO_DISPOSITIVO_S, prazoS: PRAZO_DISPOSITIVO_MS / 1000 };
    },
    criarConvite(escopo) {
      varrer();
      const dela = [...convites].filter(([, v]) => chaveDe(v.escopo) === chaveDe(escopo));
      if (dela.length >= MAX_CONVITES_POR_PESSOA) convites.delete(dela[0]![0]);
      if (convites.size >= MAX_CONVITES) convites.delete(convites.keys().next().value!);
      const convite = randomBytes(24).toString("base64url");
      const expiraEm = agora() + PRAZO_CONVITE_MS;
      convites.set(convite, { escopo, ate: expiraEm, codigoPessoa: null, conflito: false });
      return { convite, expiraEm };
    },
    verConvite({ convite, escopo }) {
      varrer();
      const v = conviteValido(convite) ? convites.get(convite) : undefined;
      if (!v || v.escopo.tenantId !== escopo.tenantId || v.escopo.pessoaId !== escopo.pessoaId) return { estado: "invalido" };
      if (v.conflito) return { estado: "conflito" };
      if (v.codigoPessoa === null) return { estado: "pendente" };
      const dispositivo = porPessoa.get(v.codigoPessoa);
      const p = dispositivo ? porDispositivo.get(dispositivo) : undefined;
      if (!p || p.aprovadoPor) return { estado: "invalido" };
      return { estado: "chegou", codigo: formatarCodigoPessoa(v.codigoPessoa), pedido: { nome: p.nome, plataforma: p.plataforma, pedidoHaS: Math.max(0, Math.round((agora() - p.criado) / 1000)) } };
    },
    ver({ codigoPessoa, escopo }) {
      const p = aberto(codigoPessoa, escopo);
      return p ? { nome: p.nome, plataforma: p.plataforma, pedidoHaS: Math.max(0, Math.round((agora() - p.criado) / 1000)) } : null;
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
