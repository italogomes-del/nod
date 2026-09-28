import { createScene } from "./scene-player.ts";
import "./collaboration-animation.css";

const DURATION = 14_000;
const STAGES = [650, 2_300, 4_300, 7_100, 10_000, 12_000, DURATION] as const;
const STATUS = [
  "Uma ideia começa com você.",
  "Você faz o pedido.",
  "Vera consulta o Lume.",
  "Lume está pensando…",
  "Uma ideia chega à Vera.",
  "Vera prepara a abertura.",
  "O texto está pronto para você.",
  "O texto está pronto para você.",
] as const;

function reveal(node: HTMLElement, visible: boolean): void {
  node.classList.toggle("collab-is-visible", visible);
  node.inert = !visible;
}

export function initCollaborationAnimation(): void {
  const root = document.querySelector<HTMLElement>(".collaboration-demo");
  if (!root || root.dataset.collaborationAnimation === "ready") return;
  const request = root.querySelector<HTMLElement>(".collaboration-request");
  const result = root.querySelector<HTMLButtonElement>("#collaboration-result");
  const [question, reply, delivery] = root.querySelectorAll<HTMLLIElement>(".bot-exchange li");
  const replyBubble = reply?.querySelector<HTMLElement>(":scope > div");
  const replyText = replyBubble?.querySelector<HTMLParagraphElement>("p");
  if (!request || !result || !question || !reply || !delivery || !replyBubble || !replyText) return;

  root.dataset.collaborationAnimation = "ready";
  root.classList.add("collab-scene-enabled");
  [request, question, reply, delivery, result].forEach(node => node.classList.add("collab-frame"));
  replyBubble.classList.add("collab-reply-bubble");
  replyText.classList.add("collab-reply-text");

  const typing = document.createElement("div");
  typing.className = "collaboration-typing";
  typing.setAttribute("aria-hidden", "true");
  typing.innerHTML = '<span class="collaboration-typing-dots"><i></i><i></i><i></i></span><span>pensando na ideia</span>';
  replyBubble.append(typing);

  const controls = document.createElement("div");
  controls.className = "collaboration-controls";
  const status = document.createElement("p");
  status.className = "collaboration-scene-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "scene-control";
  button.innerHTML = '<span class="collaboration-control-icon" aria-hidden="true"><svg class="collaboration-icon-pause" viewBox="0 0 16 16"><path d="M5.5 4v8m5-8v8" /></svg><svg class="collaboration-icon-play" viewBox="0 0 16 16"><path d="m5 3 7 5-7 5Z" /></svg><svg class="collaboration-icon-replay" viewBox="0 0 16 16"><path d="M3.5 6A5 5 0 1 1 3 9M3.5 2.5V6H7" /></svg></span><span class="scene-control-label">Reproduzir</span>';
  controls.append(status, button);
  root.append(controls);

  let currentStage = -1;
  const render = (elapsed: number): void => {
    const stage = STAGES.filter(start => elapsed >= start).length;
    if (stage === currentStage) return;
    currentStage = stage;
    root.dataset.collaborationStage = String(stage);

    reveal(request, stage >= 1);
    reveal(question, stage >= 2);
    reveal(reply, stage >= 3);
    reveal(delivery, stage >= 5);
    reveal(result, stage >= 6);
    result.disabled = stage < 6;

    const thinking = stage === 3;
    reply.classList.toggle("collab-is-thinking", thinking);
    replyText.classList.toggle("collab-reply-ready", stage >= 4);
    replyText.inert = stage < 4;
    question.classList.toggle("collab-is-current", stage === 2);
    reply.classList.toggle("collab-is-current", stage === 3 || stage === 4);
    delivery.classList.toggle("collab-is-current", stage === 5);
    question.classList.toggle("collab-is-connecting", stage === 2);
    reply.classList.toggle("collab-is-connecting", stage === 4);
    result.classList.toggle("collab-result-ready", stage === 6);
    const text = STATUS[stage] ?? "O texto está pronto para você.";
    if (status.textContent !== text) status.textContent = text;
  };

  render(0);
  createScene({ root, button, duration: DURATION, render, label: "dos bots" });
}
