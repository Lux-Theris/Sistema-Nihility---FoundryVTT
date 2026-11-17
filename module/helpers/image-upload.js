import { filePickerClass } from "./foundry-compat.js";
import { isImageFile } from "../skills/form-rules.js";
import { uploadPlayerImage, openPlayerGallery } from "./player-uploads.js";

/**
 * Envio de imagem pelo jogador, sem navegador de arquivos (H5 Formas, pesquisa de 16/11). O envio
 * ligado a um documento (`{uuid}`) só exige a permissão "Enviar arquivos" (`FILES_UPLOAD`); o servidor
 * grava em `worlds/<mundo>/assets/…` com nome aleatório, e sem "Usar o navegador de arquivos" o jogador
 * não vê pasta nenhuma.
 *
 * 1.94.1: o jogador envia para a PASTA DELE (`worlds/<mundo>/nihility-jogadores/<id>/`, ver
 * player-uploads.js) e escolhe de novo o que já enviou em "Minhas imagens…". O envio ligado ao
 * documento ficou para o Mestre e para quando não há Mestre para preparar a pasta.
 */
export const UPLOAD_HINT = "Peça ao Mestre a permissão 'Enviar arquivos'";

/** O usuário pode enviar arquivos? */
export function canUploadImages() {
  return Boolean(game.user?.can?.("FILES_UPLOAD"));
}

/** "Minhas imagens…" aparece para o jogador que pode enviar (o Mestre usa o navegador de arquivos). */
export function canUseGallery() {
  return canUploadImages() && !game.user?.isGM;
}

/**
 * Envia `file` e devolve o caminho gravado, ou `null` se não deu. Jogador: na pasta dele; Mestre (ou
 * jogador sem Mestre conectado na primeira vez): ligado ao documento `doc`.
 * @param {foundry.abstract.Document} doc
 * @param {File} file
 * @returns {Promise<string|null>}
 */
export async function uploadDocumentImage(doc, file) {
  if (!file || !isImageFile(file)) {
    ui.notifications?.warn("Escolha um arquivo de imagem.");
    return null;
  }
  if (!canUploadImages()) {
    ui.notifications?.warn(`${UPLOAD_HINT}.`);
    return null;
  }
  const tied = async () => {
    try {
      const response = await filePickerClass().upload(null, null, file, { uuid: doc.uuid }, { notify: false });
      return response?.path ?? null;
    } catch (err) {
      console.error(err);
      ui.notifications?.error("Não foi possível enviar a imagem.");
      return null;
    }
  };
  if (game.user.isGM) return tied();
  return uploadPlayerImage(file, tied);
}

/** HTML do botão "Enviar imagem…" + "Minhas imagens…" + input de arquivo escondido (desabilitado com a dica sem permissão). */
export function uploadButtonHtml(name = "upload") {
  const can = canUploadImages();
  const gallery = canUseGallery() ? ` <button type="button" data-gallery-button="${name}">Minhas imagens…</button>` : "";
  return `<span class="nihility-upload"><button type="button" data-upload-button="${name}" ${can ? "" : `disabled title="${UPLOAD_HINT}"`}>Enviar imagem…</button>${gallery}` +
    `<input type="file" accept="image/*" data-upload-input="${name}" hidden></span>`;
}

/** Liga o botão ao input e chama `onFile(file)` quando um arquivo é escolhido. */
export function wireUploadButton(root, name, onFile) {
  const button = root.querySelector(`[data-upload-button="${name}"]`);
  const input = root.querySelector(`[data-upload-input="${name}"]`);
  if (!button || !input) return;
  button.addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) onFile(file);
    input.value = "";
  });
}

/** Liga `[data-gallery-button=name]` à galeria "Minhas imagens"; `onPath(caminho)` na escolha. */
export function wireGalleryButton(root, name, onPath) {
  const button = root.querySelector(`[data-gallery-button="${name}"]`);
  if (!button) return;
  button.addEventListener("click", async () => {
    const path = await openPlayerGallery();
    if (path) await onPath(path);
  });
}
