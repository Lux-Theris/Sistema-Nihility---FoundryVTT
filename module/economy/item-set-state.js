/**
 * Conjuntos (J12) — a ponte leve entre os Atores e as regras puras (`item-set-rules.js`): quais peças contam agora e
 * o andamento de cada conjunto. Fica separada de `item-sets.js` (Habilidades concedidas, arrastar, Compêndios) porque
 * a preparação da ficha (`character-model.js`, `species/origin.js`, `starship-model.js`) lê isto a cada preparação e
 * não deve puxar a cadeia de Skills, chat e diálogos.
 *
 * **Regra de reconhecimento.** A peça é reconhecida pelo id do conjunto gravado no Item (`system.itemSet`); a cópia no
 * Ator leva o campo. Conta, no Personagem, o Item Geral EQUIPADO e o implante/prótese INSTALADO (a cópia do Item
 * guardada na modificação, `sourceItem`); na Nave/Veículo, o Módulo INSTALADO. A mesma peça duas vezes (mesmo nome) conta
 * uma. Peça suprimida (mágica sob Antimagia, tecnológica sob PEM) não conta. O bloco "Conjuntos" desligado não conta nada.
 */
import { SYSTEM_ID, getActiveItemSets, isItemSetsEnabled } from "../core/config.js";
import { sourceSuppressed, suppressionState } from "../core/suppression.js";
import { evaluateSets, pieceKey, setAttributeRows, setLayer, shipBonusTotals } from "./item-set-rules.js";

/** A ficha de onde as peças saem: a cópia de Forma (`formOf`) usa as peças do original — o bônus de conjunto continua. */
function pieceOwner(actor) {
  const originalUuid = actor?.flags?.[SYSTEM_ID]?.formOf?.originalUuid;
  if (!originalUuid) return actor;
  try {
    const original = fromUuidSync(originalUuid);
    return original?.items ? original : actor;
  } catch (err) {
    return actor;
  }
}

/** As peças que contam agora num Ator: `[{setId, key}]`. */
export function actorSetPieces(actor) {
  const owner = pieceOwner(actor);
  if (!owner?.items) return [];
  const pieces = [];
  if (owner.type === "character") {
    const suppression = suppressionState(owner);
    for (const item of owner.items) {
      if (item.type === "item") {
        const setId = item.system?.itemSet;
        if (setId && item.system.equipped && !sourceSuppressed(owner, item, null, suppression)) pieces.push({ setId, key: pieceKey(item.name) });
      } else if (item.type === "body_part") {
        for (const mod of item.system?.installedMods ?? []) {
          const setId = mod.sourceItem?.system?.itemSet;
          if (setId && !sourceSuppressed(owner, item, mod, suppression)) pieces.push({ setId, key: pieceKey(mod.name || mod.sourceItem?.name) });
        }
      }
    }
  } else if (owner.type === "starship" || owner.type === "vehicle") {
    for (const item of owner.items) {
      if (item.type === "starship_module" && item.system?.itemSet) pieces.push({ setId: item.system.itemSet, key: pieceKey(item.name) });
    }
  }
  return pieces;
}

/** O andamento dos conjuntos de um Ator (só os que têm ao menos uma peça agora). Vazio com o bloco desligado. */
export function actorSetProgress(actor) {
  if (!isItemSetsEnabled() || !actor) return [];
  const kind = actor.type === "character" ? "character" : actor.type === "starship" || actor.type === "vehicle" ? "vessel" : null;
  if (!kind) return [];
  const sets = getActiveItemSets();
  if (!sets.length) return [];
  return evaluateSets(sets, actorSetPieces(actor), kind);
}

/** As camadas de origem (formato de `originLayers`) dos conjuntos de um Personagem, para a ficha ler pelos leitores da origem. */
export function actorSetLayers(actor) {
  if (actor?.type !== "character") return [];
  return actorSetProgress(actor).map(setLayer).filter(Boolean);
}

/** Parcelas de bônus de atributo (por fora, como o Item equipado) dos conjuntos de um Personagem. */
export function actorSetAttributeRows(actor, attribute) {
  if (actor?.type !== "character") return [];
  return setAttributeRows(actorSetProgress(actor), attribute).map(r => ({ label: r.label, value: r.value, uuid: null, kind: "set" }));
}

/** Os bônus de Nave dos conjuntos de uma Nave/Veículo: `{alvo: total}`. */
export function actorShipSetBonuses(actor) {
  if (actor?.type !== "starship" && actor?.type !== "vehicle") return {};
  return shipBonusTotals(actorSetProgress(actor));
}
