/**
 * Regeneração por rodada (prancha 7) — regras PURAS, testadas.
 *
 * Um número só: "% da máxima por rodada". Fontes: a regeneração natural da mesa (bloco
 * "Regeneração natural de energia"), e o bloco "Regeneração por rodada" de Skill (escala com o
 * Poder do nível), Título, Item Geral equipado e Espécie/Linhagem/Herança. Tudo soma; a Vida por
 * rodada tem tipo (Cura ou Regeneração), e cada fonte cura com o nível dela (Skill = nível da Skill,
 * o resto = 0) — é o que um bloqueio de cura compara.
 */

/** Bloco salvo → números limpos. */
export function normalizeRegen(regen = {}) {
  return {
    energyPercent: Math.max(0, Number(regen?.energyPercent) || 0),
    hpPercent: Math.max(0, Number(regen?.hpPercent) || 0),
    hpKind: regen?.hpKind === "regeneracao" ? "regeneracao" : "cura"
  };
}

/**
 * Soma as fontes. Cada fonte: `{label, energyPercent, hpPercent, hpKind, level, power}` (`power`
 * multiplica os dois %, o Poder do nível da Skill). A Vida sai agrupada por (tipo, nível) porque o
 * bloqueio de cura depende dos dois.
 * @returns {{energy:number, hp:Array<{kind:string, level:number, percent:number}>, rows:Array<{label:string, energy:number, hp:number, kind:string}>}}
 */
export function sumRegen(sources = []) {
  let energy = 0;
  const hp = new Map();
  const rows = [];
  for (const src of sources) {
    const r = normalizeRegen(src);
    const power = Math.max(0, Number(src.power ?? 1) || 0);
    const e = r.energyPercent * power;
    const h = r.hpPercent * power;
    if (!e && !h) continue;
    energy += e;
    if (h) {
      const level = Math.max(0, Number(src.level) || 0);
      const key = `${r.hpKind}@${level}`;
      const cur = hp.get(key) ?? { kind: r.hpKind, level, percent: 0 };
      cur.percent += h;
      hp.set(key, cur);
    }
    rows.push({ label: src.label ?? "", energy: e, hp: h, kind: r.hpKind });
  }
  return { energy, hp: [...hp.values()], rows };
}

/** Pontos de uma regeneração de `percent` % sobre `max` (arredondado; nunca negativo). */
export function regenAmount(max, percent) {
  return Math.max(0, Math.round(((Number(max) || 0) * (Number(percent) || 0)) / 100));
}
