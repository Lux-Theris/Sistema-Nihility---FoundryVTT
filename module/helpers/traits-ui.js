/**
 * Traços na ficha (Personagem e Nave/Veículo): o que mostrar e como acrescentar/retirar.
 *
 * Os Traços efetivos são os da Espécie + os da ficha − os retirados na ficha (`actorTraits` em
 * config.js). Retirar um Traço que veio da Espécie não mexe na Espécie: ele entra em
 * `traitsRemoved` e volta com "restaurar". Só o Mestre edita; o jogador só vê.
 */
import { getActiveTraits, getTraitLabel, getActiveSpeciesPresets, actorTraits } from "../core/config.js";
import { pickTraits } from "../apps/checklist-picker.js";

/** Dados pro template: chips efetivos, retirados (só Mestre) e o tamanho do catálogo (botão "+ Traço · N"). */
export function traitContext(actor) {
  const fromSpecies = new Set(getActiveSpeciesPresets()?.[actor.system?.species]?.traits ?? []);
  const effective = actorTraits(actor);
  const removed = (actor.system?.traitsRemoved ?? []).filter(id => fromSpecies.has(id));
  const present = new Set(effective);
  return {
    chips: effective.map(id => ({ id, label: getTraitLabel(id), fromSpecies: fromSpecies.has(id) })),
    removed: removed.map(id => ({ id, label: getTraitLabel(id) })),
    total: getActiveTraits().length
  };
}

/**
 * "+ Traço": abre a janela de escolha com os Traços efetivos marcados e grava a diferença em
 * relação à Espécie — o que a Espécie não dá vira `traits`, o que ela dá e foi desmarcado vira
 * `traitsRemoved`. A Espécie em si nunca muda.
 */
export async function pickActorTraits(actor) {
  if (!game.user.isGM) return;
  const picked = await pickTraits(actorTraits(actor), { title: `Traços — ${actor.name}` });
  if (!picked) return;
  const chosen = new Set(picked);
  const fromSpecies = new Set(getActiveSpeciesPresets()?.[actor.system?.species]?.traits ?? []);
  const update = { "system.traits": picked.filter(id => !fromSpecies.has(id)) };
  // Nave/Veículo não têm `traitsRemoved` (nem Espécie) — só grava onde o campo existe.
  if ("traitsRemoved" in actor.system) update["system.traitsRemoved"] = [...fromSpecies].filter(id => !chosen.has(id));
  await actor.update(update);
}

/**
 * Acrescenta, retira ou restaura um Traço.
 * @param {"add"|"remove"|"restore"} op
 */
export async function changeTrait(actor, id, op) {
  if (!id || !game.user.isGM) return;
  const traits = new Set(actor.system.traits ?? []);
  const removed = new Set(actor.system.traitsRemoved ?? []);
  const fromSpecies = new Set(getActiveSpeciesPresets()?.[actor.system?.species]?.traits ?? []);

  if (op === "add") {
    removed.delete(id);
    if (!fromSpecies.has(id)) traits.add(id);
  } else if (op === "remove") {
    traits.delete(id);
    if (fromSpecies.has(id)) removed.add(id);
  } else if (op === "restore") {
    removed.delete(id);
  }

  const update = { "system.traits": [...traits] };
  // Nave/Veículo não têm `traitsRemoved` (nem Espécie) — só grava onde o campo existe.
  if ("traitsRemoved" in actor.system) update["system.traitsRemoved"] = [...removed];
  await actor.update(update);
}
