/**
 * Sorte (8d.1) — de onde vem a sorte de um Personagem. Fica fora de luck-rules.js (puro) porque lê o
 * Ator; a ficha (CharacterDataModel) soma o resultado em `system.luck` a cada preparação e o
 * "De onde vem" lista as mesmas linhas.
 *
 * Fontes (tudo soma): Títulos (`luck`), passivos de origem (`passives.luck` da Espécie/Linhagem/Herança),
 * Traços do catálogo (campos `luckAttributes/luckDamage/luckChances`), Active Effects com o flag `luck`
 * (efeito de Skill "Sorte") e Condições do catálogo com `luck` (valem em qualquer efeito que traga a Condição,
 * por qualquer caminho: Skill, elemento, Ambiente, marcada à mão).
 */
import { SYSTEM_ID, getActiveTraits, getActiveStatusConditions, getFeatureOption, isLuckEnabled } from "../core/config.js";
import { actorTraits } from "../core/config/actors.js";
import { layerPassives, layerLabel } from "../species/species-rules.js";
import { emptyLuck, hasLuck, luckFromScopes, normalizeLuck, sumLuck } from "./luck-rules.js";

/** @returns {Array<{label:string, attributes:number, damage:number, chances:number}>} */
export function collectLuckSources(actor) {
  if (!actor || !isLuckEnabled()) return [];
  const rows = [];
  const add = (label, luck) => {
    if (hasLuck(luck)) rows.push({ label, ...normalizeLuck(luck) });
  };
  for (const item of actor.items ?? []) if (item.type === "title") add(`Título: ${item.name}`, item.system?.luck);
  const kindLabel = { species: "Espécie", lineage: "Linhagem", heritage: "Herança" };
  for (const layer of actor.system?.originLayers ?? []) {
    add(`${kindLabel[layer.kind] ?? "Origem"}: ${layerLabel(layer) || layer.id}`, layerPassives(layer).luck);
  }
  const catalog = getActiveTraits();
  for (const id of actorTraits(actor)) {
    const t = catalog.find(x => x.id === id);
    if (t) add(`Traço: ${t.label ?? id}`, { attributes: t.luckAttributes, damage: t.luckDamage, chances: t.luckChances });
  }
  const conditions = getActiveStatusConditions();
  for (const effect of actor.effects ?? []) {
    if (effect.disabled) continue;
    const flags = effect.flags?.[SYSTEM_ID] ?? {};
    if (flags.luck) add(`Efeito: ${effect.name}`, luckFromScopes(flags.luck.value, flags.luck.scopes));
    const ids = new Set([flags.conditionId, ...(effect.statuses ?? [])].filter(Boolean));
    for (const id of ids) {
      const cond = conditions.find(c => c.id === id);
      if (cond?.luck) add(`Condição: ${cond.label}`, cond.luck);
    }
  }
  return rows;
}

/** A sorte total (com o teto opcional do bloco) de um Ator. */
export function totalLuck(actor) {
  if (!actor || !isLuckEnabled()) return emptyLuck();
  const cap = Number(getFeatureOption("luck", "luckCap")) || 0;
  return sumLuck(collectLuckSources(actor), { cap });
}
