/**
 * Configuração de cenas por pasta (H20): a LEITURA ÚNICA. Todo leitor de configuração de cena do
 * sistema (linha do tempo, tem rede, escurece com o relógio, densidade de Mana, radiação, perigos)
 * passa por `sceneField`/`sceneConfig` daqui: valor próprio da cena -> pasta da cena -> pastas acima
 * -> padrão. A regra é pura (`scene-config-rules.js`); aqui só se leem Cenas, Pastas e flags.
 *
 * Onde fica: a flag `sceneCfg` da Cena e da Pasta (tipo Scene) guarda só as chaves com valor próprio.
 * As flags ANTIGAS (`time`, `environment`) ainda valem como valor próprio quando não estão vazias
 * (ver `legacyOwn`); gravar por aqui limpa a antiga do mesmo campo, para ela não ressuscitar.
 *
 * Bloco desligado (`FEATURES.sceneFolders`): as pastas são ignoradas (vale só o valor da própria cena).
 * Este arquivo não importa environment.js nem world-time.js (eles é que importam este).
 */
import { SYSTEM_ID, isSceneFoldersEnabled } from "../core/config.js";
import { deleteKeyUpdate } from "../helpers/foundry-compat.js";
import {
  SCENE_CFG_FLAG, SCENE_FIELDS, SCENE_FIELD_KEYS, normalizeCfg, sceneOwn, folderChain, resolveField, resolveAll,
  folderSubtreeIds, diffOwn, fieldDefault
} from "./scene-config-rules.js";

export { SCENE_FIELDS, SCENE_FIELD_KEYS };

/** Pastas de Cenas do mundo, por id, no formato da regra pura. */
function folderMap() {
  const map = new Map();
  for (const folder of game.folders?.contents ?? []) {
    if (folder.type !== "Scene") continue;
    map.set(folder.id, { id: folder.id, name: folder.name, parentId: folder.folder?.id ?? null, cfg: normalizeCfg(folder.getFlag?.(SYSTEM_ID, SCENE_CFG_FLAG)) });
  }
  return map;
}

/** Os valores próprios gravados numa pasta. */
export function folderOwn(folder) {
  return normalizeCfg(folder?.getFlag?.(SYSTEM_ID, SCENE_CFG_FLAG));
}

/** Os valores próprios de uma cena (flag nova + o que as antigas ainda dizem). */
export function sceneOwnValues(scene) {
  return sceneOwn(
    scene?.getFlag?.(SYSTEM_ID, SCENE_CFG_FLAG),
    scene?.getFlag?.(SYSTEM_ID, "time"),
    scene?.getFlag?.(SYSTEM_ID, "environment")
  );
}

/** A cadeia de pastas ACIMA de um alvo: a pasta da cena (ou a pasta pai de uma pasta) e as de cima. */
export function inheritanceChain(target) {
  if (!target || !isSceneFoldersEnabled()) return [];
  const startId = target.documentName === "Folder" ? (target.folder?.id ?? null) : (target.folder?.id ?? target._source?.folder ?? null);
  return folderChain(startId, folderMap());
}

/** Cada campo da cena, com de onde veio: `{chave: {value, source: "own"|"folder"|"default", from}}`. */
export function sceneConfig(scene) {
  return resolveAll({ own: sceneOwnValues(scene), chain: inheritanceChain(scene) });
}

/** UM campo da cena (o valor). É isto que os leitores do sistema chamam. */
export function sceneField(scene, key) {
  if (!scene) return fieldDefault(key);
  return resolveField(key, { own: sceneOwnValues(scene), chain: inheritanceChain(scene) }).value;
}

/** O mesmo, para uma pasta: o que ela mesma define e o que herda das de cima. */
export function folderConfig(folder) {
  return resolveAll({ own: folderOwn(folder), chain: inheritanceChain(folder) });
}

/** As cenas dentro de uma pasta (ela e as subpastas). */
export function scenesUnderFolder(folder) {
  const list = [...folderMap().values()];
  const ids = folderSubtreeIds(folder?.id, list);
  return (game.scenes?.contents ?? []).filter(scene => scene.folder && ids.has(scene.folder.id));
}

/** As pastas dentro de uma pasta (só as subpastas). */
export function subfoldersOf(folder) {
  const list = [...folderMap().values()];
  const ids = folderSubtreeIds(folder?.id, list);
  ids.delete(folder?.id);
  return [...ids].map(id => game.folders.get(id)).filter(Boolean);
}

/** As cenas sob uma pasta que têm valor próprio, para o resumo da janela da pasta. */
export function scenesWithOwnUnder(folder) {
  return scenesUnderFolder(folder).map(scene => ({ id: scene.id, name: scene.name, own: sceneOwnValues(scene) }));
}

/** Para cada campo, o que as flags antigas guardam como "vazio" — gravado junto, para a antiga não voltar. */
const LEGACY_CLEAR = {
  lineId: ["time", "lineId", "main"],
  network: ["time", "network", false],
  clockDarkness: ["environment", "clockDarkness", false],
  manaDensity: ["environment", "manaDensity", null],
  radiation: ["environment", "radiation", 0],
  hazards: ["environment", "hazards", []]
};

/**
 * Pedaço de `scene.update()`/`folder.update()` que põe `set` como valor próprio e tira `remove`.
 * Na cena também zera o campo na flag antiga (só se ela existir, para não criar flag à toa).
 */
export function ownUpdate(doc, { set = {}, remove = [] } = {}) {
  const update = {};
  const isScene = doc?.documentName === "Scene";
  for (const [key, value] of Object.entries(set)) {
    update[`flags.${SYSTEM_ID}.${SCENE_CFG_FLAG}.${key}`] = foundry.utils.deepClone(value);
  }
  for (const key of remove) Object.assign(update, deleteKeyUpdate(`flags.${SYSTEM_ID}.${SCENE_CFG_FLAG}.${key}`));
  if (isScene) {
    for (const key of [...Object.keys(set), ...remove]) {
      const [flag, name, empty] = LEGACY_CLEAR[key] ?? [];
      if (flag && doc.getFlag(SYSTEM_ID, flag)?.[name] !== undefined) update[`flags.${SYSTEM_ID}.${flag}.${name}`] = foundry.utils.deepClone(empty);
    }
  }
  return update;
}

/** Grava os valores próprios de uma cena ou pasta (o que mudou). Devolve o `{set, remove}` aplicado. */
export async function writeOwn(doc, next, options = {}) {
  const diff = diffOwn(doc.documentName === "Scene" ? sceneOwnValues(doc) : folderOwn(doc), next);
  if (!Object.keys(diff.set).length && !diff.remove.length) return diff;
  await doc.update(ownUpdate(doc, diff), options);
  return diff;
}

/** Põe só estes valores próprios na cena (os outros ficam como estão). Usado pelo editor de linhas. */
export async function setSceneOwn(scene, patch) {
  return writeOwn(scene, { ...sceneOwnValues(scene), ...patch });
}

/** A cena mudou (flag nova ou pasta)? Para os hooks de `updateScene`. */
export function sceneConfigChanged(changed) {
  return foundry.utils.hasProperty(changed, `flags.${SYSTEM_ID}.${SCENE_CFG_FLAG}`) || (changed && "folder" in changed);
}
