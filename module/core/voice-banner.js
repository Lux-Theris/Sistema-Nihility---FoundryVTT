/**
 * Voz do Mundo na tela (backlog P2; mockup aprovado "Avisos na Tela", quadro 2): cada anúncio da
 * Voz do Mundo que chega para ESTE usuário também aparece como um cartão dourado no centro da tela.
 * O sussurro no chat continua sendo o registro.
 *
 *  - Quem vê: quem está no `whisper` do anúncio (dono do personagem e Mestres) — a mesma regra do
 *    chat, lida no `createChatMessage` de cada cliente; nenhum socket.
 *  - Um de cada vez: anúncios juntos (fusão + Skill nova) entram em fila. Some em ~6 s ou no clique.
 *  - Opção por usuário `voiceBanner` (desliga só neste navegador).
 *  - Título e texto vêm das flags do anúncio (`title`/`body`, gravadas por announceVoiceOfTheWorld);
 *    o texto vira texto puro (o corpo pode ter HTML no chat) e é posto com `textContent`.
 */
import { SYSTEM_ID, MEU_SISTEMA } from "./config.js";

const DURATION_MS = 6000;
const ACTION_DURATION_MS = 30000;
const MAX_QUEUE = 6;
const queue = [];
let showing = false;

function enabledForMe() {
  try {
    return game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.voiceBanner) !== false;
  } catch {
    return true;
  }
}

/**
 * O corpo da Voz do Mundo já é TEXTO puro (o card do chat o mostra com `{{body}}`, escapado), e o
 * cartão o põe com `textContent` — nunca vira HTML. Interpretá-lo como HTML (como era) apagava o
 * que estivesse entre `<…>`: o nome `<b>Ana</b>` virava "Ana" e `<img …>` sumia inteiro.
 */
function plainText(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function stack() {
  let el = document.getElementById("nihility-voice-banner");
  if (!el) {
    el = document.createElement("div");
    el.id = "nihility-voice-banner";
    document.body.appendChild(el);
  }
  return el;
}

function showNext() {
  const next = queue.shift();
  if (!next) {
    showing = false;
    return;
  }
  showing = true;
  const card = document.createElement("section");
  card.className = "nihility-voice-card";
  card.setAttribute("role", "status");
  card.setAttribute("aria-label", `Voz do Mundo: ${next.title}`);
  const label = card.appendChild(document.createElement("div"));
  label.className = "nvc-label";
  label.textContent = next.label || "Voz do Mundo";
  if (next.title) {
    const title = card.appendChild(document.createElement("div"));
    title.className = "nvc-title";
    title.textContent = next.title;
  }
  if (next.body) {
    const body = card.appendChild(document.createElement("div"));
    body.className = "nvc-body";
    body.textContent = next.body;
  }
  // Aviso com botões (ex.: "Kael está pronto" para o Mestre): fica mais tempo e só fecha pelo
  // botão (ou pelo ×), para um clique no texto não perder a escolha.
  const actions = Array.isArray(next.actions) ? next.actions : [];
  const duration = actions.length ? ACTION_DURATION_MS : DURATION_MS;
  if (actions.length) {
    card.classList.add("has-actions");
    const row = card.appendChild(document.createElement("div"));
    row.className = "nvc-actions";
    for (const action of actions) {
      const button = row.appendChild(document.createElement("button"));
      button.type = "button";
      button.textContent = action.label;
      if (action.primary) button.classList.add("primary");
      button.addEventListener("click", event => {
        event.stopPropagation();
        close();
        try {
          action.onClick?.();
        } catch (err) {
          console.error(err);
        }
      });
    }
    const x = card.appendChild(document.createElement("a"));
    x.className = "nvc-close";
    x.textContent = "×";
    x.title = "Fechar";
    x.addEventListener("click", event => {
      event.stopPropagation();
      close();
    });
  }
  const bar = card.appendChild(document.createElement("div"));
  bar.className = "nvc-bar";
  bar.appendChild(document.createElement("div")).style.animationDuration = `${duration}ms`;

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    card.classList.add("leaving");
    setTimeout(() => {
      card.remove();
      showNext();
    }, 250);
  };
  if (!actions.length) card.addEventListener("click", close);
  setTimeout(close, duration);
  stack().appendChild(card);
}

/**
 * Põe um anúncio na fila (também usado por outros avisos que queiram o mesmo cartão).
 * `label` troca o "Voz do Mundo" do topo; `actions` ([{label, primary, onClick}]) põe botões.
 */
export function showVoiceBanner({ title = "", body = "", label = "", actions = null } = {}) {
  if (!enabledForMe() || (!title && !body)) return;
  if (queue.length >= MAX_QUEUE) queue.shift();
  queue.push({ title: String(title), body: plainText(body), label: String(label || ""), actions });
  if (!showing) showNext();
}

function onCreateMessage(message) {
  const flags = message.flags?.[SYSTEM_ID];
  if (!flags?.voiceOfTheWorld) return;
  const whisper = message.whisper ?? [];
  if (whisper.length && !whisper.includes(game.user.id)) return;
  showVoiceBanner({ title: flags.title ?? "", body: flags.body ?? "" });
}

export function registerVoiceBanner() {
  Hooks.on("createChatMessage", onCreateMessage);
}
