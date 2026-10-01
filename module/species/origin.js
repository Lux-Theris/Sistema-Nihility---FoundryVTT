/**
 * As camadas de origem de um Ator (Espécie → Linhagem → Heranças) lidas do catálogo — a ponte
 * entre a ficha e as funções puras de species-rules.js. Fica separado de species.js de propósito:
 * o DataModel lê isto a cada preparação, e não deve depender de compêndio, chat ou diálogos.
 */
import { getActiveSpeciesPresets, getActiveHeritages } from "../core/config.js";
import { normalizeSpeciesEntry, originLayers } from "./species-rules.js";

/** Entrada de Herança do catálogo (normalizada), ou null. */
export function getHeritageEntry(id) {
  const raw = getActiveHeritages().find(h => h.id === id);
  return raw ? normalizeSpeciesEntry(raw) : null;
}

/** As camadas de um Personagem (vazio para Nave/Veículo ou sem Espécie). */
export function actorOriginLayers(actorOrSystem) {
  const system = actorOrSystem?.system ?? actorOrSystem;
  if (!system || typeof system.species !== "string") return [];
  const rawSpecies = system.species ? getActiveSpeciesPresets()?.[system.species] : null;
  const species = rawSpecies ? normalizeSpeciesEntry(rawSpecies) : null;
  const lineage = species && system.lineage ? species.lineages.find(l => l.id === system.lineage) ?? null : null;
  const heritages = (system.heritages ?? [])
    .map(h => ({ id: h.id, entry: getHeritageEntry(h.id) }))
    .filter(h => h.entry);
  return originLayers({ species, lineage, heritages });
}
