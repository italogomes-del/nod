import type { Estado } from "../estado/reducer.ts";
import { botao, dataHora, esc, iconeAgente } from "../lib/render.ts";

export function renderDetalhes(estado: Estado): string {
  const t = estado.tela;
  if (t.tipo !== "conversa") return "";
  const a = estado.frota?.agentes.find((b) => b.id === t.agenteId);
  if (!a) return "";
  const colegas = (estado.frota?.agentes ?? []).filter((b) => b.id !== a.id && b.ownerId === a.ownerId && b.confirmado);
  const rotinas = estado.rotinas.filter((r) => r.rotina.agenteId === a.id);
  return `<div class="detalhes-perfil"><div class="detalhes-identidade">${iconeAgente(a, "lg")}<div><h2>${esc(a.nome)}</h2><span>${esc(a.titulo || "Seu bot")}</span></div></div><p>${esc(a.descricao || "Conte na conversa como este bot pode ajudar você.")}</p>${botao("ir-perfil", "Editar perfil", { id: a.id, classe: "link" })}</div>
    <section class="detalhes-secao"><h3>Atalhos</h3>
      ${botao("preencher-prompt", "✧  Planejar uma tarefa", { classe: "atalho", dados: { texto: "Me ajude a planejar esta tarefa: " } })}
      ${botao("preencher-prompt", "↗  Pedir ajuda a outro bot", { classe: "atalho", dados: { texto: "Consulte o colega mais adequado da minha equipe para me ajudar com: " } })}
      ${botao("ir-memoria", "▤  Ver memória", { classe: "atalho", id: a.id })}
    </section>
    <section class="detalhes-secao"><div class="secao-titulo"><h3>Rotinas</h3>${botao("nova-rotina", "+ Nova", { classe: "link", id: a.id })}</div>
      ${rotinas.length ? rotinas.slice(0, 4).map(({ rotina: r }) => `<button class="detalhe-rotina" data-act="navegar" data-tela="rotinas"><span>◷</span><div><b>${esc(r.instrucao)}</b><small>${r.estado === "pausada" ? "Pausada" : esc(dataHora(r.proximaExecucao, r.fusoIana))} · ${esc(r.fusoIana)}</small></div></button>`).join("") : '<p class="mudo">Uma tarefa que se repete? Programe aqui ou peça na conversa.</p>'}
    </section>
    <section class="detalhes-secao"><div class="secao-titulo"><h3>Colabora com</h3>${botao("navegar", "Criar sala", { classe: "link", dados: { tela: "nova-sala" } })}</div>
      ${colegas.length ? colegas.slice(0, 8).map((b) => `<button class="colega" data-act="preencher-prompt" data-texto="Consulte @${esc(b.nome)} sobre: ">${iconeAgente(b)}<div><b>${esc(b.nome)}</b><small>${esc(b.titulo || "Bot da sua equipe")}</small></div></button>`).join("") : '<p class="mudo">Crie outro bot para eles trabalharem juntos.</p>'}
    </section>
    <section class="detalhes-secao"><h3>Execução</h3><p class="mudo">${estado.executor?.atual === "claude-cli" ? "Claude Code · sua assinatura" : "Simulação · respostas de teste"}</p><p class="mudo">Computador remoto previsto para uma próxima versão.</p></section>`;
}
