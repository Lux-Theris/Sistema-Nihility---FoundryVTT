/**
 * Configuração de cenas por pasta (H20): o que acontece quando a herança muda, o menu da pasta e a
 * cópia "do Foundry, uma vez". A leitura é de scene-config.js; as regras puras, de
 * scene-config-rules.js e scene-copy-rules.js.
 *
 * Quando uma cena troca de pasta, ou uma pasta muda um valor, o que depende da cena é refeito:
 * escuridão por relógio, tempo pessoal (linha/rede), perigos, radiação e o visual do FXMaster.
 * Só o Mestre designado escreve (os hooks rodam em todo cliente).
 */
import { SYSTEM_ID, isSceneFoldersEnabled, isCalendarEnabled, isWorldClockEnabled } from "../core/config.js";
import { isDesignatedGm } from "../helpers/gm-relay.js";
import { foundryGeneration } from "../helpers/foundry-compat.js";
import { reportError } from "../helpers/report.js";
import { escapeHtml } from "../helpers/html.js";
import { sceneEnvironment, syncSceneEnvironment, syncSceneFx } from "./environment.js";
import { applySceneDarkness } from "../core/world-clock.js";
import { settleDevices, actorsInScene, syncAllPersonalTimes } from "../core/world-time.js";
import { scenesUnderFolder, sceneConfigChanged } from "./scene-config.js";
import { planCopy, copyConfirmLines } from "./scene-copy-rules.js";
import { SCENE_CFG_FLAG } from "./scene-config-rules.js";

const calendarOn = () => isWorldClockEnabled() && isCalendarEnabled();

/** Fila do visual por cena: duas sincronizações ao mesmo tempo tocariam o clima duas vezes. */
const fxQueue = new Map();

/** Liga/desliga o visual do FXMaster conforme os perigos que a cena herda; guarda o que ficou tocando. */
export function syncSceneFxFromConfig(scene) {
  if (!isDesignatedGm() || !scene) return Promise.resolve();
  const next = (fxQueue.get(scene.id) ?? Promise.resolve()).then(async () => {
    const env = sceneEnvironment(scene);
    const playing = await syncSceneFx(scene, env.hazards, env.fxPlaying);
    if (JSON.stringify(playing) !== JSON.stringify(env.fxPlaying)) {
      await scene.update({ [`flags.${SYSTEM_ID}.environment.fxPlaying`]: playing });
    }
  }).catch(err => reportError(`Ambiente: falha no visual de "${scene.name}".`, err, { gmOnly: true }));
  fxQueue.set(scene.id, next);
  next.finally(() => { if (fxQueue.get(scene.id) === next) fxQueue.delete(scene.id); });
  return next;
}

/** Refaz o que depende da cena para estas cenas (a herança delas mudou). */
export async function reapplyScenes(scenes) {
  if (!isDesignatedGm()) return;
  for (const scene of scenes) {
    await syncSceneFxFromConfig(scene);
    await syncSceneEnvironment(scene);
  }
  await applySceneDarkness();
  if (calendarOn()) await syncAllPersonalTimes();
}

/** A Pasta é de Cenas? */
const isSceneFolder = folder => folder?.documentName === "Folder" && folder.type === "Scene";

/** Antes de uma pasta mudar o tempo (ou de lugar), guarda a data dos aparelhos de quem está nas cenas dela. */
export async function settleFolderScenes(folder) {
  if (!calendarOn()) return;
  const seen = new Map();
  for (const scene of scenesUnderFolder(folder)) {
    for (const actor of actorsInScene(scene)) seen.set(actor.uuid, { actor, scene });
  }
  for (const { actor, scene } of seen.values()) await settleDevices([actor], scene);
}

/* ------------------------------------------------------------------ Menu da pasta */

function folderOfEntry(target) {
  const el = target instanceof HTMLElement ? target : target?.[0];
  const li = el?.closest?.("[data-uuid], [data-folder-id]") ?? el;
  const uuid = li?.dataset?.uuid;
  const byUuid = uuid ? fromUuidSync(uuid) : null;
  return byUuid?.documentName === "Folder" ? byUuid : game.folders.get(li?.dataset?.folderId ?? "") ?? null;
}

/**
 * Clique direito numa pasta de Cenas -> "Ambiente da pasta (Nihility)…". Chaves da V14 (label/visible/
 * onClick) e da V13 (name/condition/callback) juntas, como no menu da cena.
 */
function registerFolderMenu() {
  Hooks.on("getFolderContextOptions", (app, options) => {
    const allowed = target => {
      if (!game.user.isGM || !isSceneFoldersEnabled()) return false;
      return isSceneFolder(folderOfEntry(target));
    };
    const open = target => {
      const folder = folderOfEntry(target);
      if (!folder) return;
      import("../apps/environment-config.js").then(m => m.EnvironmentConfigApp.openFolder(folder));
    };
    options.push({
      label: "Ambiente da pasta (Nihility)…",
      name: "Ambiente da pasta (Nihility)…",
      icon: '<i class="fa-solid fa-smog"></i>',
      visible: allowed,
      condition: allowed,
      onClick: (event, target) => open(target),
      callback: target => open(target)
    });
  });
}

/* ------------------------------------------------------------------ Cópia do Foundry */

/**
 * Copia uma vez os campos marcados para todas as cenas da pasta e subpastas, depois de confirmar.
 * @param {Folder} folder
 * @param {Record<string, any>} picked `{chave: valor}` só dos campos marcados
 * @returns {Promise<number>} quantas cenas foram escritas (0 = nada, ou cancelado)
 */
export async function copyFoundrySettings(folder, picked) {
  if (!game.user.isGM) return 0;
  const scenes = scenesUnderFolder(folder);
  if (!scenes.length) {
    ui.notifications.warn("Esta pasta não tem cenas.");
    return 0;
  }
  if (!Object.keys(picked).length) {
    ui.notifications.warn("Marque ao menos um campo para copiar.");
    return 0;
  }
  const generation = foundryGeneration();
  const plan = planCopy(scenes.map(s => ({ id: s.id, name: s.name, source: s.toObject() })), picked, generation);
  if (!plan.updates.length) {
    ui.notifications.info("Nenhuma cena muda: todas já estão assim.");
    return 0;
  }
  const lines = copyConfirmLines(plan, scenes.length).map(line => `<li>${escapeHtml(line)}</li>`).join("");
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: `Aplicar às ${scenes.length} cena(s)`, icon: "fa-solid fa-copy" },
    classes: ["nihility-condition-dialog"],
    content: `<div class="nihility-scene-copy"><p>Copiar para <strong>${scenes.length}</strong> cena(s) de "${escapeHtml(folder.name)}" (e subpastas). É uma cópia única: depois, cada cena fica livre.</p><ul>${lines}</ul></div>`,
    yes: { label: "Aplicar", default: true },
    no: { label: "Cancelar" },
    rejectClose: false
  });
  if (!ok) return 0;
  const Scene = getDocumentClass("Scene");
  await Scene.updateDocuments(plan.updates.map(u => ({ _id: u.id, ...u.update })));
  ui.notifications.info(`${plan.updates.length} cena(s) atualizada(s).`);
  return plan.updates.length;
}

/* ------------------------------------------------------------------ Registro */

export function registerSceneFolders() {
  registerFolderMenu();

  // A cena mudou de pasta ou de valor próprio: o ambiente, a escuridão e o tempo já reagem nos hooks
  // deles (environment.js, world-clock.js, world-time.js); aqui só o visual.
  Hooks.on("updateScene", (scene, changed) => {
    if (sceneConfigChanged(changed)) syncSceneFxFromConfig(scene);
  });

  // Pasta de Cenas: antes de mudar o tempo (ou de lugar), guarda a data dos aparelhos.
  Hooks.on("preUpdateFolder", (folder, changed) => {
    if (!isDesignatedGm() || !isSceneFolder(folder)) return;
    if (!foundry.utils.hasProperty(changed, `flags.${SYSTEM_ID}.${SCENE_CFG_FLAG}`) && !("folder" in changed)) return;
    settleFolderScenes(folder).catch(err => console.warn(`${SYSTEM_ID} | Pasta de cenas:`, err));
  });
  Hooks.on("updateFolder", (folder, changed) => {
    if (!isDesignatedGm() || !isSceneFolder(folder)) return;
    if (!foundry.utils.hasProperty(changed, `flags.${SYSTEM_ID}.${SCENE_CFG_FLAG}`) && !("folder" in changed)) return;
    reapplyScenes(scenesUnderFolder(folder)).catch(err => reportError("Pasta de cenas: falha ao reaplicar.", err, { gmOnly: true }));
  });
}
