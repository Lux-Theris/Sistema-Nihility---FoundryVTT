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

/** HTML do corpo → texto puro (nunca injetado como HTML no cartão). */
function plainText(html) {
  const div = document.createElement("div");
  div.innerHTML = String(html ?? "");
  return (div.textContent ?? "").replace(/\s+/g, " ").trim();
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
  label.textContent = "Voz do Mundo";
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
  const bar = card.appendChild(document.createElement("div"));
  bar.className = "nvc-bar";
  bar.appendChild(document.createElement("div")).style.animationDuration = `${DURATION_MS}ms`;

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
  card.addEventListener("click", close);
  setTimeout(close, DURATION_MS);
  stack().appendChild(card);
}

/** Põe um anúncio na fila (também usado por outros avisos que queiram o mesmo cartão). */
export function showVoiceBanner({ title = "", body = "" } = {}) {
  if (!enabledForMe() || (!title && !body)) return;
  if (queue.length >= MAX_QUEUE) queue.shift();
  queue.push({ title: String(title), body: plainText(body) });
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
