/**
 * Reviver (1.123.0), regras puras e testadas (`test/magic-pieces.test.mjs`).
 *
 * Efeito de Skill (alvo `revive`): **só age em quem está morto** (o "Derrotado" do core: NPC em Vida 0, ou "Marcar como
 * morto" do Mestre). Tira o "morto" e põe a Vida em X (pontos, ou % da máxima). Caído vivo não é alvo: Caído sai com
 * cura comum (Vida acima de 0 → Inconsciente → acorda), que já é como funciona. Um corpo já predado (Predação)
 * não revive: foi consumido.
 */

/** Por que este alvo não pode ser revivido agora, ou null se pode. */
export function reviveBlockReason({ dead = false, predated = false, isCharacter = true } = {}) {
  if (!isCharacter) return "só Personagens revivem";
  if (!dead) return "não está morto (cura comum levanta quem está Caído)";
  if (predated) return "o corpo foi consumido (Predação)";
  return null;
}

/** A Vida com que volta: pontos (≥ 1) ou % da máxima, sem passar da máxima. */
export function reviveHp(amount, { percent = false, max = 1 } = {}) {
  const cap = Math.max(1, Math.round(Number(max) || 1));
  const raw = percent ? (cap * (Number(amount) || 0)) / 100 : Number(amount) || 0;
  return Math.min(cap, Math.max(1, Math.round(raw)));
}

/** "revive com 10 de Vida" / "revive com 50% da Vida". */
export function reviveSentence(entry) {
  const n = Math.max(0, Math.round(Number(entry?.amount) || 0));
  return entry?.amountMode === "percentMax" ? `revive com ${n}% da Vida` : `revive com ${n} de Vida`;
}

/** A linha do resultado no card. */
export function reviveResultText({ name = "", hp = 0, refusal = null } = {}) {
  return refusal ? `Reviver: ${name} ${refusal}` : `${name} revive com ${hp} de Vida`;
}
