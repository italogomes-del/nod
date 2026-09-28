import { examples } from "./examples.ts";
import { initCollaborationAnimation } from "./collaboration-animation.ts";
import { initComputerAnimation } from "./computer-animation.ts";

function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Elemento do site ausente: ${selector}`);
  return found;
}

const conversation = element("#conversation");
const replay = element<HTMLButtonElement>("#replay");
const dialog = element<HTMLDialogElement>("#preview-dialog");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
let selected = "vera";
let timer: ReturnType<typeof setTimeout> | undefined;
let playing = false;

function stopPlayback(): void {
  clearTimeout(timer);
  playing = false;
  conversation.classList.remove("is-replaying");
  replay.querySelector("span")!.textContent = "Reproduzir exemplo";
  replay.setAttribute("aria-label", "Reproduzir exemplo de conversa");
}

function selectBot(id: string): void {
  const example = examples[id];
  if (!example) return;
  stopPlayback();
  selected = id;
  element<HTMLImageElement>("#chat-avatar").src = `/mascots/${id}.svg`;
  element("#chat-name").textContent = example.name;
  element("#chat-specialty").textContent = example.specialty;
  document.querySelectorAll<HTMLButtonElement>("[data-bot]").forEach(button => {
    const active = button.dataset.bot === id;
    button.classList.toggle("is-selected", active);
    button.setAttribute("aria-pressed", String(active));
  });
  const position = Object.keys(examples).indexOf(id);
  document.querySelectorAll(".demo-pagination i").forEach((dot, index) => dot.classList.toggle("active", index === position));
  conversation.innerHTML = `
    <div class="chat-day">${example.scene}</div>
    <div class="message message-user" data-phase="0"><span class="message-author">Você</span><p>${example.request}</p></div>
    <div class="message message-bot" data-phase="1"><span class="message-author">${example.name}</span><p>${example.answer}</p></div>
    <div class="work-step" data-phase="2"><svg class="icon" aria-hidden="true"><use href="#check" /></svg>${example.work}</div>
    <button class="delivery" id="delivery" type="button" data-phase="3" aria-label="Abrir exemplo: ${example.title}"><span class="delivery-icon"><svg class="icon" aria-hidden="true"><use href="#${id === "bia" ? "clock" : "file"}" /></svg></span><span><strong>${example.title}</strong><small>${example.subtitle}</small></span><svg class="icon" aria-hidden="true"><use href="#diagonal" /></svg></button>
    <p class="chat-end" data-phase="4">“${example.closing}”</p>`;
}

document.querySelectorAll<HTMLButtonElement>("[data-bot]").forEach(button => {
  button.addEventListener("click", () => selectBot(button.dataset.bot ?? "vera"));
});
document.querySelectorAll<HTMLButtonElement>("[data-example]").forEach(button => {
  button.addEventListener("click", () => {
    selectBot(button.dataset.example ?? "vera");
    element("#demonstracao").scrollIntoView({ behavior: reduceMotion.matches ? "instant" : "smooth" });
    element<HTMLButtonElement>(`[data-bot="${selected}"]`).focus({ preventScroll: true });
  });
});

replay.addEventListener("click", () => {
  if (playing) { stopPlayback(); return; }
  if (reduceMotion.matches) {
    selectBot(selected);
    replay.querySelector("span")!.textContent = "Exemplo completo";
    return;
  }
  selectBot(selected);
  playing = true;
  conversation.classList.add("is-replaying");
  replay.querySelector("span")!.textContent = "Mostrar tudo";
  replay.setAttribute("aria-label", "Mostrar a conversa completa agora");
  const phases = conversation.querySelectorAll<HTMLElement>("[data-phase]");
  let phase = 0;
  const advance = (): void => {
    phases[phase]?.classList.add("shown");
    phase++;
    if (phase < phases.length) timer = setTimeout(advance, phase === 1 ? 1100 : 750);
    else stopPlayback();
  };
  advance();
});

function openDocument(title: string, html: string, label = "EXEMPLO ILUSTRATIVO"): void {
  stopPlayback();
  element("#dialog-title").textContent = title;
  element("#dialog-label").textContent = label;
  element("#dialog-body").innerHTML = html;
  dialog.showModal();
}

conversation.addEventListener("click", event => {
  if (!(event.target instanceof Element) || !event.target.closest(".delivery")) return;
  const example = examples[selected]!;
  openDocument(example.title, `${example.document}<p class="document-note">Esta é uma conversa ilustrativa. Nenhuma tarefa ou rotina foi executada.</p>`);
});
element("#about-preview").addEventListener("click", () => {
  openDocument("Uma primeira apresentação.", '<p>Esta página apresenta a ideia do nod. Os bots e as conversas são exemplos ilustrativos, não uma conexão com o aplicativo.</p><p>O produto está em desenvolvimento. Acesso público, licença e modelo de negócio ainda estão sendo definidos.</p><p>Os mascotes temporários usam o motor Bloub, de Jérémy Perret, sob <a href="/mascots/LICENSE.txt" target="_blank" rel="noopener">licença MIT</a>.</p>', "SOBRE ESTA PRÉVIA");
});
element("#collaboration-result").addEventListener("click", () => {
  openDocument("Um começo escrito a quatro mãos.", '<p>Tem uma ideia que sempre fica para depois?</p><p>Um texto que não sai, um projeto que pede um primeiro passo, uma rotina que você queria tirar da cabeça.</p><p>Estamos criando o nod para ajudar com isso: bots com jeitos diferentes de pensar e trabalhar, que conversam com você e também entre si.</p><p>Você traz a ideia. A gente começa a conversa.</p><p class="document-note">Exemplo ilustrativo: Lume sugeriu o caminho e Vera escreveu a abertura. Nenhum bot foi executado nesta página.</p>');
});

initCollaborationAnimation();
initComputerAnimation();

dialog.querySelectorAll(".dialog-close, .dialog-dismiss").forEach(button => button.addEventListener("click", () => dialog.close()));
dialog.addEventListener("click", event => {
  if (event.target !== dialog) return;
  const bounds = dialog.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
});
document.addEventListener("visibilitychange", () => { if (document.hidden) stopPlayback(); });
reduceMotion.addEventListener("change", () => { if (reduceMotion.matches) stopPlayback(); });

const interestForm = document.querySelector<HTMLFormElement>("#interest-form");

document.querySelectorAll<HTMLInputElement>('input[name="demo-model"]').forEach(input => {
  input.addEventListener("change", () => {
    const provider = input.value === "chatgpt" ? "ChatGPT, pelo Codex" : "Claude";
    element("#model-selection").textContent = `Neste exemplo, a Vera usa ${provider}. O perfil e a memória continuam os mesmos.`;
  });
});

const configuredEndpoint = import.meta.env.VITE_NOD_WAITLIST_URL as string | undefined;
if (interestForm) {
  const email = element<HTMLInputElement>("#interest-email");
  const submit = element<HTMLButtonElement>("#interest-submit");
  const status = element("#interest-status");
  let endpoint: URL | undefined;
  try {
    if (configuredEndpoint) {
      const parsed = new URL(configuredEndpoint, window.location.origin);
      if (parsed.protocol === "https:" || parsed.origin === window.location.origin) endpoint = parsed;
    }
  } catch { endpoint = undefined; }

  if (endpoint) {
    email.disabled = false;
    submit.disabled = false;
    status.textContent = "Só novidades do nod e um aviso quando você puder experimentar. Cancele quando quiser.";
  }
  interestForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (!endpoint || submit.disabled || !interestForm.reportValidity()) return;
    submit.disabled = true;
    email.readOnly = true;
    submit.textContent = "Enviando…";
    status.classList.remove("is-error", "is-success");
    status.textContent = "Enviando sua inscrição…";
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email: email.value.trim(), source: "nod-site", consent: "Novidades do nod e aviso de acesso" }),
        signal: AbortSignal.timeout(15000),
        credentials: "omit",
      });
      if (!response.ok) throw new Error("inscricao_recusada");
      status.textContent = "Inscrição recebida. Se chegar um e-mail de confirmação, confirme para entrar na lista.";
      status.classList.add("is-success");
      interestForm.reset();
    } catch {
      status.textContent = "Não conseguimos confirmar sua inscrição. Tente de novo em instantes.";
      status.classList.add("is-error");
    } finally {
      submit.disabled = false;
      email.readOnly = false;
      submit.textContent = "Quero acompanhar ↗";
    }
  });
}
