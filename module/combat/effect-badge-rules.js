/**
 * O número no canto do ícone de efeito no Token (backlog L3; mockup aprovado "Avisos na Tela",
 * quadro 3) — a parte pura e testada. Quem lê os efeitos e desenha é `combat/effect-badges.js`.
 *
 * Tons: `time` (amarelo) rodadas/ticks que faltam; `anchor` (ciano, "∞") até desligar a Skill
 * Ativa; `radiation` (verde-limão) nível de irradiação; `danger` (vermelho) contador do Caído ou
 * do Inconsciente. Sem prazo (Ambiente, Maldição, marcada à mão) → sem número.
 */

export const BADGE_COLORS = {
  time: 0xffcf5c,
  anchor: 0x6ee7ff,
  radiation: 0xc6ff00,
  danger: 0xff5c5c
};

function positiveInt(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.ceil(n) : null;
}

/**
 * @param {{radiationLevel?:number, incapacitation?:{kind?:string, rounds?:number|null, stabilized?:boolean}|null,
 *          environment?:boolean, curse?:boolean, periodic?:boolean, ticksRemaining?:number|null,
 *          anchored?:boolean, finite?:number, rounds?:number|null}} info
 * @returns {{text: string, tone: "time"|"anchor"|"radiation"|"danger"}|null}
 */
export function effectBadge(info = {}) {
  const level = positiveInt(info.radiationLevel);
  if (level) return { text: String(level), tone: "radiation" };

  const inc = info.incapacitation;
  if (inc?.kind) {
    if (inc.kind === "fallen" && inc.stabilized) return null;
    const rounds = positiveInt(inc.rounds);
    return rounds ? { text: String(rounds), tone: "danger" } : null;
  }

  if (info.environment || info.curse) return null;

  if (info.periodic) {
    const ticks = positiveInt(info.ticksRemaining);
    if (ticks) return { text: String(ticks), tone: "time" };
    return info.anchored ? { text: "∞", tone: "anchor" } : null;
  }

  if (info.anchored) {
    const finite = Number(info.finite);
    return Number.isFinite(finite) && finite > 0 ? { text: String(Math.ceil(finite)), tone: "time" } : { text: "∞", tone: "anchor" };
  }
  const rounds = positiveInt(info.rounds);
  return rounds ? { text: String(rounds), tone: "time" } : null;
}
