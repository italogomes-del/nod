export type AppMarketplace = {
  slug: string;
  nome: string;
  descricao: string;
  categoria: string;

};

/** definido em 2026-09-17: catálogo Composio; a pessoa autoriza cada app em login separado. */
export const APPS_MARKETPLACE: readonly AppMarketplace[] = [
  {
    slug: "slack", nome: "Slack", descricao: "Encontre conversas, acompanhe sua equipe e prepare mensagens.", categoria: "Comunicação",

  },
  {
    slug: "github", nome: "GitHub", descricao: "Explore repositórios, revise pull requests e acompanhe issues.", categoria: "Desenvolvimento",

  },
  { slug: "gmail", nome: "Gmail", descricao: "Leia e organize emails, prepare respostas e acompanhe sua caixa de entrada.", categoria: "Comunicação" },
  { slug: "notion", nome: "Notion", descricao: "Encontre documentos e mantenha as informações do time organizadas.", categoria: "Conhecimento" },
  { slug: "linear", nome: "Linear", descricao: "Acompanhe projetos, organize issues e descubra o que está bloqueado.", categoria: "Projetos" },
  { slug: "googlesheets", nome: "Google Sheets", descricao: "Consulte planilhas, analise resultados e prepare relatórios.", categoria: "Produtividade" },
  { slug: "googlecalendar", nome: "Google Calendar", descricao: "Consulte sua agenda e organize compromissos.", categoria: "Produtividade" },
  { slug: "clickup", nome: "ClickUp", descricao: "Acompanhe tarefas, prazos e prioridades dos seus projetos.", categoria: "Projetos" },
];
