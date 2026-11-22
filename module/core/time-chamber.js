/**
 * Câmaras do tempo (J9b, 8b.2): o comportamento de Região "Ritmo do tempo (Nihility)" (`nihilityTimeRate`).
 * Regras puras em calendar-rules.js (`normalizeChamber`, `chamberSummary`, `chamberResultText`); a leitura
 * das Regiões de um Token e o ritmo pessoal ficam em world-time.js (`tokenChambers`, `personalRateFactors`).
 *
 * Uma Região com este comportamento é uma sala dentro do mapa cujo tempo corre diferente: o ritmo pessoal de
 * quem está dentro = ritmo da linha da cena × ritmo da Região. A data e a escuridão mostradas continuam as da
 * CENA (a câmara só muda o tempo de quem está dentro). Campos: `rate` (segundos dentro por segundo fora,
 * 10⁻¹⁰…10⁶), `combatWorld` ("stop" = o mundo para durante o combate; "atEnd" = anda no fim) e `network`
 * ("tem rede": soma ao da cena; o PAD de quem está dentro mostra a hora local ao vivo).
 *
 * Em TOKEN_ENTER/TOKEN_EXIT (que chegam a TODOS os clientes) só o Mestre designado escreve: guarda a data do
 * aparelho (`settleDevices`) e regrava o trecho pessoal (`syncPersonalTime`). Ligar, desligar, editar ou
 * apagar o comportamento com gente dentro regrava quem está lá.
 */
import { SYSTEM_ID, isWorldClockEnabled, isCalendarEnabled } from "./config.js";
import { isDesignatedGm } from "../helpers/gm-relay.js";
import { escapeHtml } from "../helpers/html.js";
import {
  TIME_RATE_BEHAVIOR, RATE_UNITS, chamberSummary, chamberResultText, rateFromUnits, rateInputs, clampRate
} from "./calendar-rules.js";
import {
  getCalendar, tokenChambers, settleDevices, syncPersonalTime, sceneHasNetwork
} from "./world-time.js";

export { TIME_RATE_BEHAVIOR };

/**
 * Um Token entrou (`enter`) ou saiu (`exit`) da Região do comportamento. Só o Mestre designado, só com o
 * Relógio e o calendário ligados. Antes de o ritmo mudar, o aparelho guarda a data que mostrava.
 */
export async function handleChamberMove(behavior, tokenDocument, kind) {
  if (!isDesignatedGm() || !isWorldClockEnabled() || !isCalendarEnabled()) return "off";
  if (!behavior || behavior.disabled || !tokenDocument) return "off";
  const actor = tokenDocument.actor;
  if (!actor) return "noActor";
  const scene = tokenDocument.parent;
  // "Tem rede" de antes do movimento: a da cena mais a das câmaras em que ele ainda estava.
  const before = chamberSummary(tokenChambers(tokenDocument, kind === "enter" ? { exit: behavior } : { enter: behavior }));
  await settleDevices([actor], scene, { network: sceneHasNetwork(scene) || before.network });
  await syncPersonalTime(actor, kind === "enter" ? { enter: behavior } : { exit: behavior });
  return kind;
}

/** O comportamento mudou (ligou, desligou, ritmo novo, apagou): regrava quem está dentro da Região. */
async function resyncInside(behavior) {
  if (!isDesignatedGm() || !isWorldClockEnabled() || !isCalendarEnabled()) return;
  const region = behavior.parent;
  const scene = region?.parent;
  for (const token of region?.tokens ?? []) {
    const actor = token.actor;
    if (!actor) continue;
    try {
      await settleDevices([actor], scene);
      await syncPersonalTime(actor);
    } catch (err) {
      console.warn(`${SYSTEM_ID} | Câmara do tempo: não consegui ajustar "${actor.name}".`, err);
    }
  }
}

/* ------------------------------------------------------------------ Comportamento de Região */

function defineBehaviorType() {
  const { fields } = foundry.data;
  const Base = foundry.data.regionBehaviors.RegionBehaviorType;
  const E = CONST.REGION_EVENTS;
  const events = {};
  for (const [event, kind] of [[E.TOKEN_ENTER, "enter"], [E.TOKEN_EXIT, "exit"]]) {
    events[event] = async function (eventData) {
      const token = eventData.data?.token;
      if (token) await handleChamberMove(this.behavior ?? this.parent, token, kind);
    };
  }
  return class TimeRateRegionBehavior extends Base {
    static defineSchema() {
      return {
        rate: new fields.NumberField({
          nullable: false, initial: 1,
          label: "Ritmo (segundos dentro por segundo fora)",
          hint: "1 = tempo normal. Menor que 1 = mais lento por dentro (0,001: um segundo dentro, mil lá fora); maior que 1 = mais rápido (60: um minuto dentro por segundo lá fora). Limite: 10⁻¹⁰ a 10⁶. Multiplica o ritmo da linha da cena."
        }),
        combatWorld: new fields.StringField({
          initial: "stop", choices: { stop: "O mundo para durante o combate", atEnd: "O mundo anda no fim do combate" },
          label: "Combate aqui", hint: "Num combate com ritmo diferente de 1, o tempo da rodada vai só para os combatentes (o mundo para) ou fica guardado e lá fora passa tudo de uma vez ao acabar. Com ritmos diferentes entre os combatentes, vale o da maioria."
        }),
        network: new fields.BooleanField({
          initial: false, label: "Tem rede",
          hint: "Quem está aqui dentro vê no PAD a hora da linha ao vivo (soma ao \"tem rede\" da cena)."
        })
      };
    }

    static events = events;
  };
}

/* ------------------------------------------------------------------ A janela do comportamento */

const UNIT_OPTIONS = RATE_UNITS.map(([id, , plural]) => ({ id, label: plural }));

function unitSelect(name, selected) {
  return `<select data-nch="${name}">${UNIT_OPTIONS.map(u => `<option value="${u.id}" ${u.id === selected ? "selected" : ""}>${escapeHtml(u.label)}</option>`).join("")}</select>`;
}

/** Põe sob o campo "Ritmo" a linha "N unidade dentro = M unidade fora" e a frase do resultado. */
function enhanceConfig(app, html) {
  const behavior = app.document ?? app.behavior;
  if (behavior?.type !== TIME_RATE_BEHAVIOR) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  const input = root?.querySelector('[name="system.rate"]');
  if (!input || root.querySelector(".nihility-chamber-helper")) return;
  input.step = "any"; // ritmos como 3e-9 não são múltiplos do passo padrão do campo
  const cal = getCalendar();
  const start = rateInputs(cal, clampRate(input.value));
  const box = document.createElement("div");
  box.className = "nihility-chamber-helper";
  box.innerHTML = `<div class="nch-row">
      <input type="number" min="0" step="any" data-nch="inValue" value="${start.inside.value}"/>${unitSelect("inUnit", start.inside.unit)}
      <span>dentro =</span>
      <input type="number" min="0" step="any" data-nch="outValue" value="${start.outside.value}"/>${unitSelect("outUnit", start.outside.unit)}
      <span>fora</span>
    </div>
    <p class="nch-result"></p>`;
  (input.closest(".form-group") ?? input).after(box);
  const result = box.querySelector(".nch-result");
  const field = name => box.querySelector(`[data-nch="${name}"]`);
  const showResult = () => {
    result.textContent = chamberResultText(cal, input.value);
  };
  const fromUnits = () => {
    const rate = rateFromUnits(cal, { value: Number(field("inValue").value), unit: field("inUnit").value }, { value: Number(field("outValue").value), unit: field("outUnit").value });
    input.value = String(Number(rate.toPrecision(10)));
    showResult();
  };
  for (const el of box.querySelectorAll("[data-nch]")) el.addEventListener("input", fromUnits);
  input.addEventListener("input", showResult);
  showResult();
}

/* ------------------------------------------------------------------ Registro */

export function registerTimeChamber() {
  if (foundry.data?.regionBehaviors?.RegionBehaviorType && CONFIG.RegionBehavior) {
    CONFIG.RegionBehavior.dataModels[TIME_RATE_BEHAVIOR] = defineBehaviorType();
    CONFIG.RegionBehavior.typeIcons ??= {};
    CONFIG.RegionBehavior.typeIcons[TIME_RATE_BEHAVIOR] = "fa-solid fa-hourglass-half";
  }
  const changed = behavior => {
    if (behavior.type === TIME_RATE_BEHAVIOR) resyncInside(behavior).catch(err => console.warn(`${SYSTEM_ID} | Câmara do tempo:`, err));
  };
  Hooks.on("createRegionBehavior", changed);
  Hooks.on("updateRegionBehavior", changed);
  Hooks.on("deleteRegionBehavior", changed);
  Hooks.on("renderRegionBehaviorConfig", enhanceConfig);
}
