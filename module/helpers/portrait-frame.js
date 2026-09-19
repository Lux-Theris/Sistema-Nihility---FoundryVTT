/**
 * Enquadramento do retrato de um Ator (zoom + posição), ajustável pelo próprio usuário — o
 * mesmo gesto do recorte de avatar do Discord: arrasta a imagem, gira a roda pra dar zoom.
 *
 * O enquadramento mora numa flag do Ator (`portraitFrame: {zoom, x, y}`), nunca na imagem: a
 * imagem original continua intacta e o token/outros lugares seguem usando `actor.img`. `x`/`y`
 * são deslocamentos em FRAÇÕES do quadro (não pixels), então o mesmo enquadramento fica idêntico
 * no retrato de 84px da ficha e na prévia grande do editor.
 */
import { SYSTEM_ID } from "../config.js";

const { DialogV2 } = foundry.applications.api;

const MAX_ZOOM = 4;

export function getPortraitFrame(doc) {
  const frame = doc?.getFlag?.(SYSTEM_ID, "portraitFrame");
  if (!frame) return null;
  return { zoom: Number(frame.zoom) || 1, x: Number(frame.x) || 0, y: Number(frame.y) || 0 };
}

/** CSS inline do <img> do retrato (vazio = enquadramento padrão, centralizado). */
export function portraitFrameStyle(frame) {
  if (!frame) return "";
  return `transform: translate(${frame.x * 100}%, ${frame.y * 100}%) scale(${frame.zoom});`;
}

/** Helper de template `{{portraitStyle actor}}` — registrado uma vez no `init`. */
export function registerPortraitHelper() {
  Handlebars.registerHelper("portraitStyle", doc => new Handlebars.SafeString(portraitFrameStyle(getPortraitFrame(doc))));
}

/** Update que descarta o enquadramento — usado quando a imagem é trocada (o antigo não serve pra nova). */
export const CLEAR_PORTRAIT_FRAME = { [`flags.${SYSTEM_ID}.-=portraitFrame`]: null };

/**
 * Ação `editPortraitFrame` das fichas de Ator (`this` = a ficha). Abre o editor com prévia.
 */
export async function editPortraitFrameAction(event) {
  event.preventDefault();
  event.stopPropagation();
  const actor = this.actor;
  const initial = getPortraitFrame(actor) ?? { zoom: 1, x: 0, y: 0 };
  const state = { ...initial };
  const stage = 260;

  const result = await DialogV2.wait({
    window: { title: "Ajustar enquadramento do retrato" },
    classes: ["nihility-portrait-editor-dialog"],
    position: { width: 340 },
    content: `
      <div class="nihility-portrait-editor">
        <div class="pe-stage" style="width:${stage}px;height:${stage}px;">
          <img class="pe-img" src="${actor.img}" draggable="false"/>
        </div>
        <label class="pe-zoom">Zoom
          <input type="range" name="zoom" min="1" max="${MAX_ZOOM}" step="0.01" value="${state.zoom}"/>
        </label>
        <p class="pe-hint">Arraste a imagem para mover · roda do mouse ou a barra para o zoom.</p>
      </div>`,
    render: (ev, dialog) => wireEditor(dialog.element, state, stage),
    buttons: [
      { action: "save", label: "Salvar", default: true, callback: () => "save" },
      { action: "reset", label: "Restaurar padrão", callback: () => "reset" },
      { action: "cancel", label: "Cancelar", callback: () => false }
    ],
    rejectClose: false
  });

  if (result === "save") await actor.setFlag(SYSTEM_ID, "portraitFrame", { zoom: state.zoom, x: state.x, y: state.y });
  else if (result === "reset") await actor.unsetFlag(SYSTEM_ID, "portraitFrame");
}

function wireEditor(root, state, stage) {
  const img = root.querySelector(".pe-img");
  const slider = root.querySelector('[name="zoom"]');
  const stageEl = root.querySelector(".pe-stage");

  /** Impede que o deslocamento deixe um vão vazio: o quanto a imagem sobra do quadro, com o zoom atual. */
  function clamp() {
    const nw = img.naturalWidth || 1;
    const nh = img.naturalHeight || 1;
    // object-fit: cover — o lado menor ocupa exatamente o quadro (1), o maior sobra.
    const base = Math.min(nw, nh);
    const limitX = Math.max(0, ((nw / base) * state.zoom - 1) / 2);
    const limitY = Math.max(0, ((nh / base) * state.zoom - 1) / 2);
    state.x = Math.min(limitX, Math.max(-limitX, state.x));
    state.y = Math.min(limitY, Math.max(-limitY, state.y));
  }

  function apply() {
    clamp();
    img.style.transform = `translate(${state.x * 100}%, ${state.y * 100}%) scale(${state.zoom})`;
    slider.value = state.zoom;
  }

  slider.addEventListener("input", () => {
    state.zoom = Number(slider.value);
    apply();
  });

  stageEl.addEventListener(
    "wheel",
    event => {
      event.preventDefault();
      event.stopPropagation();
      state.zoom = Math.min(MAX_ZOOM, Math.max(1, state.zoom - Math.sign(event.deltaY) * 0.1));
      apply();
    },
    { passive: false }
  );

  let drag = null;
  stageEl.addEventListener("pointerdown", event => {
    drag = { px: event.clientX, py: event.clientY, x: state.x, y: state.y };
    stageEl.setPointerCapture(event.pointerId);
    stageEl.classList.add("dragging");
  });
  stageEl.addEventListener("pointermove", event => {
    if (!drag) return;
    state.x = drag.x + (event.clientX - drag.px) / stage;
    state.y = drag.y + (event.clientY - drag.py) / stage;
    apply();
  });
  const endDrag = () => {
    drag = null;
    stageEl.classList.remove("dragging");
  };
  stageEl.addEventListener("pointerup", endDrag);
  stageEl.addEventListener("pointercancel", endDrag);

  apply();
  // O clamp precisa do tamanho natural — só existe depois do carregamento.
  if (!img.complete) img.addEventListener("load", apply, { once: true });
}
