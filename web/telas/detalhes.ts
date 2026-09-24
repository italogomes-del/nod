import type { Estado } from "../estado/reducer.ts";
import { botao, dataHora, esc, iconeAgente } from "../lib/render.ts";
import { MOTIVO_FALHA_TEXTO } from "../lib/computador.ts";
import { rotuloExecucao } from "../lib/execucao.ts";
import { interpolar } from "../lib/relogio.ts";

/**
 * Painel do bot (ADR-032: "painel de detalhes com perfil, colegas e rotinas"). Desde 2026-09-18 ele é
 * o lar do que É DO BOT — rotinas e acessos concedidos são por agente, nunca lugares próprios; por
 * isso saíram do rail e vieram para cá, ao lado da conversa a que pertencem. As telas cheias
 * (`rotinas`, `conectores`) continuam existindo e são alcançadas daqui, para o que não cabe no painel.
 */
export function renderDetalhes(estado: Estado): string {
  const t = estado.tela;
  if (t.tipo !== "conversa") return "";
  const a = estado.frota?.agentes.find((b) => b.id === t.agenteId);
  if (!a) return "";
  const colegas = (estado.frota?.agentes ?? []).filter((b) => b.id !== a.id && b.ownerId === a.ownerId && b.confirmado);
  const rotinas = estado.rotinas.filter((r) => r.rotina.agenteId === a.id);
  const concessoes = estado.concessoes[a.id] ?? [];

  /**
   * definido em 2026-09-24 (ADR-044): um clique concede as ferramentas de leitura de um app inteiro, e
   * 28 linhas de nome técnico escondiam o que importa. Uma linha por app e nível ("Gmail · só leitura ·
   * 28 ações"), os nomes no <details> e revogar tira o grupo de uma vez, com um registro só. O nível é
   * o readOnlyHint da sonda; o que o catálogo não descreve conta como escrita — o painel não promete
   * "só leitura" sem a sonda dizer.
   */
  const grupos = new Map<string, { nome: string; leitura: boolean; indisponivel: boolean; itens: typeof concessoes }>();
  for (const g of concessoes) {
    const c = estado.conectores.find((x) => x.id === g.conectorId);
    const leitura = c?.catalogo.find((x) => x.nome === g.capacidade)?.readOnlyHint === true;
    const chave = `${g.conectorId}:${leitura ? "leitura" : "escrita"}`;
    const grupo = grupos.get(chave) ?? { nome: c?.nome ?? "conector", leitura, indisponivel: Boolean(c?.ultimaFalha), itens: [] };
    grupo.itens.push(g);
    grupos.set(chave, grupo);
  }
  const acessos = [...grupos.entries()]
    .map(([chave, g]) => {
      const indisponivel = g.indisponivel ? '<span class="tag tag-ambar" title="o conector está fora do ar">indisponível</span>' : "";
      const acoes = `${g.itens.length} ${g.itens.length === 1 ? "ação" : "ações"}`;
      const nomes = `<details data-disclosure="acessos-${esc(a.id)}-${esc(chave)}"><summary>ver ${g.itens.length === 1 ? "a ação" : "as ações"}</summary><ul>${g.itens.map((i) => `<li><code>${esc(i.capacidade)}</code></li>`).join("")}</ul></details>`;
      return `<li class="acesso"><div><b>${esc(g.nome)}</b><small>${g.leitura ? "só leitura" : "pode alterar"} · ${acoes}</small>${nomes}</div>${indisponivel}${botao("revogar-acessos", "revogar", { classe: "link sm", dados: { agente: a.id, ids: g.itens.map((i) => i.id).join(",") }, titulo: g.itens.length === 1 ? "revoga a ação deste grupo" : `revoga as ${acoes} deste grupo` })}</li>`;
    })
    .join("");

  // definido em 2026-09-21: uma rotina pode encerrar em SILÊNCIO (desfecho sem_novidade não escreve
  // nada na conversa). Sem este histórico aqui a pessoa não teria como saber que ela rodou — o
  // painel é o lugar onde "rodou e não tinha nada" fica visível.
  const historico = (r: (typeof rotinas)[number]["rotina"]) => {
    const exec = estado.execucoes[r.id];
    if (!exec) return botao("ver-execucoes", "Histórico", { classe: "link sm", id: r.id });
    if (!exec.length) return '<p class="mudo sm">nunca executou</p>';
    return `<ul class="dr-execucoes">${exec
      .slice(0, 5)
      .map((e) => `<li class="exec exec-${esc(e.desfecho)}">${esc(dataHora(e.em, r.fusoIana))} · ${esc(rotuloExecucao(e))}</li>`)
      .join("")}</ul>`;
  };

  const linhaRotina = ({ rotina: r, proximaExecucao }: (typeof rotinas)[number]) => {
    const quando = r.estado === "pausada" ? "Pausada" : `${dataHora(proximaExecucao, r.fusoIana)} · ${interpolar(proximaExecucao, estado.agora)}`;
    return `<li class="detalhe-rotina rotina-${esc(r.estado)}">
      <div class="dr-txt"><b>${esc(r.instrucao)}</b><small>${esc(quando)}</small></div>
      <div class="dr-acoes">${r.estado === "ativa" ? botao("pausar-rotina", "Pausar", { classe: "link sm", id: r.id }) : botao("ativar-rotina", "Ativar", { classe: "link sm", id: r.id })}${botao("executar-rotina", "Testar", { classe: "link sm", id: r.id, dados: { agente: r.agenteId }, desabilitado: estado.ocupado })}</div>
      ${historico(r)}
    </li>`;
  };

  // definido em 2026-09-24 (emenda da ADR-037): fora do ar, o computador do bot abre o painel — é o
  // estado que muda o que o bot consegue fazer agora. Ligado e respondendo, não ocupa lugar.
  const fora = a.computadorForaDoAr && a.ownerId === estado.sessao?.pessoaId ? a.computadorForaDoAr : null;
  const computador = fora
    ? `<section class="detalhes-secao"><h3>Computador do bot</h3><div class="detalhe-computador-fora"><span class="tag tag-vermelha">fora do ar</span><p>Desde ${esc(dataHora(fora.desde))} · ${esc(MOTIVO_FALHA_TEXTO[fora.motivo])}.</p><div class="dr-acoes">${botao("religar-computador", "Tentar de novo", { classe: "link sm", id: a.id })}${botao("abrir-computador", "Abrir computador", { classe: "link sm", id: a.id })}</div></div></section>`
    : "";

  return `<div class="detalhes-perfil"><div class="detalhes-identidade">${iconeAgente(a, "lg")}<div><h2>${esc(a.nome)}</h2><span>${esc(a.titulo || "Seu bot")}</span></div></div><p>${esc(a.descricao || "Conte na conversa como este bot pode ajudar você.")}</p>${botao("ir-perfil", "Editar perfil", { id: a.id, classe: "link" })}</div>
    ${computador}
    <section class="detalhes-secao"><h3>Atalhos</h3>
      ${botao("preencher-prompt", "✧  Planejar uma tarefa", { classe: "atalho", dados: { texto: "Me ajude a planejar esta tarefa: " } })}
      ${botao("preencher-prompt", "↗  Pedir ajuda a outro bot", { classe: "atalho", dados: { texto: "Consulte o colega mais adequado da minha equipe para me ajudar com: " } })}
      ${botao("ir-memoria", "▤  Ver memória", { classe: "atalho", id: a.id })}
    </section>
    <section class="detalhes-secao"><div class="secao-titulo"><h3>Rotinas${rotinas.length ? ` <span class="cont">${rotinas.length}</span>` : ""}</h3>${botao("nova-rotina", "+ Nova", { classe: "link", id: a.id })}</div>
      ${rotinas.length ? `<ul class="lista-detalhe">${rotinas.slice(0, 4).map(linhaRotina).join("")}</ul>` : '<p class="mudo">Uma tarefa que se repete? Programe aqui ou peça na conversa.</p>'}
      ${rotinas.length > 4 ? botao("navegar", `ver todas as ${rotinas.length}`, { classe: "link sm", dados: { tela: "rotinas" } }) : ""}
    </section>
    <section class="detalhes-secao"><div class="secao-titulo"><h3>Acessos${acessos ? ` <span class="cont">${concessoes.length}</span>` : ""}</h3>${botao("abrir-conexao", "+ Conectar", { classe: "link" })}</div>
      ${acessos ? `<ul class="lista-detalhe">${acessos}</ul>` : '<p class="mudo">Este bot ainda não usa nenhuma ferramenta externa. Ele pede o acesso quando precisar — ou conecte você mesmo.</p>'}
    </section>
    <section class="detalhes-secao"><div class="secao-titulo"><h3>Colabora com</h3>${botao("navegar", "Criar sala", { classe: "link", dados: { tela: "nova-sala" } })}</div>
      ${colegas.length ? colegas.slice(0, 8).map((b) => `<button class="colega" data-act="preencher-prompt" data-texto="Consulte @${esc(b.nome)} sobre: ">${iconeAgente(b)}<div><b>${esc(b.nome)}</b><small>${esc(b.titulo || "Bot da sua equipe")}</small></div></button>`).join("") : '<p class="mudo">Crie outro bot para eles trabalharem juntos.</p>'}
    </section>
    <section class="detalhes-secao"><h3>Execução</h3><p class="mudo">${estado.executor?.atual === "catcher" ? "Simulação · respostas de teste" : "Sua conta de IA · computador conectado"}</p><p class="mudo">Use Computador do bot na conversa para abrir a tela dele, entrar nos apps e acompanhar o trabalho.</p></section>`;
}
