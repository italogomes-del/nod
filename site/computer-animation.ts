import { createScene } from "./scene-player.ts";
import "./computer-animation.css";

export function initComputerAnimation(): void {
  const root = document.querySelector<HTMLElement>("#computer-scene");
  if (!root) return;
  const required = <T extends HTMLElement>(selector: string): T => {
    const found = root.querySelector<T>(selector);
    if (!found) throw new Error(`Elemento da cena ausente: ${selector}`);
    return found;
  };
  const browser = required("#computer-browser");
  const files = required("#computer-files");
  const url = required("#browser-url-text");
  const tabTitle = required("#browser-tab-title");
  const action = required("#computer-action");
  const controller = required("#computer-controller");
  const status = required("#computer-status");
  const takeover = required<HTMLButtonElement>("#computer-takeover");
  const playButton = required<HTMLButtonElement>("#computer-play");
  const address = "projeto.example/briefing";
  let stage = "";
  let human = false;

  const showApp = (app: "browser" | "files"): void => {
    browser.hidden = app !== "browser";
    files.hidden = app !== "files";
    required("#desktop-window-title").textContent = app === "browser" ? "Navegador" : "Arquivos — Meu projeto";
    root.querySelectorAll<HTMLButtonElement>("[data-computer-view]").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.computerView === app));
    });
  };
  const render = (elapsed: number): void => {
    const next = elapsed < 900 ? "desktop" : elapsed < 2000 ? "opening" : elapsed < 4500 ? "typing" : elapsed < 5300 ? "loading" : elapsed < 7800 ? "reading" : elapsed < 10200 ? "scrolling" : elapsed < 11300 ? "filing" : elapsed < 12800 ? "saving" : "complete";
    if (stage !== next) {
      stage = next;
      root.dataset.computerStage = next;
      required(".desktop-window").setAttribute("aria-hidden", String(next === "desktop"));
      required(".browser-new-tab").setAttribute("aria-hidden", String(elapsed >= 5300));
      required(".browser-document").setAttribute("aria-hidden", String(elapsed < 5300));
      required(".desktop-toast").setAttribute("aria-hidden", String(next !== "complete"));
      showApp(elapsed >= 11300 ? "files" : "browser");
      tabTitle.textContent = elapsed < 4500 ? "Nova guia" : "Briefing do projeto";
      const captions: Record<string, string> = {
        desktop: "Vou abrir o briefing no meu navegador.",
        opening: "Navegador aberto. Agora, o endereço do projeto.",
        typing: "Acessando o briefing que você compartilhou…",
        loading: "Abrindo a página do projeto…",
        reading: "Encontrei o briefing. Vou ler o que precisa entrar.",
        scrolling: "Três pontos importantes. Vou organizar os próximos passos.",
        filing: "Vou guardar o resumo nos arquivos do meu computador.",
        saving: "Preparando proximos-passos.md…",
        complete: "Pronto. Três próximos passos, salvos no meu computador.",
      };
      action.textContent = captions[next]!;
      root.querySelectorAll<HTMLElement>("[data-computer-step]").forEach((step, index) => {
        step.classList.toggle("is-current", index === (elapsed < 5300 ? 0 : elapsed < 10200 ? 1 : 2));
      });
    }
    const typed = elapsed < 2000 ? "" : elapsed >= 4500 ? address : address.slice(0, Math.ceil((elapsed - 2000) / 2300 * address.length));
    if (url.textContent !== typed) url.textContent = typed;
  };

  const phases = document.createElement("div");
  phases.className = "computer-phases";
  phases.setAttribute("aria-hidden", "true");
  phases.innerHTML = '<span data-computer-step="0"><b>01</b> Abrir site</span><span data-computer-step="1"><b>02</b> Ler página</span><span data-computer-step="2"><b>03</b> Salvar resumo</span>';
  root.querySelector(".computer-task")!.after(phases);
  const scene = createScene({ root, button: playButton, duration: 15500, render, label: "do computador", loop: true });

  const setHuman = (value: boolean): void => {
    human = value;
    root.classList.toggle("human-control", human);
    takeover.setAttribute("aria-pressed", String(human));
    controller.innerHTML = `<span class="status-dot"></span> ${human ? "Você no controle" : "Nico no controle"}`;
    takeover.innerHTML = `${human ? "Devolver ao Nico" : "Assumir controle"} <svg class="icon" aria-hidden="true"><use href="#arrow" /></svg>`;
  };
  root.querySelectorAll<HTMLButtonElement>("[data-computer-view]").forEach(button => {
    button.addEventListener("click", () => {
      scene.pause();
      stage = "manual";
      root.dataset.computerStage = "manual";
      required(".desktop-window").setAttribute("aria-hidden", "false");
      required(".browser-new-tab").setAttribute("aria-hidden", "true");
      required(".browser-document").setAttribute("aria-hidden", "false");
      required(".desktop-toast").setAttribute("aria-hidden", "true");
      const app = button.dataset.computerView === "files" ? "files" : "browser";
      showApp(app);
      url.textContent = address;
      tabTitle.textContent = "Briefing do projeto";
      action.textContent = app === "files" ? "Os arquivos ficam aqui, no computador do Nico." : "Um navegador completo, dentro do computador do Nico.";
    });
  });
  takeover.addEventListener("click", () => {
    scene.pause();
    setHuman(!human);
    if (stage === "desktop") {
      stage = "manual";
      root.dataset.computerStage = "manual";
      required(".desktop-window").setAttribute("aria-hidden", "false");
      required(".browser-new-tab").setAttribute("aria-hidden", "true");
      required(".browser-document").setAttribute("aria-hidden", "false");
      url.textContent = address;
      tabTitle.textContent = "Briefing do projeto";
    }
    status.textContent = human
      ? "A cena pausou: você assumiu o computador. No nod, pode entrar nas suas contas e devolver o controle quando terminar."
      : "Controle devolvido ao Nico. Continue a animação ou explore os aplicativos.";
  });
  playButton.addEventListener("click", () => {
    if (human) {
      setHuman(false);
      status.textContent = "Controle devolvido ao Nico para continuar a demonstração.";
    }
  });
}
