import { BotEngine } from "../vendor/bloub/engine.ts";
import { STATE_BY_ID, POSES, type StateId } from "../vendor/bloub/states.ts";
import { SHAPE_BY_ID } from "../vendor/bloub/skins.ts";
import { expressaoMascote } from "./mascote-pose.ts";
import { FORMAS_BLOUB } from "./mascote-catalogo.ts";
import { svgMascote } from "./mascote-svg.ts";

let sequencia = 0;
class MascoteElemento extends HTMLElement {
  static observedAttributes = ["state", "shape", "expression", "class", "paused"];
  private engine = new BotEngine();
  private uid = `bloub-${++sequencia}`;
  private frame = 0;
  private time = 0;
  private last = 0;
  private changed = 0;
  private visible = true;
  private reduced = matchMedia("(prefers-reduced-motion: reduce)");
  private observer = new IntersectionObserver(entries => {
    this.visible = entries[0]?.isIntersecting ?? false;
    this.wake();
  });
  private get state(): StateId {
    const id = this.getAttribute("state") as StateId;
    return STATE_BY_ID.has(id) ? id : "idle";
  }
  connectedCallback(): void {
    const shape = this.getAttribute("shape") as keyof typeof FORMAS_BLOUB;
    this.engine = new BotEngine(100, "idle", SHAPE_BY_ID.get(FORMAS_BLOUB[shape] ?? "squircle")!.radii, expressaoMascote(this.getAttribute("expression")));
    this.time = 0;
    this.observer.observe(this);
    this.reduced.addEventListener("change", this.wake);
    document.addEventListener("visibilitychange", this.wake);
    this.attributeChangedCallback();
  }
  disconnectedCallback(): void {
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.reduced.removeEventListener("change", this.wake);
    document.removeEventListener("visibilitychange", this.wake);
  }
  attributeChangedCallback(): void {
    if (!this.isConnected) return;
    const shape = this.getAttribute("shape") as keyof typeof FORMAS_BLOUB;
    this.engine.setShape(SHAPE_BY_ID.get(FORMAS_BLOUB[shape] ?? "squircle")!.radii, this.time);
    this.engine.setExpression(expressaoMascote(this.getAttribute("expression")), this.time);
    this.engine.setState(this.state, this.time);
    this.changed = this.time;
    this.wake();
  }
  replay(): void {
    this.engine.reset("idle", this.time);
    this.engine.setState(this.state, this.time);
    this.changed = this.time;
    this.wake();
  }
  private wake = (): void => {
    cancelAnimationFrame(this.frame);
    this.last = 0;
    this.paint();
    if (this.visible && !document.hidden && !this.reduced.matches && !this.hasAttribute("paused")) {
      this.frame = requestAnimationFrame(this.tick);
    }
  };
  private tick = (stamp: number): void => {
    this.time += this.last ? Math.min((stamp - this.last) / 1000, .05) : 0;
    this.last = stamp;
    this.paint();
    if (this.state !== "idle" || this.time - this.changed < .8) this.frame = requestAnimationFrame(this.tick);
  };
  private paint(): void {
    const fixed = this.reduced.matches;
    const engine = fixed ? new BotEngine(100, this.state, SHAPE_BY_ID.get(FORMAS_BLOUB[this.getAttribute("shape") as keyof typeof FORMAS_BLOUB] ?? "squircle")!.radii, expressaoMascote(this.getAttribute("expression"))) : this.engine;
    const ink = getComputedStyle(this).getPropertyValue("--mascote-cor").trim() || "#a3a3a3";
    this.innerHTML = svgMascote(engine.sample(fixed ? POSES[this.state] : this.time, this.state !== "idle"), this.uid, ink);
  }
}
customElements.define("nod-mascote", MascoteElemento);

document.addEventListener("change", event => {
  const input = event.target;
  if (!(input instanceof HTMLSelectElement) || !input.matches("[data-mascote-expression]")) return;
  input.closest("fieldset")?.querySelectorAll("nod-mascote[data-gallery]").forEach(el => el.setAttribute("expression", input.value));
});
document.addEventListener("click", event => {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest<HTMLButtonElement>("[data-mascote-replay], [data-mascote-pause]");
  if (!button) return;
  const all = button.closest("fieldset")?.querySelectorAll<MascoteElemento>("nod-mascote[data-gallery]");
  if (button.hasAttribute("data-mascote-replay")) all?.forEach(el => el.replay());
  else {
    const paused = button.getAttribute("aria-pressed") !== "true";
    button.setAttribute("aria-pressed", String(paused));
    all?.forEach(el => el.toggleAttribute("paused", paused));
  }
});
