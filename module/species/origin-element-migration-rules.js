/**
 * Migração da 1.121.0: Linhagens por elemento (Dragoide e Slime), Slime Comum, Dragão de Trevas, a Herança "Vampirizado por
 * Demônio" e os corpos/fraquezas novos (Elfo Sombrio fraco a Luz; Slime Demoníaco e Possuído com corpo Demoníaco).
 * Como a `originDefenses` da 1.117.0: o catálogo SALVO ganha as Linhagens/Heranças que faltam (pelo id) e só troca um campo
 * onde ele ainda está igual ao de fábrica ANTERIOR (1.119.0); o que o Mestre editou fica e entra no aviso único. Pura.
 */
import { sameDefenseList, DEFENSE_FIELDS } from "./origin-defense-migration-rules.js";

/** O que mudou de fábrica nas entradas que já existiam (valores da 1.119.0). Chave: `species:ID`, `lineage:ESPÉCIE:ID`, `heritage:ID`. */
export const OLD_FACTORY_1119 = Object.freeze({
  "species:slime": { resistances: [{ target: "blunt", amount: 30 }, { target: "acid", amount: 30 }, { target: "fire", amount: -20 }] },
  "lineage:elfo:sombrio": { resistances: [{ target: "dark", amount: 20 }, { target: "holy", amount: -10 }] },
  "species:slime_demoniaco": { resistances: [{ target: "dark", amount: 30 }, { target: "blunt", amount: 30 }, { target: "acid", amount: 30 }, { target: "holy", amount: -20 }], elements: ["dark"] },
  "heritage:possuido": { resistances: [{ target: "dark", amount: 20 }, { target: "holy", amount: -20 }], elements: ["dark"] }
});

/** As Heranças que a 1.121.0 acrescenta. */
export const NEW_HERITAGE_IDS = Object.freeze(["vampirizado_demonio"]);
/** Heranças já existentes que passam a excluir a nova (`excludes` vale nos dois sentidos). */
export const EXCLUDES_NEW_HERITAGE = Object.freeze(["vampirizado", "abencoado"]);

const clone = value => JSON.parse(JSON.stringify(value));
const read = (obj, path) => path.reduce((o, k) => (o == null ? undefined : o[k]), obj);

function write(obj, path, value) {
  let o = obj;
  for (const key of path.slice(0, -1)) {
    if (!o[key] || typeof o[key] !== "object") o[key] = {};
    o = o[key];
  }
  o[path[path.length - 1]] = value;
}

/**
 * @param {object} input
 * @param {Record<string, object>} input.species - catálogo de Espécies salvo
 * @param {Array<object>} input.heritages - catálogo de Heranças salvo
 * @param {{species: Record<string, object>, heritages: Array<object>}} input.factory - a fábrica NOVA
 * @param {Record<string, string[]>} input.newLineages - ids de Linhagem novos por Espécie (`newLineageIds()`)
 * @param {Record<string, object>} [input.old] - os valores de fábrica ANTERIORES
 * @returns {{species:object, heritages:Array<object>, changed:string[], added:string[], kept:string[]}}
 */
export function planOriginElementMigration({ species = {}, heritages = [], factory, newLineages = {}, old = OLD_FACTORY_1119 } = {}) {
  const nextSpecies = clone(species ?? {});
  const nextHeritages = clone(Array.isArray(heritages) ? heritages : []);
  const changed = [];
  const added = [];
  const kept = [];

  const lookup = key => {
    const [kind, a, b] = key.split(":");
    if (kind === "species") return { label: factory?.species?.[a]?.label ?? a, entry: factory?.species?.[a], saved: nextSpecies[a] };
    if (kind === "lineage") {
      const fe = factory?.species?.[a]?.lineages?.find(l => l.id === b);
      return { label: `${factory?.species?.[a]?.label ?? a} · ${fe?.label ?? b}`, entry: fe, saved: nextSpecies[a]?.lineages?.find(l => l?.id === b) };
    }
    const fe = (factory?.heritages ?? []).find(h => h.id === a);
    return { label: `Herança ${fe?.label ?? a}`, entry: fe, saved: nextHeritages.find(h => h?.id === a) };
  };

  // 1. Campos que mudaram de fábrica, só onde ainda estão como antes.
  for (const [key, before] of Object.entries(old)) {
    const { label, entry, saved } = lookup(key);
    if (!entry || !saved) continue;
    for (const def of DEFENSE_FIELDS) {
      const prev = read(before, def.path.slice(def.path[0] === "passives" ? 1 : 0));
      if (prev === undefined) continue; // este campo não mudou nesta entrada
      const wanted = read(entry, def.path) ?? [];
      const current = read(saved, def.path) ?? [];
      if (sameDefenseList(current, wanted, def.sig)) continue;
      if (sameDefenseList(current, prev, def.sig)) {
        write(saved, def.path, clone(wanted));
        changed.push(`${label} (${def.label})`);
      } else {
        kept.push(`${label} (${def.label})`);
      }
    }
  }

  // 2. Linhagens novas (Dragoide, Slime): entram pelo id, se a Espécie está no catálogo salvo.
  for (const [speciesId, ids] of Object.entries(newLineages)) {
    const saved = nextSpecies[speciesId];
    const fe = factory?.species?.[speciesId];
    if (!saved || !fe) continue;
    if (!Array.isArray(saved.lineages)) saved.lineages = [];
    const missing = (fe.lineages ?? []).filter(l => ids.includes(l.id) && !saved.lineages.some(s => s?.id === l.id));
    if (!missing.length) continue;
    // A Linhagem Slime Comum vai à frente (é a padrão).
    for (const l of missing) {
      if (l.id === "comum") saved.lineages.unshift(clone(l));
      else saved.lineages.push(clone(l));
    }
    added.push(`${fe.label ?? speciesId}: ${missing.length} Linhagem(ns)`);
    if (speciesId === "slime" && missing.some(l => l.id === "comum") && !saved.lineageRequired) {
      saved.lineageRequired = true;
      changed.push("Slime (Linhagem obrigatória)");
    }
  }

  // 3. Heranças novas e a exclusão mútua com as que já existiam.
  for (const id of NEW_HERITAGE_IDS) {
    const fe = (factory?.heritages ?? []).find(h => h.id === id);
    if (fe && !nextHeritages.some(h => h?.id === id)) {
      nextHeritages.push(clone(fe));
      added.push(`Herança ${fe.label ?? id}`);
    }
  }
  for (const id of EXCLUDES_NEW_HERITAGE) {
    const saved = nextHeritages.find(h => h?.id === id);
    if (saved && Array.isArray(saved.excludes) && !saved.excludes.includes(NEW_HERITAGE_IDS[0])) saved.excludes.push(NEW_HERITAGE_IDS[0]);
  }
  return { species: nextSpecies, heritages: nextHeritages, changed, added, kept };
}

/** O aviso único ao Mestre (texto simples): o que ficou como estava. Vazio sem nada a avisar. */
export function originElementKeptNotice(kept) {
  if (!kept?.length) return "";
  return `Os corpos e fraquezas de fábrica de algumas Espécies mudaram com os elementos novos (Trevas, Luz, Demoníaco…), mas estes você já tinha editado e ficaram como estavam: ${kept.join("; ")}. Se quiser os valores novos, edite-os no editor de Espécies (a tabela está em docs/claude/especies.md).`;
}
