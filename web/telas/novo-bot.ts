import { botao } from "../lib/render.ts";

export function renderNovoBot(): string {
  return `<section class="tela tela-formulario">
    <div class="eyebrow">SUA EQUIPE, DO SEU JEITO</div>
    <header class="tela-cab"><h1>Conheça seu próximo bot</h1></header>
    <p class="intro">Dê um nome, uma especialidade e uma missão. Ele pode conversar com você e pedir ajuda aos seus outros bots.</p>
    <form class="form" data-form="criar-agente">
      <label>Nome<input name="nome" placeholder="Ex.: Vera" maxlength="60" required autocomplete="off" /></label>
      <label>Especialidade<input name="titulo" placeholder="Ex.: Engenharia e boas práticas" maxlength="120" /></label>
      <label>O que esse bot faz?<textarea name="descricao" placeholder="Descreva a missão, como ele deve responder e quando deve consultar outros bots." rows="5" maxlength="8000" required></textarea></label>
      <p class="mudo">O perfil fica salvo assim que você criar. A conversa usa o Claude Code instalado nesta máquina.</p>
      <div class="acoes"><button class="bt pri" type="submit">Criar e conversar</button>${botao("navegar", "Cancelar", { dados: { tela: "frota" } })}</div>
    </form>
  </section>`;
}
