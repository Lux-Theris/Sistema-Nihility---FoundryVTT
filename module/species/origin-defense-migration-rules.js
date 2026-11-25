/**
 * Migração da 1.117.0: os valores de fábrica de resistências, fraquezas e Condições das Espécies/Linhagens/
 * Heranças mudaram (tabela aprovada pelo dono). O catálogo SALVO no mundo só recebe os valores novos onde aquele
 * campo ainda está igual ao de fábrica ANTERIOR; o que o Mestre editou fica como está e vira um aviso. Pura.
 *
 * Quem lê/grava o setting é `core/migrations.js`; aqui só se decide o que muda. Recebe o catálogo salvo e os
 * valores de fábrica novos como argumento (nada de Foundry, nada de `NIHILITY`).
 */

/** Resistências de fábrica ANTES da 1.117.0 (só o que existia; o resto era vazio). Chave: `species:ID`, `lineage:ESPÉCIE:ID`, `heritage:ID`. */
export const OLD_FACTORY_DEFENSES = Object.freeze({
  "species:kijin": { resistances: [{ target: "physical", amount: 10 }] },
  "lineage:elfo:sombrio": { resistances: [{ target: "dark", amount: 20 }] },
  "lineage:dragoide:fogo": { resistances: [{ target: "fire", amount: 20 }] },
  "lineage:dragoide:gelo": { resistances: [{ target: "ice", amount: 20 }] },
  "lineage:dragoide:raio": { resistances: [{ target: "lightning", amount: 20 }] },
  "lineage:androide:combate": { resistances: [{ target: "physical", amount: 10 }] },
  "heritage:vampirizado": { resistances: [{ target: "dark", amount: 30 }] },
  "heritage:meio_dragao": { resistances: [{ target: "fire", amount: 20 }] },
  "heritage:abencoado": { resistances: [{ target: "dark", amount: 20 }] },
  "heritage:mutacao_radioativa": { resistances: [{ target: "acid", amount: 25 }] }
});

/** Campos migrados: caminho dentro da entrada, rótulo e como comparar cada item. */
export const DEFENSE_FIELDS = Object.freeze([
  { field: "resistances", path: ["passives", "resistances"], label: "Resistências", sig: r => `${r?.target}|${Number(r?.amount) || 0}` },
  { field: "conditions", path: ["passives", "conditions"], label: "Condições", sig: c => `${c?.conditionId}|${c?.mode === "immune" ? "immune" : "resist"}|${c?.mode === "immune" ? 100 : Number(c?.amount) || 0}` },
  // O Lobo Tempestade ganhou o elemento Elétrico no corpo.
  { field: "elements", path: ["elements"], label: "Elementos do corpo", sig: e => String(e) }
]);

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

/** Duas listas têm os mesmos itens (ordem não importa)? */
export function sameDefenseList(a, b, sig) {
  const A = (Array.isArray(a) ? a : []).map(sig).sort();
  const B = (Array.isArray(b) ? b : []).map(sig).sort();
  return A.length === B.length && A.every((v, i) => v === B[i]);
}

/**
 * O que a migração faz num catálogo salvo.
 * @param {object} input
 * @param {Record<string, object>} input.species - catálogo de Espécies salvo (`id → entrada`)
 * @param {Array<object>} input.heritages - catálogo de Heranças salvo (lista)
 * @param {{species: Record<string, object>, heritages: Array<object>}} input.factory - os valores de fábrica NOVOS
 * @param {Record<string, object>} [input.old] - os valores de fábrica ANTERIORES (padrão: OLD_FACTORY_DEFENSES)
 * @returns {{species:object, heritages:Array<object>, changed:string[], kept:string[]}}
 */
export function planOriginDefenseMigration({ species = {}, heritages = [], factory, old = OLD_FACTORY_DEFENSES } = {}) {
  const nextSpecies = clone(species ?? {});
  const nextHeritages = clone(Array.isArray(heritages) ? heritages : []);
  const changed = [];
  const kept = [];

  /** Uma unidade (Espécie, Linhagem ou Herança): compara cada campo e decide. */
  const visit = (key, label, savedEntry, factoryEntry) => {
    if (!savedEntry || !factoryEntry) return;
    for (const def of DEFENSE_FIELDS) {
      const wanted = read(factoryEntry, def.path) ?? [];
      const before = read(old[key] ?? {}, def.path.slice(def.path[0] === "passives" ? 1 : 0)) ?? [];
      if (sameDefenseList(wanted, before, def.sig)) continue; // este campo não mudou na fábrica
      const current = read(savedEntry, def.path) ?? [];
      if (sameDefenseList(current, wanted, def.sig)) continue; // já está como o novo
      if (sameDefenseList(current, before, def.sig)) {
        write(savedEntry, def.path, clone(wanted));
        changed.push(`${label} (${def.label})`);
      } else {
        kept.push(`${label} (${def.label})`);
      }
    }
  };

  for (const [id, entry] of Object.entries(factory?.species ?? {})) {
    visit(`species:${id}`, entry.label ?? id, nextSpecies[id], entry);
    for (const lineage of entry.lineages ?? []) {
      const saved = (nextSpecies[id]?.lineages ?? []).find(l => l?.id === lineage.id);
      visit(`lineage:${id}:${lineage.id}`, `${entry.label ?? id} · ${lineage.label ?? lineage.id}`, saved, lineage);
    }
  }
  for (const entry of factory?.heritages ?? []) {
    visit(`heritage:${entry.id}`, `Herança ${entry.label ?? entry.id}`, nextHeritages.find(h => h?.id === entry.id), entry);
  }
  return { species: nextSpecies, heritages: nextHeritages, changed, kept };
}

/** O aviso único ao Mestre (texto simples, sem HTML): o que ficou como estava. */
export function originDefenseKeptNotice(kept) {
  if (!kept?.length) return "";
  return `As resistências, fraquezas e Condições de fábrica das Espécies mudaram, mas estas você já tinha editado e ficaram como estavam: ${kept.join("; ")}. Se quiser os valores novos, edite-os no editor de Espécies (a tabela está em docs/claude/especies.md).`;
}
