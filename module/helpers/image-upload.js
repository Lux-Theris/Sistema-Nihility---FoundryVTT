import { filePickerClass } from "./foundry-compat.js";
import { isImageFile } from "../skills/form-rules.js";

/**
 * Envio de imagem pelo jogador, sem navegador de arquivos (H5 Formas, pesquisa de 16/11). O envio
 * ligado a um documento (`{uuid}`) só exige a permissão "Enviar arquivos" (`FILES_UPLOAD`); o servidor
 * grava em `worlds/<mundo>/assets/…` com nome aleatório, e sem "Usar o navegador de arquivos" o jogador
 * não vê pasta nenhuma.
 */
export const UPLOAD_HINT = "Peça ao Mestre a permissão 'Enviar arquivos'";

/** O usuário pode enviar arquivos? */
export function canUploadImages() {
  return Boolean(game.user?.can?.("FILES_UPLOAD"));
}

/**
 * Envia `file` ligado ao documento `doc` e devolve o caminho gravado, ou `null` se não deu.
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
  try {
    const response = await filePickerClass().upload(null, null, file, { uuid: doc.uuid }, { notify: false });
    return response?.path ?? null;
  } catch (err) {
    console.error(err);
    ui.notifications?.error("Não foi possível enviar a imagem.");
    return null;
  }
}

/** HTML do botão "Enviar imagem…" + input de arquivo escondido (desabilitado com a dica sem permissão). */
export function uploadButtonHtml(name = "upload") {
  const can = canUploadImages();
  return `<span class="nihility-upload"><button type="button" data-upload-button="${name}" ${can ? "" : `disabled title="${UPLOAD_HINT}"`}>Enviar imagem…</button>` +
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
