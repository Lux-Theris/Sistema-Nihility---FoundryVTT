/**
 * Sorte (8d.1) — o modificador de dado do Foundry. Registrado no `init`: `lu<n>` (sorte) e `ul<n>`
 * (azar) re-sorteiam cada resultado ATIVO do termo com os pesos da curva (luck-rules.js). Como mexe
 * em `term.results`, o chat e o Dice So Nice mostram as faces finais. Sem sorte ele nem é posto na
 * fórmula (applyLuckToFormula).
 */
import { parseLuckModifier, sampleLuckFace } from "./luck-rules.js";

export function registerLuckDice() {
  const Die = foundry.dice?.terms?.Die ?? globalThis.Die;
  if (!Die || Die.MODIFIERS?.lu) return;
  Die.MODIFIERS.lu = "luck";
  Die.MODIFIERS.ul = "luck";
  Die.prototype.luck = function luck(modifier) {
    const value = parseLuckModifier(modifier);
    if (value === null) return false;
    for (const r of this.results) {
      if (!r.active || r.rerolled || r.exploded) continue;
      r.result = sampleLuckFace(this.faces, value);
    }
    return undefined;
  };
}
