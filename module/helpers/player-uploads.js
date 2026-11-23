/**
 * Pasta de imagens de cada jogador e a galeria "Minhas imagens" (1.94.1). Regras puras em
 * player-uploads-rules.js.
 *
 *  - Cada jogador envia para `worlds/<mundo>/nihility-jogadores/<id do usuário>/`. O servidor deixa
 *    quem tem "Enviar arquivos" enviar para uma pasta que já existe, mas criar a pasta e listar o que
 *    há dentro exigem "Usar o navegador de arquivos" (que abriria a Data inteira). O Mestre designado
 *    cria e lista por ele (relay `ensureUploadFolder`/`listUploadFolder`; a pasta sai do usuário que
 *    o servidor diz que pediu, nunca do payload).
 *  - Precisa do Mestre conectado só na primeira vez (criar a pasta; depois o flag `uploadFolder` do
 *    usuário lembra) e para mostrar a galeria. Sem Mestre e sem pasta, o envio cai no envio ligado ao
 *    documento (pasta comum do mundo), avisando.
 *  - Apagar não existe no Foundry. Sobrescrever imagem com outra de mesmo nome é permitido, então
 *    "Apagar" grava um pixel em branco do mesmo formato por cima e esconde o caminho (flag
 *    `removedUploads`). Antes, avisa quem ainda usa a imagem.
 *  - Não é segredo: o Foundry serve Data abertamente, quem souber o endereço abre a imagem. O que a
 *    pasta garante é que um jogador não navega pelas imagens do Mestre nem dos outros.
 */
import { SYSTEM_ID } from "../core/config.js";
import { filePickerClass } from "./foundry-compat.js";
import { escapeHtml } from "./html.js";
import { runAsGm } from "./gm-relay.js";
import { RELAY_REASONS, refuse } from "./gm-relay-rules.js";
import {
  playerFolder, folderChain, uploadFileName, galleryEntries, blankMimeFor, imageUsage, addRemoved, pathInFolder
} from "./player-uploads-rules.js";

const FOLDER_FLAG = "uploadFolder";
const REMOVED_FLAG = "removedUploads";

/** A pasta do usuário atual neste mundo. */
export function myFolder() {
  return playerFolder(game.world.id, game.user.id);
}

/* ------------------------------------------------------------- Lado do Mestre */

/** Cria a pasta se não existir (listar primeiro: criar uma que já existe dá erro). */
async function ensureDir(path) {
  const FP = filePickerClass();
  try {
    await FP.browse("data", path);
    return;
  } catch { /* não existe: cria */ }
  try {
    await FP.createDirectory("data", path);
  } catch (err) {
    if (!/exist/i.test(String(err?.message ?? err))) throw err;
  }
}

/** Relay: garante a pasta de `user`. */
export async function ensurePlayerFolderAsGm(user) {
  for (const dir of folderChain(game.world.id, user.id)) await ensureDir(dir);
  return { ok: true, value: playerFolder(game.world.id, user.id) };
}

/** Relay: os arquivos da pasta de `user` (nenhum, se a pasta ainda não existe). */
export async function listPlayerFolderAsGm(user) {
  const folder = playerFolder(game.world.id, user.id);
  try {
    const result = await filePickerClass().browse("data", folder);
    return { ok: true, value: (result?.files ?? []).filter(p => pathInFolder(p, folder)) };
  } catch {
    return { ok: true, value: [] };
  }
}

/* ------------------------------------------------------------ Lado do jogador */

let sessionReady = false;

/** Pede ao Mestre a pasta. true = pronta. */
async function requestFolder() {
  const outcome = await runAsGm("ensureUploadFolder", {}, { reply: true, timeout: 8000 });
  if (!outcome?.ok) return false;
  sessionReady = true;
  try { await game.user.setFlag(SYSTEM_ID, FOLDER_FLAG, myFolder()); } catch { /* só memória */ }
  return true;
}

/** Envia para a pasta do jogador. Devolve o caminho ou null. */
async function sendToFolder(file) {
  const name = uploadFileName(file.name, foundry.utils.randomID());
  const renamed = new File([file], name, { type: file.type });
  const response = await filePickerClass().upload("data", myFolder(), renamed, {}, { notify: false });
  return response?.path ?? null;
}

/**
 * Envio de imagem de um jogador: vai para a pasta dele. Sem Mestre para preparar a pasta (primeira
 * vez), usa `fallback()` (o envio ligado ao documento) e avisa.
 * @param {File} file
 * @param {() => Promise<string|null>} [fallback]
 */
export async function uploadPlayerImage(file, fallback) {
  let ready = sessionReady || game.user.getFlag(SYSTEM_ID, FOLDER_FLAG) === myFolder();
  if (!ready) ready = await requestFolder();
  if (ready) {
    try {
      const path = await sendToFolder(file);
      if (path) return path;
    } catch (err) {
      console.warn(`${SYSTEM_ID} | Envio para a pasta do jogador falhou.`, err);
    }
    // A pasta pode ter sido apagada à mão: pede de novo, uma vez.
    sessionReady = false;
    try { await game.user.unsetFlag(SYSTEM_ID, FOLDER_FLAG); } catch { /* nada */ }
    if (await requestFolder()) {
      const path = await sendToFolder(file).catch(() => null);
      if (path) return path;
    }
  }
  if (!fallback) {
    ui.notifications.warn("Nenhum Mestre conectado para preparar a sua pasta de imagens. Tente com o Mestre na mesa.");
    return null;
  }
  ui.notifications.info("Sem Mestre conectado para preparar a sua pasta: a imagem foi para a pasta comum do mundo e não aparece em \"Minhas imagens\".");
  return fallback();
}

/** Quem usa a imagem (fichas, Tokens, Itens, avatares que este cliente enxerga). */
function usageDocs() {
  const docs = [];
  for (const actor of game.actors ?? []) {
    docs.push({ name: actor.name, imgs: [actor.img, actor.prototypeToken?.texture?.src] });
    for (const item of actor.items ?? []) docs.push({ name: `${item.name} (${actor.name})`, imgs: [item.img] });
  }
  for (const scene of game.scenes ?? []) {
    for (const token of scene.tokens ?? []) docs.push({ name: `Token ${token.name} (${scene.name})`, imgs: [token.texture?.src] });
  }
  for (const user of game.users ?? []) docs.push({ name: `Avatar de ${user.name}`, imgs: [user.avatar] });
  return docs;
}

/** Um pixel em branco do formato de `path`, com o mesmo nome. */
async function blankFile(path) {
  const mime = blankMimeFor(path);
  if (!mime) return null;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const blob = await new Promise(resolve => canvas.toBlob(resolve, mime));
  if (!blob) return null;
  return new File([blob], path.split("/").pop(), { type: mime });
}

/** "Apagar": sobrescreve com o pixel em branco e esconde da galeria. true = feito. */
async function removeUpload(path) {
  if (!pathInFolder(path, myFolder())) return false;
  const used = imageUsage(path, usageDocs());
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: "Apagar imagem" },
    content: `<div class="nihility-gallery-confirm"><p>Apagar esta imagem? O Foundry não apaga arquivos: ela é trocada por uma imagem vazia e some da sua galeria. Não dá para desfazer.</p>` +
      (used.length ? `<p><strong>Ainda usada por:</strong> ${used.slice(0, 8).map(escapeHtml).join(", ")}${used.length > 8 ? ` e mais ${used.length - 8}` : ""}. Lá ela vai ficar vazia.</p>` : "") + `</div>`
  });
  if (!ok) return false;
  const blank = await blankFile(path);
  if (!blank) {
    ui.notifications.warn("Não deu para gerar a imagem vazia neste formato; ela só sai da galeria.");
  } else {
    const response = await filePickerClass().upload("data", myFolder(), blank, {}, { notify: false });
    if (!response?.path) return false;
  }
  const removed = addRemoved(game.user.getFlag(SYSTEM_ID, REMOVED_FLAG) ?? [], path);
  await game.user.setFlag(SYSTEM_ID, REMOVED_FLAG, removed);
  return true;
}

function tileHtml(entry, checked = false) {
  const path = escapeHtml(entry.path);
  return `<label class="ng-tile" title="${escapeHtml(entry.name)}">` +
    `<input type="radio" name="ngPick" value="${path}" ${checked ? "checked" : ""}>` +
    `<img src="${escapeHtml(encodeURI(entry.path))}" alt="" loading="lazy">` +
    `<span class="ng-name">${escapeHtml(entry.name)}</span>` +
    `<button type="button" class="ng-del" data-path="${path}" title="${entry.canDelete ? "Apagar" : "Tirar da galeria"}"><i class="fa-solid fa-trash"></i></button>` +
    `</label>`;
}

/**
 * Abre "Minhas imagens" e devolve o caminho escolhido (ou null). Dá para enviar uma nova e apagar.
 * A galeria só abre com o Mestre conectado (é ele quem lista), então a pasta pode ser preparada aqui.
 */
export async function openPlayerGallery() {
  if (!game.user.can("FILES_UPLOAD")) {
    ui.notifications.warn("Peça ao Mestre a permissão 'Enviar arquivos'.");
    return null;
  }
  const outcome = await runAsGm("listUploadFolder", {}, { reply: true, timeout: 8000 });
  if (!outcome?.ok) {
    ui.notifications.warn(outcome?.reason === RELAY_REASONS.noGm
      ? "O Mestre precisa estar conectado para mostrar as suas imagens."
      : "O Mestre não respondeu: não deu para mostrar as suas imagens.");
    return null;
  }
  const folder = myFolder();
  const entries = galleryEntries(outcome.value ?? [], game.user.getFlag(SYSTEM_ID, REMOVED_FLAG) ?? [], folder);
  const content = `<div class="nihility-gallery">` +
    `<p class="ng-hint">Só você e o Mestre veem esta pasta.</p>` +
    `<div class="ng-grid">${entries.map(e => tileHtml(e)).join("")}</div>` +
    `<p class="ng-empty" ${entries.length ? "hidden" : ""}>Nenhuma imagem ainda. Envie uma.</p>` +
    `<div class="ng-actions"><button type="button" data-ng-upload><i class="fa-solid fa-upload"></i> Enviar nova…</button>` +
    `<input type="file" accept="image/*" data-ng-input hidden></div>` +
    `</div>`;

  const render = (event, dialog) => {
    const root = dialog.element;
    const grid = root.querySelector(".ng-grid");
    const empty = root.querySelector(".ng-empty");
    const input = root.querySelector("[data-ng-input]");
    const wireTile = tile => {
      tile.querySelector(".ng-del")?.addEventListener("click", async ev => {
        ev.preventDefault();
        ev.stopPropagation();
        if (await removeUpload(ev.currentTarget.dataset.path)) {
          tile.remove();
          if (empty) empty.hidden = Boolean(grid.querySelector(".ng-tile"));
        }
      });
      tile.addEventListener("dblclick", () => root.querySelector('[data-action="use"]')?.click());
    };
    grid.querySelectorAll(".ng-tile").forEach(wireTile);
    root.querySelector("[data-ng-upload]")?.addEventListener("click", () => input.click());
    input?.addEventListener("change", async () => {
      const file = input.files?.[0];
      input.value = "";
      if (!file) return;
      if (!String(file.type).startsWith("image/")) return ui.notifications.warn("Escolha um arquivo de imagem.");
      const path = await uploadPlayerImage(file);
      if (!path) return;
      grid.insertAdjacentHTML("afterbegin", tileHtml({ path, name: file.name.replace(/\.[^.]*$/, ""), canDelete: Boolean(blankMimeFor(path)) }, true));
      wireTile(grid.firstElementChild);
      if (empty) empty.hidden = true;
    });
  };

  return foundry.applications.api.DialogV2.wait({
    window: { title: "Minhas imagens", icon: "fa-solid fa-images" },
    position: { width: 560 },
    content,
    render,
    rejectClose: false,
    buttons: [
      { action: "use", label: "Usar esta", icon: "fa-solid fa-check", default: true, callback: (ev, button, dialog) => dialog.element.querySelector('input[name="ngPick"]:checked')?.value ?? null },
      { action: "cancel", label: "Cancelar", callback: () => null }
    ]
  });
}


// ---------------------------------------------------------------------------
// Ações do relay do Mestre (ver helpers/gm-relay.js). Juntadas em core/relay-actions.js.
// Todas recebem `(payload, user)`; `user` é dito pelo servidor, nunca pelo payload.
// ---------------------------------------------------------------------------
export const RELAY_HANDLERS = {
  /**
   * Pasta de imagens do jogador (1.94.1): criar pasta e listar exigem "Usar o navegador de arquivos",
   * que o jogador não tem; o Mestre faz por ele. A pasta vem de `user` (dito pelo servidor), nunca do
   * payload — ninguém pede a pasta de outro. Só para quem tem "Enviar arquivos".
   */
  async ensureUploadFolder(payload, user) {
    if (!user?.can?.("FILES_UPLOAD")) return refuse(RELAY_REASONS.permission);
    return ensurePlayerFolderAsGm(user);
  },

  async listUploadFolder(payload, user) {
    if (!user?.can?.("FILES_UPLOAD")) return refuse(RELAY_REASONS.permission);
    return listPlayerFolderAsGm(user);
  }
};
