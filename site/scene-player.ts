import "./scene-player.css";

interface SceneOptions {
  root: HTMLElement;
  button: HTMLButtonElement;
  duration: number;
  render: (elapsed: number) => void;
  label: string;
  loop?: boolean;
}

export function createScene({ root, button, duration, render, label, loop = false }: SceneOptions) {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let elapsed = 0;
  let frame = 0;
  let previous = 0;
  let visible = false;
  let started = false;
  let running = false;
  let userPaused = false;
  const frozenTransitions = new Set<Animation>();

  const releaseTransitions = (continuePlaying: boolean): void => {
    for (const animation of frozenTransitions) {
      if (animation.playState === "paused") {
        if (continuePlaying) animation.play(); else animation.cancel();
      }
    }
    frozenTransitions.clear();
  };

  const updateControl = (): void => {
    const complete = elapsed >= duration;
    root.dataset.sceneState = complete ? "finished" : running ? "playing" : started ? "paused" : "idle";
    const verb = complete ? "Repetir" : running ? "Pausar" : started ? "Continuar" : "Reproduzir";
    const text = button.querySelector(".scene-control-label") ?? button;
    text.textContent = verb;
    button.setAttribute("aria-label", `${verb} animação ${label}`);
    button.disabled = reduced.matches;
    if (reduced.matches) {
      text.textContent = "Cena completa";
      button.setAttribute("aria-label", "Cena completa, conforme sua preferência por movimento reduzido");
    }
  };

  const halt = (): void => {
    cancelAnimationFrame(frame);
    running = false;
    for (const animation of root.getAnimations({ subtree: true })) {
      if ("transitionProperty" in animation && animation.playState === "running") {
        animation.pause();
        frozenTransitions.add(animation);
      }
    }
    updateControl();
  };

  const tick = (now: number): void => {
    elapsed = Math.min(duration, elapsed + now - previous);
    previous = now;
    render(elapsed);
    root.style.setProperty("--scene-progress", String(elapsed / duration));
    if (elapsed >= duration && loop) {
      elapsed = 0;
      render(0);
      root.style.setProperty("--scene-progress", "0");
      frame = requestAnimationFrame(tick);
    } else if (elapsed >= duration) halt();
    else frame = requestAnimationFrame(tick);
  };

  const resume = (): void => {
    if (running || userPaused || !visible || document.hidden || reduced.matches || elapsed >= duration) return;
    started = true;
    running = true;
    previous = performance.now();
    updateControl();
    releaseTransitions(true);
    frame = requestAnimationFrame(tick);
  };

  const pause = (): void => { userPaused = true; halt(); };
  const restart = (): void => {
    halt();
    releaseTransitions(false);
    elapsed = 0;
    started = true;
    userPaused = false;
    render(0);
    root.style.setProperty("--scene-progress", "0");
    resume();
  };
  const play = (): void => {
    if (elapsed >= duration) restart();
    else { userPaused = false; resume(); }
  };
  const finish = (): void => {
    halt();
    elapsed = duration;
    started = true;
    render(duration);
    releaseTransitions(false);
    root.style.setProperty("--scene-progress", "1");
    updateControl();
  };

  button.addEventListener("click", () => { if (running) pause(); else play(); });
  const observer = new IntersectionObserver(entries => {
    const entry = entries[0];
    visible = !!entry?.isIntersecting && entry.intersectionRatio >= .25;
    if (visible) resume(); else halt();
  }, { threshold: .25 });
  observer.observe(root);
  document.addEventListener("visibilitychange", () => { if (document.hidden) halt(); else resume(); });
  reduced.addEventListener("change", () => { if (reduced.matches) finish(); else updateControl(); });
  if (reduced.matches) finish();
  else { render(0); updateControl(); }
  return { pause, play, restart, finish };
}
