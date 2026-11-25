/**
 * Migração da 1.120.0: Trevas (o antigo Sombrio), Luz, Demoníaco, Terra e Vento. O catálogo SALVO de Tipos de Dano
 * ganha os elementos novos e troca rótulo/afinidades **só onde ainda estão iguais aos de fábrica anteriores**; o que o
 * Mestre editou fica como está e entra no aviso único. Pura (sem Foundry, sem `NIHILITY`): recebe o catálogo salvo e os
 * elementos de fábrica NOVOS como argumento. Testada em test/world-config.test.mjs.
 */

/** O que mudou de fábrica nos elementos que já existiam (valores ANTERIORES à 1.120.0). */
export const OLD_ELEMENT_FACTORY = Object.freeze({
  dark: { label: "Sombrio", affinity: { holy: 1 } },
  holy: { affinity: { dark: 1 } },
  lightning: { affinity: {} }
});

/** Os elementos que a migração acrescenta, pela ordem em que entram. */
export const NEW_ELEMENT_IDS = Object.freeze(["light", "demonic", "earth", "wind"]);

const clone = value => JSON.parse(JSON.stringify(value));

/** Assinatura de um mapa de afinidade: pares `id:nível` ordenados, sem os zeros. */
function affinitySig(map) {
  return Object.entries(map ?? {})
    .filter(([, level]) => Number(level) !== 0)
    .map(([id, level]) => `${id}:${Number(level)}`)
    .sort()
    .join(",");
}

const sameField = (field, a, b) => (field === "affinity" ? affinitySig(a) === affinitySig(b) : String(a ?? "") === String(b ?? ""));

/**
 * @param {Array<object>} list - catálogo de Tipos de Dano salvo
 * @param {Array<object>} factory - os elementos de fábrica NOVOS (`DEFAULT_DAMAGE_ELEMENTS`)
 * @param {Record<string, object>} [old] - os valores de fábrica ANTERIORES (padrão: OLD_ELEMENT_FACTORY)
 * @returns {{list: Array<object>, added: string[], changed: string[], kept: string[]}}
 */
export function planElementMigration(list, factory, old = OLD_ELEMENT_FACTORY) {
  const next = clone(Array.isArray(list) ? list : []);
  const added = [];
  const changed = [];
  const kept = [];
  const byId = id => next.find(el => el?.id === id);

  // Mundo só de sci-fi (sem nenhum elemento de fantasia salvo) não ganha elementos de fantasia.
  const hasFantasy = next.some(el => ["dark", "holy", "fire", "ice"].includes(el?.id));
  if (hasFantasy) {
    for (const id of NEW_ELEMENT_IDS) {
      if (byId(id)) continue;
      const entry = (factory ?? []).find(el => el?.id === id);
      if (!entry) continue;
      const holyIndex = next.findIndex(el => el?.id === "holy");
      const at = holyIndex >= 0 ? holyIndex + 1 + added.length : next.length;
      next.splice(at, 0, clone(entry));
      added.push(entry.label ?? id);
    }
  }

  for (const [id, before] of Object.entries(old)) {
    const saved = byId(id);
    const wanted = (factory ?? []).find(el => el?.id === id);
    if (!saved || !wanted) continue;
    for (const field of Object.keys(before)) {
      const label = `${wanted.label ?? id} (${field === "label" ? "nome" : "afinidades"})`;
      if (sameField(field, saved[field], wanted[field])) continue; // já está como o novo
      if (sameField(field, saved[field], before[field])) {
        saved[field] = clone(wanted[field] ?? (field === "affinity" ? {} : ""));
        changed.push(label);
      } else {
        kept.push(label);
      }
    }
  }
  return { list: next, added, changed, kept };
}

/** O aviso único ao Mestre (texto simples): o que ficou como estava. Vazio sem nada a avisar. */
export function elementKeptNotice(kept) {
  if (!kept?.length) return "";
  return `Os elementos Trevas, Luz, Sagrado, Demoníaco, Terra, Vento e Elétrico mudaram de fábrica, mas estes você já tinha editado e ficaram como estavam: ${kept.join("; ")}. Se quiser os valores novos, edite-os no editor de Tipos de Dano (a tabela está em docs/claude/dano.md).`;
}
