/**
 * Conjuntos (J12, 1.122.0) — o lado Foundry: a faixa da ficha, a Habilidade concedida por faixa, o ato de virar peça
 * (arrastar para o catálogo, "Criar conjunto com este Item…") e as peças de fábrica nos Compêndios.
 * As regras estão em `item-set-rules.js` (puro) e a leitura do Ator em `item-set-state.js` (leve).
 *
 * **Habilidade concedida por faixa.** Nasce quando a faixa liga e some quando ela desliga (peça desequipada, vendida,
 * suprimida, conjunto apagado), pelo mesmo caminho da Habilidade concedida por Item (`createGrantedSkill`, marca
 * `grantedBySource`) — com a chave `set:<conjunto>:<faixa>`, que impede duplicar. Quem fez a mudança (o cliente que
 * escreveu o Item/efeito) reconcilia, e só se for dono da ficha; uma fila por Ator serializa as reconciliações.
 * Com o bloco "Conjuntos" desligado nada é reconciliado (desligar não apaga o que já foi concedido).
 */
import {
  SYSTEM_ID,
  NIHILITY,
  getActiveItemSets,
  getActiveAttributes,
  getActiveDamageElements,
  getAttributeLabel,
  getEnergyLabelForActor,
  getStarshipEnergyAbbr,
  isItemSetsEnabled
} from "../core/config.js";
import { actorSetProgress } from "./item-set-state.js";
import { grantedSkillPlan, setStripView, SET_SKILL_PREFIX, pieceKindOf, setFitsItemType, isBareSensorPiece } from "./item-set-rules.js";
import { createGrantedSkill, removeGrantedSkill } from "../skills/skill-economy.js";
import { getCompendiumForItemType } from "../core/compendium.js";

/* ------------------------------------------------------------------ Habilidade concedida pela faixa */

const queues = new Map();

/** Reconcilia as Habilidades concedidas pelos conjuntos de um Personagem (uma de cada vez por Ator). */
export function syncSetSkills(actor) {
  if (!actor || actor.type !== "character" || !isItemSetsEnabled()) return Promise.resolve();
  const previous = queues.get(actor.uuid) ?? Promise.resolve();
  const next = previous
    .then(() => reconcile(actor))
    .catch(err => console.warn(`${SYSTEM_ID} | Falha ao conceder a Habilidade de um conjunto`, err));
  queues.set(actor.uuid, next);
  return next;
}

async function reconcile(actor) {
  if (!actor.isOwner) return;
  const existing = actor.items.filter(i => i.type === "skill" && String(i.flags?.[SYSTEM_ID]?.grantedBySource ?? "").startsWith(SET_SKILL_PREFIX));
  const plan = grantedSkillPlan(actorSetProgress(actor), existing.map(i => i.flags[SYSTEM_ID].grantedBySource));
  for (const key of plan.remove) await removeGrantedSkill(actor, key);
  for (const { key, grantsSkill } of plan.create) {
    // Releitura: uma reconciliação anterior pode ter criado esta enquanto esperávamos.
    if (actor.items.some(i => i.type === "skill" && i.flags?.[SYSTEM_ID]?.grantedBySource === key)) continue;
    await createGrantedSkill(actor, grantsSkill, key);
  }
}

/** As cópias de Forma de um Personagem (usam as peças do original). */
function formCopiesOf(actor) {
  return (game.actors?.contents ?? []).filter(a => a.flags?.[SYSTEM_ID]?.formOf?.originalUuid === actor.uuid);
}

function syncFromChange(actor, userId) {
  if (!actor || actor.documentName !== "Actor" || actor.type !== "character" || userId !== game.user.id) return;
  syncSetSkills(actor);
  for (const copy of formCopiesOf(actor)) syncSetSkills(copy);
}

/** Liga os ganchos que reconciliam (uma vez, no `init`). */
export function registerItemSets() {
  const relevant = item => item?.parent && ["item", "body_part"].includes(item.type);
  Hooks.on("createItem", (item, options, userId) => relevant(item) && syncFromChange(item.parent, userId));
  Hooks.on("updateItem", (item, changes, options, userId) => relevant(item) && syncFromChange(item.parent, userId));
  Hooks.on("deleteItem", (item, options, userId) => relevant(item) && syncFromChange(item.parent, userId));
  // Antimagia/PEM entram e saem como efeitos: a peça suprimida deixa de contar.
  const effectChange = (effect, options, userId) => {
    const flags = effect?.flags?.[SYSTEM_ID] ?? {};
    if (flags.suppression === undefined && flags.techSuppression === undefined) return;
    syncFromChange(effect.parent, userId);
  };
  Hooks.on("createActiveEffect", effectChange);
  Hooks.on("deleteActiveEffect", effectChange);
  Hooks.on("updateActiveEffect", (effect, changes, options, userId) => effectChange(effect, options, userId));
  // A cópia de Forma recebe as Habilidades do conjunto assim que o mapa de Itens é gravado.
  Hooks.on("updateActor", (actor, changes, options, userId) => {
    if (foundry.utils.hasProperty(changes, `flags.${SYSTEM_ID}.formOf.itemMap`)) syncFromChange(actor, userId);
  });
}

/* ------------------------------------------------------------------ a faixa na ficha */

/** Os rótulos que os textos das faixas usam (atributo, elemento, energia). */
function labelsFor(actor) {
  const elements = getActiveDamageElements();
  const vessel = actor?.type === "starship" || actor?.type === "vehicle";
  return {
    attributeLabel: key => getAttributeLabel(key),
    targetLabel: id => elements.find(e => e.id === id)?.label ?? id,
    energyLabel: vessel ? getStarshipEnergyAbbr() : getEnergyLabelForActor(actor)
  };
}

/** As faixas de conjunto de um Ator, prontas para o template: `[{id, label, count, total, pips, tiers}]`. */
export function setStripsFor(actor) {
  if (!isItemSetsEnabled()) return [];
  const labels = labelsFor(actor);
  return actorSetProgress(actor).map(progress => setStripView(progress, labels));
}

/* ------------------------------------------------------------------ virar peça */

/** Os dados de uma peça do catálogo a partir de um Item. */
export function pieceFromItem(item) {
  return { name: item.name, uuid: item.uuid, kind: pieceKindOf(item) };
}

/** Pode este documento virar peça do conjunto? Devolve o motivo da recusa, ou `""`. */
export function pieceRefusal(set, doc) {
  if (!doc || doc.documentName !== "Item") return "Arraste um Item (do mundo, de um Compêndio ou de uma ficha).";
  if (!["item", "starship_module"].includes(doc.type)) return `Este tipo de Item (${doc.type}) não pode ser peça de conjunto.`;
  if (!setFitsItemType(set, doc.type)) return doc.type === "starship_module" ? "Módulo de nave só entra em conjunto de Nave/Veículo." : "Este Item só entra em conjunto de Personagem.";
  return "";
}

/** Grava o conjunto no Item (campo "Conjunto"). Só o Mestre; um Compêndio travado recusa e avisa. */
export async function writeItemSet(uuid, setId) {
  const doc = await fromUuid(uuid);
  if (!doc || doc.documentName !== "Item") return false;
  if (doc.system?.itemSet === setId) return true;
  try {
    await doc.update({ "system.itemSet": setId });
    return true;
  } catch (err) {
    ui.notifications.warn(`Não consegui gravar o conjunto em "${doc.name}" (Compêndio travado?). Escolha o conjunto na ficha da cópia.`);
    return false;
  }
}

/* ------------------------------------------------------------------ peças de fábrica */

/**
 * Semeia nos Compêndios os Itens das peças dos conjuntos de fábrica que ainda não existem (casa pela marca
 * `flags.<sistema>.factoryPiece`, nunca pelo nome). Só o Mestre; não mexe no que já está lá. Devolve quantos criou.
 */
export async function ensureFactorySetItems() {
  if (!game.user.isGM) return 0;
  let created = 0;
  for (const type of ["item", "starship_module"]) {
    const pack = getCompendiumForItemType(type);
    if (!pack) continue;
    const index = await pack.getIndex({ fields: [`flags.${SYSTEM_ID}.factoryPiece`] });
    const have = new Set(index.map(e => e.flags?.[SYSTEM_ID]?.factoryPiece).filter(Boolean));
    const missing = NIHILITY.DEFAULT_ITEM_SET_PIECES
      .filter(p => p.type === type && !have.has(`${p.set}:${p.key}`))
      .map(p => ({
        name: p.name,
        type: p.type,
        system: { ...foundry.utils.deepClone(p.system), itemSet: p.set },
        flags: { [SYSTEM_ID]: { factoryPiece: `${p.set}:${p.key}` } }
      }));
    if (!missing.length) continue;
    await pack.documentClass.createDocuments(missing, { pack: pack.collection });
    created += missing.length;
  }
  return created;
}

/**
 * 1.122.1: o "Sensor de Caça" semeado na 1.122.0 não tinha a função Sensor. Atualiza a peça nos Compêndios só se ela
 * ainda for a versão vazia de fábrica (`isBareSensorPiece`); peça que o Mestre editou não é tocada. Só o Mestre.
 */
export async function repairFactorySensorPiece() {
  if (!game.user.isGM) return 0;
  const pack = getCompendiumForItemType("starship_module");
  if (!pack) return 0;
  const factory = NIHILITY.DEFAULT_ITEM_SET_PIECES.find(p => p.set === "kit_de_caca" && p.key === "sensor_de_caca");
  if (!factory) return 0;
  const documents = await pack.getDocuments();
  const updates = documents
    .filter(d => d.flags?.[SYSTEM_ID]?.factoryPiece === "kit_de_caca:sensor_de_caca" && isBareSensorPiece(d.system))
    .map(d => ({
      _id: d.id,
      system: {
        functions: foundry.utils.deepClone(factory.system.functions),
        sensorRange: factory.system.sensorRange,
        sensorResolution: factory.system.sensorResolution,
        sensorPassiveConsumption: factory.system.sensorPassiveConsumption
      }
    }));
  if (!updates.length) return 0;
  await pack.documentClass.updateDocuments(updates, { pack: pack.collection });
  return updates.length;
}

/** Os atributos que os conjuntos conhecem (para o Validar Mundo e a IA). */
export function knownAttributeKeys() {
  return new Set(getActiveAttributes().map(a => a.key));
}
