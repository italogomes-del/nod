import type { Estado } from "../estado/reducer.ts";
import { botao, esc } from "../lib/render.ts";

export function renderNovaRotina(estado: Estado, agenteId?: string): string {
  const bots = (estado.frota?.agentes ?? []).filter((a) => a.ownerId === estado.sessao?.pessoaId && a.confirmado);
  const opcoes = bots.map((a) => `<option value="${esc(a.id)}"${a.id === agenteId ? " selected" : ""}>${esc(a.nome)}</option>`).join("");
  return `<section class="tela tela-formulario">
    <div class="eyebrow">DEIXE O RECORRENTE COM SEUS BOTS</div>
    <header class="tela-cab"><h1>Nova rotina</h1></header>
    <p class="intro">Escolha o bot e quando ele deve trabalhar. O resultado chega na conversa dele.</p>
    ${bots.length ? `<form class="form" data-form="criar-rotina">
      <label>Bot responsável<select name="agenteId">${opcoes}</select></label>
      <label>O que ele deve fazer?<textarea name="instrucao" rows="3" placeholder="Prepare um resumo das prioridades da semana" required></textarea></label>
      <div class="form-dupla"><label>Frequência<select name="frequencia"><option value="1-5">Dias úteis</option><option value="*">Todos os dias</option><option value="1">Toda segunda-feira</option><option value="5">Toda sexta-feira</option></select></label><label>Horário<input type="time" name="horario" value="09:00" required /></label></div>
      <label>Fuso horário<input name="fusoIana" value="America/Sao_Paulo" required list="fusos" /><datalist id="fusos"><option value="America/Sao_Paulo"></option><option value="America/Manaus"></option><option value="Europe/Lisbon"></option><option value="UTC"></option></datalist></label>
      <label>Fonte de informação<input name="fonte" value="Contexto da conversa e memória do bot" required /></label>
      <label>Resultado esperado<input name="entregavel" value="Resumo nesta conversa" required /></label>
      <details><summary>Limites e falta de dados</summary><label>Antes de agir fora do nod<input name="limitesAprovacao" value="Pedir aprovação antes de qualquer ação externa" required /></label><label>Se faltar informação<input name="politicaSemDado" value="Avisar que faltam dados, sem inventar resultados" required /></label></details>
      <p class="mudo">As rotinas rodam enquanto o nod e esta máquina estiverem ligados. Você pode pausar ou testar a qualquer momento.</p>
      <div class="acoes"><button class="bt pri" type="submit">Criar rotina</button>${botao("navegar", "Cancelar", { dados: { tela: "rotinas" } })}</div>
    </form>` : `<p>Crie um bot com perfil completo para programar uma rotina.</p>${botao("navegar", "Criar bot", { classe: "pri", dados: { tela: "novo-bot" } })}`}
  </section>`;
}
