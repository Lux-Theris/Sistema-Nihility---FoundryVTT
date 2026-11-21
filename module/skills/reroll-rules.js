/**
 * Rerrolar (item 8d.2) — regras PURAS, testadas (test/reroll-dispel.test.mjs). Sem imports de propósito.
 *
 * Uma Skill de mecânica "reroll" é usada DEPOIS de ver uma rolagem, a partir do botão "🎲 Rerrolar" que
 * aparece no card dela no chat. Quais rolagens ela alcança é a conta de `rerollReaches` (de quem + que
 * tipo); o que fica (novo, melhor, pior ou escolher na hora, só Ultimate) é `pickKept`.
 *
 * Tipos de rolagem guardados no flag `nihilityRoll.kind` da mensagem: attribute, initiative, damage,
 * predation e overdraw. Os dois d100 com card próprio (predation, overdraw) contam como o grupo
 * "chances" na hora de a Skill decidir se alcança; num d100 de chance o MENOR resultado é o melhor.
 */

export const REROLL_WHO = ["own", "allies", "any"];
export const REROLL_WHO_LABELS = {
  own: "só as minhas",
  allies: "as minhas e as de aliados",
  any: "de qualquer um (inclusive do Mestre)"
};

export const REROLL_KEEP = ["new", "best", "worst", "choose"];
export const REROLL_KEEP_LABELS = {
  new: "fica o novo",
  best: "fica o melhor dos dois",
  worst: "fica o pior dos dois",
  choose: "quem usa escolhe na hora"
};

/** Os grupos que a Skill marca (caixas) e o que cada um cobre. */
export const REROLL_KIND_KEYS = ["attribute", "initiative", "damage", "chances"];
export const REROLL_KIND_LABELS = {
  attribute: "Atributo",
  initiative: "Iniciativa",
  damage: "Dano ainda não aplicado",
  chances: "Chances (d100 de Predação e de passar da Mana)"
};

/** Tipo de rolagem da mensagem → grupo de caixas da Skill. */
const GROUP_OF_ROLL = { attribute: "attribute", initiative: "initiative", damage: "damage", predation: "chances", overdraw: "chances" };

export function rerollGroupOf(rollKind) {
  return GROUP_OF_ROLL[rollKind] ?? null;
}

/** Num d100 de chance (sucesso = ≤ chance) o resultado BAIXO é o melhor. */
export function lowerIsBetter(rollKind) {
  return rerollGroupOf(rollKind) === "chances";
}

/** As quatro caixas, com todas ligadas quando nada foi guardado. */
export function normalizeRerollKinds(kinds) {
  const out = {};
  for (const key of REROLL_KIND_KEYS) out[key] = kinds && typeof kinds === "object" && key in kinds ? Boolean(kinds[key]) : true;
  return out;
}

export function rerollKindsLabel(kinds) {
  const k = normalizeRerollKinds(kinds);
  const parts = REROLL_KIND_KEYS.filter(key => k[key]).map(key => ({ attribute: "atributo", initiative: "iniciativa", damage: "dano", chances: "chances" }[key]));
  return parts.join(", ");
}

/** Quem rolou em relação a quem tem a Skill: "own" (o mesmo Ator), "ally" ou "other". */
export function rerollRelation({ same = false, ally = false } = {}) {
  if (same) return "own";
  return ally ? "ally" : "other";
}

export function rerollWhoReaches(who, relation) {
  if (who === "any") return true;
  if (who === "allies") return relation === "own" || relation === "ally";
  return relation === "own";
}

/** A Skill alcança esta rolagem? (`mech` com rerollWho/rerollKinds; `rollKind` do flag da mensagem.) */
export function rerollReaches(mech, { rollKind, relation }) {
  const group = rerollGroupOf(rollKind);
  if (!group) return false;
  if (!normalizeRerollKinds(mech?.rerollKinds)[group]) return false;
  return rerollWhoReaches(REROLL_WHO.includes(mech?.rerollWho) ? mech.rerollWho : "own", relation);
}

/** "Escolher na hora" só vale numa Skill Ultimate; nas outras cai no "novo". */
export function rerollKeepFor(keep, tier) {
  const k = REROLL_KEEP.includes(keep) ? keep : "new";
  if (k === "choose" && tier !== "ultimate") return "new";
  return k;
}

/** Os modos que o editor oferece para um Tier. */
export function rerollKeepOptions(tier) {
  return REROLL_KEEP.filter(k => k !== "choose" || tier === "ultimate");
}

/** Qual dos dois resultados fica ("old" | "new"). Empate: o novo. */
export function pickKept({ keep, oldTotal, newTotal, lower = false }) {
  const a = Number(oldTotal);
  const b = Number(newTotal);
  if (keep === "best" || keep === "worst") {
    if (a === b) return "new";
    const newIsHigher = b > a;
    const wantHigher = (keep === "best") !== lower;
    return newIsHigher === wantHigher ? "new" : "old";
  }
  return "new";
}

export function keepWord(keep) {
  return { new: "o novo", best: "o melhor", worst: "o pior" }[keep] ?? "o novo";
}

/* ------------------------------------------------------------------ Dano */

/** Razão para refazer um card de dano: total bruto que fica ÷ total bruto antigo (null se não dá para contar). */
export function damageRatio(oldTotal, keptTotal) {
  const a = Number(oldTotal);
  const b = Number(keptTotal);
  if (!(a > 0) || !Number.isFinite(b) || b < 0) return null;
  return b / a;
}

/** Uma entrada de `damageApply` com o dano escalado (só o que depende do total: dano final, base do Escudo e o extra). */
export function scaleDamageEntry(entry, ratio) {
  if (!entry || !Number.isFinite(ratio) || ratio < 0) return entry;
  const scale = value => Math.round((Number(value) || 0) * ratio);
  return {
    ...entry,
    amount: scale(entry.amount),
    shieldBase: scale(entry.shieldBase ?? entry.amount),
    shieldExtra: scale(entry.shieldExtra)
  };
}

/** O bloco de flags do sistema de um card de dano, escalado (`damageApply` ou `damageApplyMany`). */
export function scaleDamageFlags(flags, ratio) {
  if (!flags) return flags;
  const out = { ...flags };
  if (out.damageApply) out.damageApply = scaleDamageEntry(out.damageApply, ratio);
  if (out.damageApplyMany?.entries) out.damageApplyMany = { ...out.damageApplyMany, entries: out.damageApplyMany.entries.map(e => scaleDamageEntry(e, ratio)) };
  return out;
}

/** O card de dano ainda não foi aplicado em ninguém (nenhuma entrada com `applied`)? */
export function damageCardRerollable(flags) {
  const entries = flags?.damageApplyMany?.entries ?? (flags?.damageApply ? [flags.damageApply] : []);
  return entries.length > 0 && entries.every(e => !e?.applied);
}

/* ------------------------------------------------------------------ Predação */

/** Troca o d100 de uma Skill do card da Predação e refaz o "ganhou/perdeu". */
export function replacePredationRoll(results, skillId, roll) {
  const value = Math.min(100, Math.max(1, Math.round(Number(roll) || 1)));
  return (results ?? []).map(r => (r.skillId === skillId ? { ...r, roll: value, won: value <= Number(r.chance) } : r));
}

/* ------------------------------------------------------------------ Texto, aviso, custo */

/** "reage a rolagens: de aliados, atributo e dano · fica o melhor". */
export function rerollSentence(mech) {
  const who = { own: "as próprias", allies: "as de aliados", any: "as de qualquer um" }[REROLL_WHO.includes(mech?.rerollWho) ? mech.rerollWho : "own"];
  const keep = REROLL_KEEP.includes(mech?.rerollKeep) ? mech.rerollKeep : "new";
  const keepText = keep === "choose" ? "escolhe qual fica" : `fica ${keepWord(keep)}`;
  return `reage a rolagens (${who}: ${rerollKindsLabel(mech?.rerollKinds) || "nenhuma"}) · ${keepText}`;
}

/** Avisos do editor para uma Skill de Rerrolar. */
export function rerollLint(mech) {
  const out = [];
  if (!REROLL_KIND_KEYS.some(k => normalizeRerollKinds(mech?.rerollKinds)[k])) {
    out.push({ code: "rerollNoKinds", level: "hard", tab: "mechanic", effect: null, text: "Rerrolar sem nenhum tipo de rolagem marcado: nunca aparece o botão." });
  }
  if (mech?.hasUpkeep) {
    out.push({ code: "rerollActive", level: "hard", tab: "mechanic", effect: null, text: "Rerrolar é usada no chat, na hora: uma Habilidade Ativa não funciona aqui." });
  }
  if (Number(mech?.prepTurns) > 0) {
    out.push({ code: "rerollPrep", level: "soft", tab: "general", effect: null, text: "Rerrolar com Preparo: o botão não aparece até ela estar pronta (use Recarga para limitar)." });
  }
  if (mech?.rerollKeep === "choose" && mech?.tier !== "ultimate") {
    out.push({ code: "rerollChoose", level: "soft", tab: "mechanic", effect: null, text: "\"Escolher na hora\" só vale numa Skill Ultimate; aqui ela fica com o novo." });
  }
  return out;
}

/** Saneia os campos de uma mecânica de Rerrolar (IA, pedido, modelo). */
export function sanitizeRerollFields(m) {
  return {
    rerollWho: REROLL_WHO.includes(m?.rerollWho) ? m.rerollWho : "own",
    rerollKeep: REROLL_KEEP.includes(m?.rerollKeep) ? m.rerollKeep : "new",
    rerollKinds: normalizeRerollKinds(m?.rerollKinds)
  };
}

/** Linha do card novo: "rerrolado por X · fica o melhor (12 → 17)". */
export function rerollNoteText({ who, keep, oldTotal, newTotal, kept }) {
  const how = keep === "choose" ? `escolheu ${kept === "new" ? "o novo" : "o antigo"}` : `fica ${keepWord(keep)}`;
  return `rerrolado por ${who} · ${how} (${oldTotal} → ${newTotal})`;
}

/** Quanto tempo (minutos, relógio real) uma rolagem pode ser rerrolada. Decidido em 21/11: 10 minutos. */
export const REROLL_WINDOW_MINUTES = 10;

/**
 * A rolagem ainda pode ser rerrolada? `timestamp` e `now` em ms. Sem data conhecida, vale (não escondemos por dúvida).
 * Achado do teste de 21/11: o botão aparecia em rolagens de horas atrás, de um combate já encerrado.
 */
export function rerollWindowOpen(timestamp, now, minutes = REROLL_WINDOW_MINUTES) {
  const t = Number(timestamp);
  if (!Number.isFinite(t) || t <= 0) return true;
  return Number(now) - t <= minutes * 60 * 1000;
}
