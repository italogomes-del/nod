import type { Agente, EsforcoAgente } from "../../src/contracts/agente.ts";
import type { CatalogoHarness, PreferenciaHarness } from "../../src/contracts/harness.ts";
import { esc } from "../lib/render.ts";

export function nomeInteligencia(a: Pick<Agente, "modelo" | "harness">, catalogo?: CatalogoHarness): string {
  if (a.modelo === "auto" && (!a.harness || a.harness === "auto")) return "Automático";
  const h = catalogo?.opcoes.find((h) => h.id === a.harness || ((!a.harness || a.harness === "auto") && h.id === "claude-cli"));
  return a.modelo === "auto" ? h?.nome ?? "Automático" : h?.modelos.find((m) => m.id === a.modelo)?.nome ?? a.modelo;
}

export function escolhaInteligencia(dados: FormData): { harness: PreferenciaHarness; modelo: string; esforco?: string } {
  const valor = String(dados.get("inteligencia") ?? "auto");
  // "" = o padrão do modelo; campo ausente (formulário sem o card) = não mexe.
  const esforco = dados.has("esforco") ? { esforco: String(dados.get("esforco") ?? "") } : {};
  if (valor === "auto") return { harness: "auto", modelo: "auto", ...esforco };
  const [harness, ...modelo] = valor.split(":");
  return { harness: harness as PreferenciaHarness, modelo: modelo.join(":"), ...esforco };
}

/** O `--effort` do Claude Code em palavras (0037). A web não importa valor de src (ADR-018): a lista é espelho tipado. */
const ESFORCOS: Record<EsforcoAgente, string> = {
  low: "Baixo · mais rápido",
  medium: "Médio",
  high: "Alto",
  xhigh: "Muito alto",
  max: "Máximo · mais lento e mais caro",
};

function renderEsforco(atual: EsforcoAgente | null | undefined): string {
  const opcoes = [`<option value=""${atual ? "" : " selected"}>Padrão do modelo</option>`, ...(Object.keys(ESFORCOS) as EsforcoAgente[]).map((e) => `<option value="${e}"${e === atual ? " selected" : ""}>${esc(ESFORCOS[e])}</option>`)];
  return `<label class="inteligencia-label">Esforço<select name="esforco" aria-describedby="esforco-ajuda">${opcoes.join("")}</select></label>
      <p id="esforco-ajuda" class="inteligencia-ajuda">Quanto o modelo pensa antes de agir. Só no Claude Code; mudar não recomeça a conversa.</p>`;
}

export function renderInteligencia(a: Pick<Agente, "modelo" | "harness" | "esforco">, catalogo?: CatalogoHarness, aberto = false): string {
  const hAtual = a.harness && a.harness !== "auto" ? a.harness : a.modelo === "auto" ? "auto" : "claude-cli";
  const valor = hAtual === "auto" ? "auto" : `${hAtual}:${a.modelo}`;
  const atual = nomeInteligencia(a, catalogo);
  const padrao = catalogo?.opcoes.find((h) => h.id === catalogo.padrao);
  const opcoes: string[] = ['<option value="auto"' + (valor === "auto" ? ' selected' : '') + '>Automático · recomendado</option>'];
  let encontrado = valor === "auto";
  for (const h of catalogo?.opcoes ?? []) {
    if (!h.integrado) continue;
    const disponivel = h.inventario.estado === "pronto";
    const modelos = [{ id: "auto", nome: "Recomendado pelo nod", descricao: "" }, ...h.modelos];
    opcoes.push(`<optgroup label="${esc(h.nome)}${disponivel ? "" : " · não conectado"}">${modelos.map((m) => {
      const v = `${h.id}:${m.id}`; const selecionado = v === valor; encontrado ||= selecionado;
      return `<option value="${esc(v)}"${selecionado ? " selected" : ""}${!disponivel && !selecionado ? " disabled" : ""}>${esc(m.nome)}${m.descricao ? ` · ${esc(m.descricao)}` : ""}</option>`;
    }).join("")}</optgroup>`);
  }
  if (!encontrado) opcoes.push(`<option selected value="${esc(valor)}">${esc(atual)} · configuração atual</option>`);
  return `<section class="inteligencia-card" aria-label="Inteligência do agente">
    <div class="inteligencia-topo"><span class="inteligencia-simbolo" aria-hidden="true">✦</span><div><h3>Inteligência do agente</h3><p>Você pede. O nod cuida da escolha.</p></div><span class="inteligencia-chip">${esc(atual)}</span></div>
    <p class="inteligencia-contexto">${catalogo?.simulacao ? "Este ambiente está em simulação. A preferência fica salva para quando uma conta de IA estiver conectada." : padrao ? `No automático, usamos uma opção conectada neste computador. Hoje: ${esc(padrao.nome)}.` : "Conecte sua conta de IA no computador para começar. O nod escolhe uma opção disponível automaticamente."}</p>
    <details class="inteligencia-personalizar"${aberto || valor !== "auto" ? " open" : ""}><summary>Personalizar modelo <span>Opcional</span></summary>
      <label class="inteligencia-label">Modelo<select name="inteligencia" aria-describedby="inteligencia-ajuda">${opcoes.join("")}</select></label>
      <p id="inteligencia-ajuda" class="inteligencia-ajuda">Vale para as próximas tarefas. Seu histórico e sua memória continuam aqui. Volte a Automático quando quiser.</p>
      ${renderEsforco(a.esforco)}
      <details class="inteligencia-avancado"><summary>Harnesses e disponibilidade</summary><p>O harness conecta o agente à sua conta de IA. Cada um oferece seus próprios modelos; a disponibilidade depende da sua conta.</p>
        <ul>${(catalogo?.opcoes ?? []).map((h) => `<li><div><b>${esc(h.nome)}</b><span class="harness-status ${h.inventario.estado === "pronto" && h.integrado ? "pronto" : ""}">${!h.integrado ? "Em preparação" : h.inventario.estado === "pronto" ? "Conectado" : "Não conectado"}</span></div><small>${esc(!h.integrado ? h.descricao : h.inventario.estado === "pronto" ? h.descricao : h.inventario.motivo)}</small></li>`).join("")}</ul>
      </details>
    </details>
  </section>`;
}
