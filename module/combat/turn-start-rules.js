/**
 * Início de turno: regras puras (sem Foundry). A ordem dos passos mora aqui, em `TURN_STEP_IDS` e
 * `STOPPED_STEP_IDS`, e é congelada por teste; `turn-start.js` liga cada id ao seu código.
 */

/** Posição do turno na ordem do combate: rodada*1000 + turno. Serve para só processar turno NOVO. */
export function turnPosition(round, turn) {
  return (Number(round) || 0) * 1000 + (Number(turn) || 0);
}

/** O turno nesta posição já foi processado? `processed` é o que está guardado no Combate (pode faltar). */
export function alreadyProcessed(position, processed) {
  return processed != null && position <= Number(processed);
}

/**
 * O que fazer com uma mudança de turno/rodada. Usada pelo início de turno E pela foto do Reverter
 * (`time-rewind.js`), para os dois nunca discordarem sobre o que é um turno novo.
 *  - "back": "Turno/Rodada anterior" do Foundry (`direction` −1). Nada roda.
 *  - "new": turno além do último processado. Roda a cadeia (e o Reverter fotografa).
 *  - "again": "próximo" (`direction` +1) caindo num turno já processado (voltou e avançou de novo). Nada roda.
 *  - "reset": edição à mão (sem `direction`: janela do Combate, macro) para um turno que fica para trás do
 *    último processado. O contador recomeça dali SEM cobrar o turno editado; o próximo avanço já é "new".
 *    Antes disso, editar a rodada 6 → 1 travava todos os ticks até o combate passar da rodada 6 de novo.
 * @param {{position:number, processed:(number|string|null|undefined), direction:(number|undefined)}} args
 * @returns {"back"|"new"|"again"|"reset"}
 */
export function turnStartKind({ position, processed, direction }) {
  if (direction < 0) return "back";
  if (!alreadyProcessed(position, processed)) return "new";
  return direction === undefined || direction === null ? "reset" : "again";
}

/**
 * Roda os passos em ordem. Cada passo é `{ id, label, when?(ctx), run(ctx) }`.
 * `when` é avaliado na hora, logo antes do passo (um passo anterior pode ter mudado o ctx).
 * Um passo que falha chama `report(label, err)` e NÃO impede os seguintes.
 */
export async function runTurnSteps(steps, ctx, report) {
  for (const step of steps) {
    try {
      if (step.when && !step.when(ctx)) continue;
      await step.run(ctx);
    } catch (err) {
      report(step.label, err);
    }
  }
}

/** Ramo normal, na ordem em que rodam. Mudar a ordem muda as regras: o teste congela esta lista. */
export const TURN_STEP_IDS = [
  "timeRhythm",
  "incapacitation",
  "skillTimers",
  "deadSnapshot",
  "contagion",
  "environment",
  "radiation",
  "radiationAccrued",
  "structureContact",
  "antimagic",
  "zonesStructures",
  "zoneCombatant",
  "surfaces",
  "surfaceCombatant",
  "periodicEffects",
  "regeneration",
  "upkeepRemoval",
  "upkeepDrain",
  "curses",
  "announce",
  "starshipPower"
];

/** Ramo "Parado no tempo", na ordem. */
export const STOPPED_STEP_IDS = [
  "stoppedTimeEnd",
  "stoppedZones",
  "stoppedSurfaces",
  "stoppedNotice"
];
