/**
 * Números flutuantes sobre o Token (P2): que valores acompanhar e o que mostrar quando mudam.
 * Pura e testada — `combat/floating-numbers.js` só lê as fichas e desenha.
 *
 * A mesa é narrada por voz e os jogadores olham o mapa, não o chat; o card de dano continua
 * sendo o registro, isto é só o retorno visual de que o golpe entrou.
 */

/** Cores (PIXI, 0xRRGGBB). */
export const FLOAT_COLORS = Object.freeze({
  damage: 0xff4d4d,
  heal: 0x4ddc6b,
  shield: 0x5aa9ff,
  energy: 0xb07cff,
  casco: 0xe0a84a
});

/**
 * Valores acompanhados por tipo de Ator, na ordem em que aparecem (de fora para dentro: o
 * Escudo antes da Vida, como o golpe atravessa). `label` vazio = só o número (a Vida, que é o
 * caso mais comum e não precisa de nome). `ownerOnly` = só o dono e o Mestre veem.
 */
export const VITAL_TRACKS = Object.freeze({
  character: [
    { key: "shield", path: "attributes.shield.value", label: "Escudo", color: "shield" },
    { key: "hp", path: "attributes.hp.value", label: "", color: "vital" },
    { key: "energy", path: "attributes.energy.value", label: "Mana", color: "energy", ownerOnly: true }
  ],
  ship: [
    { key: "shields", path: "shields.value", label: "Escudo", color: "shield" },
    { key: "casco", path: "casco.value", label: "Casco", color: "casco" },
    { key: "hull", path: "hull.value", label: "Integridade", color: "vital" }
  ]
});

function readPath(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/** Os valores acompanhados de uma ficha (`actor.system`), como números. */
export function vitalSnapshot(system, tracks) {
  const snap = {};
  for (const t of tracks) {
    const n = Number(readPath(system, t.path));
    if (Number.isFinite(n)) snap[t.key] = n;
  }
  return snap;
}

/**
 * O que mudou entre duas leituras, já como texto e cor. Valores ausentes em qualquer lado são
 * ignorados (não inventa um "−50" de uma ficha que ainda não tinha sido lida).
 * @param {object} before
 * @param {object} after
 * @param {Array} tracks - `VITAL_TRACKS.character` ou `.ship`
 * @param {{labels?: object}} [opts] - rótulos por chave (ex.: o nome configurado da Mana)
 * @returns {Array<{key:string, delta:number, text:string, fill:number, ownerOnly:boolean}>}
 */
export function vitalDeltas(before, after, tracks, { labels = {} } = {}) {
  const out = [];
  for (const t of tracks) {
    if (!(t.key in (before ?? {})) || !(t.key in (after ?? {}))) continue;
    const delta = Math.round(after[t.key] - before[t.key]);
    if (!delta) continue;
    const sign = delta > 0 ? "+" : "−";
    const label = labels[t.key] ?? t.label;
    const fill = t.color === "vital" ? (delta < 0 ? FLOAT_COLORS.damage : FLOAT_COLORS.heal) : FLOAT_COLORS[t.color];
    out.push({ key: t.key, delta, text: `${sign}${Math.abs(delta)}${label ? ` ${label}` : ""}`, fill, ownerOnly: Boolean(t.ownerOnly) });
  }
  return out;
}
