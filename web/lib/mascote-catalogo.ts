import type { StateId } from "../vendor/bloub/states.ts";
import type { FormaAgente } from "../../src/contracts/agente.ts";
import type { ShapeId } from "../vendor/bloub/skins.ts";

export const FORMAS_BLOUB: Record<FormaAgente, ShapeId> = {
  "shape-square": "squircle", "shape-hex": "hexagone", "shape-circle": "cercle",
  "shape-pebble": "galet", "shape-capsule": "capsule", "shape-triangle": "triangle",
  "shape-cloud": "nuage", "shape-drop": "goutte",
};
// definido em 2026-09-18: reservado não representa um fato atual do produto.
export const CATALOGO_MASCOTE = {
  idle: { nome: "Repouso", ativo: true, situacao: "Sem turno vivo nem decisão pendente" },
  thinking: { nome: "Pensando", ativo: true, situacao: "Turno na fila" },
  orbit: { nome: "Trabalhando", ativo: true, situacao: "Turno rodando" },
  notify: { nome: "Sua vez", ativo: true, situacao: "Decisão não vencida, sem turno vivo" },
  wink: { nome: "Piscadela", ativo: false, situacao: "Confirmação breve de uma ação" },
  wide: { nome: "Surpresa", ativo: false, situacao: "Descoberta relevante" },
  alert: { nome: "Alerta", ativo: false, situacao: "Falha recuperável que exige atenção" },
  exclaim: { nome: "Urgente", ativo: false, situacao: "Bloqueio crítico ou prazo próximo" },
  sleep: { nome: "Dormindo", ativo: false, situacao: "Agente explicitamente suspenso (não apenas sem tarefa)" },
  egg: { nome: "Ovo", ativo: false, situacao: "Criação ou preparação inicial do agente" },
  hexagon: { nome: "Hexágono", ativo: false, situacao: "Preparação de integração" },
  play: { nome: "Play", ativo: false, situacao: "Início ou retomada confirmada de execução" },
  burst: { nome: "Explosão", ativo: false, situacao: "Conclusão bem-sucedida, uma vez por entrega" },
  comet: { nome: "Cometa", ativo: false, situacao: "Transferência de tarefa entre agentes" },
  swirl: { nome: "Espiral", ativo: false, situacao: "Transição visual entre contextos; não é status de negócio" },
} satisfies Record<StateId, { nome: string; ativo: boolean; situacao: string }>;
