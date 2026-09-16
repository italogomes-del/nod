import type { ConectorCatalogo } from "../contracts/conector.ts";

export const CATALOGO_CONECTORES: readonly ConectorCatalogo[] = [
  {
    id: "slack",
    nome: "Slack",
    resumo: "Ler e escrever nos canais e conversas da sua conta.",
    sugestaoToca: true,
    capacidades: [
      { id: "ler-canais", rotulo: "Ler mensagens dos canais que você vê" },
      { id: "buscar", rotulo: "Buscar conversas" },
      { id: "enviar-mensagem", rotulo: "Enviar mensagem" },
      { id: "reagir", rotulo: "Reagir a mensagens" },
    ],
  },
  {
    id: "notion",
    nome: "Notion",
    resumo: "Ler e editar páginas e bases do workspace autorizado.",
    sugestaoToca: true,
    capacidades: [
      { id: "ler-paginas", rotulo: "Ler páginas" },
      { id: "buscar", rotulo: "Buscar no workspace" },
      { id: "criar-pagina", rotulo: "Criar página" },
      { id: "editar-pagina", rotulo: "Editar página" },
    ],
  },
  {
    id: "gmail",
    nome: "Gmail",
    resumo: "Ler a caixa e rascunhar respostas com a sua conta.",
    sugestaoToca: true,
    capacidades: [
      { id: "ler", rotulo: "Ler e-mails" },
      { id: "buscar", rotulo: "Buscar na caixa" },
      { id: "rascunhar", rotulo: "Criar rascunho" },
      { id: "enviar", rotulo: "Enviar e-mail" },
    ],
  },
  {
    id: "clickup",
    nome: "ClickUp",
    resumo: "Ver e mover tarefas do espaço autorizado.",
    sugestaoToca: true,
    capacidades: [
      { id: "ler-tarefas", rotulo: "Ler tarefas" },
      { id: "criar-tarefa", rotulo: "Criar tarefa" },
      { id: "mover-status", rotulo: "Mudar status" },
      { id: "comentar", rotulo: "Comentar" },
    ],
  },
  {
    id: "github",
    nome: "GitHub",
    resumo: "Ler repositórios e abrir alterações com a sua conta.",
    sugestaoToca: false,
    capacidades: [
      { id: "ler", rotulo: "Ler issues e pull requests" },
      { id: "comentar", rotulo: "Comentar" },
      { id: "abrir-pr", rotulo: "Abrir pull request" },
      { id: "fazer-merge", rotulo: "Fazer merge" },
    ],
  },
  {
    id: "calendar",
    nome: "Google Agenda",
    resumo: "Ler e criar eventos na agenda autorizada.",
    sugestaoToca: true,
    capacidades: [
      { id: "ler", rotulo: "Ler eventos" },
      { id: "criar", rotulo: "Criar evento" },
      { id: "convidar", rotulo: "Convidar pessoas" },
    ],
  },
];

const PALAVRAS: Record<string, RegExp> = {
  slack: /\bslack\b/i,
  notion: /\bnotion\b/i,
  gmail: /\bgmail\b|e-?mails?|caixa de entrada/i,
  clickup: /\bclickup\b/i,
  github: /\bgithub\b|\bpull requests?\b|\bprs?\b/i,
  calendar: /\bagenda\b|google calendar|calendário/i,
};

export function conectorPorId(id: string): ConectorCatalogo | undefined {
  return CATALOGO_CONECTORES.find((c) => c.id === id);
}

export function detectarConectores(texto: string): ConectorCatalogo[] {
  return CATALOGO_CONECTORES.filter((c) => PALAVRAS[c.id]?.test(texto));
}

export function complementoCapacidades(
  conector: ConectorCatalogo,
  ligadas: readonly string[],
): string[] {
  return conector.capacidades.filter((c) => !ligadas.includes(c.id)).map((c) => c.rotulo);
}
