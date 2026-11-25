/**
 * Zona que escurece o mapa (1.120.0): o lado Foundry. Regras puras em zone-darkness-rules.js.
 *
 * Uma Zona de uma Skill com "Escurece o mapa" (`zoneDarkens`) ganha uma AmbientLight NEGATIVA no lugar dela (criada
 * pelo Mestre na criação da Zona, `createZone` em area-effects.js), guardada em `zone.lightIds`, e **apagada** junto com a
 * Zona (nunca desligada, como a luz de Estrutura). Quem está dentro conta como "no escuro" (`zoneDarkensToken`, lido pelo
 * `worldClockContext`: vale para o "Quando → Então" `selfDark` e para o "Só se estou no escuro").
 * Falhar em criar a luz não impede a Zona (a lição da 1.37).
 */
import { SYSTEM_ID } from "../core/config.js";
import { foundryGeneration } from "../helpers/foundry-compat.js";
import { isDesignatedGm } from "../helpers/gm-relay.js";
import { reportError } from "../helpers/report.js";
import { zonesOnScene, zoneContainsToken, sceneScale } from "./area-effects.js";
import { zoneLightData } from "./zone-darkness-rules.js";

/** O Token está dentro de alguma Zona da cena que escurece o mapa? Só lê documentos. */
export function zoneDarkensToken(tokenDoc) {
  const scene = tokenDoc?.parent;
  if (!scene) return false;
  try {
    for (const doc of zonesOnScene(scene)) {
      const zone = doc.getFlag(SYSTEM_ID, "zone");
      if (zone?.darkens && !zone.suspended && zoneContainsToken(doc, tokenDoc)) return true;
    }
  } catch (err) {
    return false;
  }
  return false;
}

/**
 * Cria a luz negativa de uma Zona e devolve os ids (vazio se falhar). Roda no Mestre, na criação.
 * @param {Scene} scene
 * @param {object} area - a área já normalizada (pixels)
 * @param {string} zoneName - para o aviso
 */
export async function createZoneDarkness(scene, area, zoneName = "Zona") {
  const data = zoneLightData(area, "", { pxPerUnit: sceneScale(scene).pxPerUnit, generation: foundryGeneration(), systemId: SYSTEM_ID });
  if (!data) return [];
  try {
    const created = await scene.createEmbeddedDocuments("AmbientLight", [data]);
    return created.map(doc => doc.id);
  } catch (err) {
    reportError(`Falha ao criar a escuridão da Zona ${zoneName}.`, err, { gmOnly: true });
    return [];
  }
}

/** Apaga as luzes negativas de uma Zona (as que ela guardou) e qualquer órfã marcada com ela. */
async function removeZoneDarkness(zoneDoc) {
  const zone = zoneDoc.getFlag(SYSTEM_ID, "zone");
  const scene = zoneDoc.parent;
  if (!scene || !zone?.lightIds?.length) return;
  const ids = zone.lightIds.filter(id => scene.lights?.get(id));
  if (ids.length) await scene.deleteEmbeddedDocuments("AmbientLight", ids).catch(() => {});
}

/** Chamado uma vez, no `init`: a luz some junto com a Zona (Mestre designado). */
export function registerZoneDarkness() {
  const gone = doc => {
    if (!isDesignatedGm() || !doc?.getFlag?.(SYSTEM_ID, "zone")?.darkens) return;
    removeZoneDarkness(doc).catch(err => console.warn(`${SYSTEM_ID} | Zona: falha ao apagar a escuridão.`, err));
  };
  Hooks.on("deleteRegion", gone);
  Hooks.on("deleteMeasuredTemplate", gone);
  // Cena apagada leva as luzes junto: nada a fazer.
}
