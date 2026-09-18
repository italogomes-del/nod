import type { Estado } from "../estado/reducer.ts";
import { botao, dataHora, esc, iconeAgente } from "../lib/render.ts";
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

  /** Cada concessão com o conector escrito por extenso: "github · ler issues", nunca só um id. */
  const acessos = concessoes
    .map((g) => {
      const c = estado.conectores.find((x) => x.id === g.conectorId);
      const indisponivel = c?.ultimaFalha ? '<span class="tag tag-ambar" title="o conector está fora do ar">indisponível</span>' : "";
      return `<li class="acesso"><div><b>${esc(c?.nome ?? "conector")}</b><small>${esc(g.capacidade)}</small></div>${indisponivel}${botao("revogar", "revogar", { classe: "link sm", id: g.id, dados: { agente: a.id } })}</li>`;
    })
    .join("");

  const linhaRotina = ({ rotina: r, proximaExecucao }: (typeof rotinas)[number]) => {
    const quando = r.estado === "pausada" ? "Pausada" : `${dataHora(proximaExecucao, r.fusoIana)} · ${interpolar(proximaExecucao, estado.agora)}`;
    return `<li class="detalhe-rotina rotina-${esc(r.estado)}">
      <div class="dr-txt"><b>${esc(r.instrucao)}</b><small>${esc(quando)}</small></div>
      <div class="dr-acoes">${r.estado === "ativa" ? botao("pausar-rotina", "Pausar", { classe: "link sm", id: r.id }) : botao("ativar-rotina", "Ativar", { classe: "link sm", id: r.id })}${botao("executar-rotina", "Testar", { classe: "link sm", id: r.id, dados: { agente: r.agenteId }, desabilitado: estado.ocupado })}</div>
    </li>`;
  };

  return `<div class="detalhes-perfil"><div class="detalhes-identidade">${iconeAgente(a, "lg")}<div><h2>${esc(a.nome)}</h2><span>${esc(a.titulo || "Seu bot")}</span></div></div><p>${esc(a.descricao || "Conte na conversa como este bot pode ajudar você.")}</p>${botao("ir-perfil", "Editar perfil", { id: a.id, classe: "link" })}</div>
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
    <section class="detalhes-secao"><h3>Execução</h3><p class="mudo">${estado.executor?.atual === "catcher" ? "Simulação · respostas de teste" : "Sua conta de IA · computador conectado"}</p><p class="mudo">Use Computador na conversa para abrir a tela, entrar nos apps e acompanhar o trabalho.</p></section>`;
}
