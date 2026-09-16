import type { Agente } from "../../src/contracts/agente.ts";
import type { Concessao } from "../../src/contracts/concessao.ts";
import type { Conector } from "../../src/contracts/conector.ts";
import type { Mensagem } from "../../src/contracts/mensagem.ts";
import type { Rotina } from "../../src/contracts/rotina.ts";

// Ajuste mínimo de compilação contra os contratos congelados pela L2 (2026-09-16); a L9 reescreve
// este reducer por frames SSE. `agenteId` na mensagem é o vínculo que a tela antiga ainda usa.
export type MensagemDaTela = Mensagem & { agenteId: string };

export type Pessoa = { tenantId: string; id: string; nome: string; iniciais: string };

export type Snapshot = {
  tenantId: string;
  pessoa: Pessoa;
  agentes: Agente[];
  rotinas: Rotina[];
  concessoes: Concessao[];
  catalogo: readonly Conector[];
  mensagens: MensagemDaTela[];
};

export type Estado = {
  snapshot: Snapshot | null;
  agenteAtualId: string | null;
  paletteAberta: boolean;
  detalhesAbertos: boolean;
  enviando: boolean;
  erro: string | null;
};

export type Acao =
  | { tipo: "hidratar"; snapshot: Snapshot }
  | { tipo: "selecionar"; id: string }
  | { tipo: "palette"; aberta: boolean }
  | { tipo: "detalhes"; abertos: boolean }
  | { tipo: "enviando"; valor: boolean }
  | { tipo: "erro"; texto: string | null };

export const estadoInicial: Estado = {
  snapshot: null,
  agenteAtualId: null,
  paletteAberta: false,
  detalhesAbertos: false,
  enviando: false,
  erro: null,
};

export function reduzir(estado: Estado, acao: Acao): Estado {
  switch (acao.tipo) {
    case "hidratar": {
      const ids = new Set(acao.snapshot.agentes.map((a) => a.id));
      const atual =
        estado.agenteAtualId && ids.has(estado.agenteAtualId)
          ? estado.agenteAtualId
          : (acao.snapshot.agentes[0]?.id ?? null);
      return { ...estado, snapshot: acao.snapshot, agenteAtualId: atual, enviando: false, erro: null };
    }
    case "selecionar":
      return { ...estado, agenteAtualId: acao.id, paletteAberta: false, detalhesAbertos: false };
    case "palette":
      return { ...estado, paletteAberta: acao.aberta };
    case "detalhes":
      return { ...estado, detalhesAbertos: acao.abertos };
    case "enviando":
      return { ...estado, enviando: acao.valor };
    case "erro":
      return { ...estado, erro: acao.texto, enviando: false };
  }
}

export function mensagensDo(estado: Estado): MensagemDaTela[] {
  if (!estado.snapshot || !estado.agenteAtualId) return [];
  return estado.snapshot.mensagens.filter((m) => m.agenteId === estado.agenteAtualId);
}

export function agenteAtual(estado: Estado): Agente | undefined {
  return estado.snapshot?.agentes.find((a) => a.id === estado.agenteAtualId);
}
