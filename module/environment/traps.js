/**
 * Armadilhas de Região (I1). Regras puras em trap-rules.js. Bloco `FEATURES.traps`.
 *
 * Uma armadilha é um comportamento de Região do sistema, "Armadilha (Nihility)" (`nihilityTrap`) — não
 * uma Estrutura: não precisa de quem lançou, nem de Mana. O Mestre desenha a Região (o core a esconde
 * dos jogadores) e acrescenta o comportamento.
 *
 *  - Dispara em TOKEN_ENTER do core: andar, ser empurrado (J1) e o teleporte do Mestre são movimento
 *    de verdade e disparam igual. Só Personagem, e só o Mestre designado escreve (o evento chega a
 *    todos os clientes).
 *  - "Só no chão" = elevação do Token entre −0,5 e 0,5 m (quem voa ou está enterrado passa); "qualquer
 *    altura" = só o teste da própria Região (o Mestre ajusta topo e base dela).
 *  - Dano: rola a fórmula e passa pelas defesas do alvo (`applyDamageReductions`: Resistência,
 *    Imunidade, Vantagem entre elementos), e o card sai com Aplicar e o rastro do Mestre — o mesmo
 *    caminho do contato de Estrutura. Condição: a do catálogo com o efeito padrão dela (`hitPercent`
 *    usa o dano final do disparo).
 *  - "Uma vez": o comportamento se desliga ao disparar (o Mestre o religa para armar de novo).
 *    "Mostrar": a Região fica visível a todos depois de disparar.
 *  - Mágica/tecnológica: um campo fechado de Antimagia/Interferência de nível ≥ o dela, dentro ou
 *    tocando a Região, a desarma (não dispara; o comportamento se desliga e o Mestre recebe um card).
 *    Uma Antimagia/PEM em Emissão que toca a Região a desarma se o alcance ≥ nível (`disarmTrapsInArea`).
 */
import {
  SYSTEM_ID, getActiveDamageElements, getActiveStatusConditions, getActiveTraits, actorTraits, isTrapsEnabled, isElevationEnabled
} from "../core/config.js";
import { isDesignatedGm } from "../helpers/gm-relay.js";
import { reportError } from "../helpers/report.js";
import { escapeHtml } from "../helpers/html.js";
import { areaTouchesStructure } from "../structures/structure-geometry.js";
import { tokenElevation } from "../helpers/foundry-compat.js";
import {
  normalizeTrap, trapShouldFire, trapImmune, trapDisarmedByField, trapDisarmedByEmission, polygonSegments
} from "./trap-rules.js";

export const TRAP_BEHAVIOR = "nihilityTrap";

/** Armadilhas "uma vez" que já dispararam e esperam o desligamento chegar (evita dois Tokens juntos). */
const spent = new Set();

/** Os lados da Região (todos os polígonos), em pixels da cena. */
export function regionSegments(region) {
  const out = [];
  try {
    for (const polygon of region?.polygons ?? []) out.push(...polygonSegments(polygon.points ?? []));
  } catch (err) {
    /* Região sem polígonos calculados */
  }
  return out;
}

function gmIds() {
  return game.users.filter(u => u.isGM).map(u => u.id);
}

async function gmNote(html) {
  await ChatMessage.create({ content: html, whisper: gmIds() });
}

/** Desliga o comportamento (disparou uma vez, ou foi desarmado). */
async function switchOff(behavior) {
  try {
    await behavior.update({ disabled: true });
  } catch (err) {
    reportError("Armadilha: não consegui desligar o comportamento.", err, { gmOnly: true });
  }
}

/** Mostra a Região a todos (a armadilha foi descoberta). */
async function revealRegion(region) {
  try {
    const always = CONST.REGION_VISIBILITY?.ALWAYS ?? 2;
    if (region.visibility !== always) await region.update({ visibility: always });
  } catch (err) {
    console.warn(`${SYSTEM_ID} | Armadilha: não consegui mostrar a Região.`, err);
  }
}

function trapName(behavior) {
  return behavior.name || behavior.parent?.name || "Armadilha";
}

/** Dano da armadilha em quem entrou: rola, aplica as defesas dele e posta o card com Aplicar. */
async function dealTrapDamage(trap, behavior, tokenDocument) {
  const target = tokenDocument.actor;
  let roll;
  try {
    roll = await new Roll(trap.formula).evaluate();
  } catch (err) {
    console.warn(`${SYSTEM_ID} | Armadilha com fórmula inválida em ${trapName(behavior)}: ${trap.formula}`, err);
    return 0;
  }
  const { applyDamageReductions, triggeredLabel, personalTraceTail } = await import("../combat/damage-roll.js");
  const { damageApplyFlags, withDamageTrace } = await import("../combat/damage-apply.js");
  const { cardReactions, reactionLabel } = await import("../combat/reactions.js");
  const mech = { damageElements: trap.elements, isMagicDamage: trap.magicDamage, isAbsoluteDamage: false };
  const reduction = applyDamageReductions(roll.total, mech, target, { attacker: null });
  const label = trapName(behavior);
  await roll.toMessage({
    speaker: { alias: label },
    flavor: `${label} — ${tokenDocument.name}: ${reduction.finalDamage}${reactionLabel(reduction.reactions)}${triggeredLabel(reduction.triggeredConditions)}`,
    flags: withDamageTrace(
      damageApplyFlags(target, reduction.finalDamage, {
        reactions: cardReactions(reduction.reactions),
        shieldBase: reduction.shieldBase,
        elementIds: reduction.elementIds,
        shieldExtra: reduction.shieldExtra ?? 0,
        shieldMultiplier: reduction.shieldMultiplier ?? 1,
        shieldPenetration: reduction.shieldPenetration ?? 0,
        triggeredConditions: reduction.triggeredConditions ?? [],
        sever: reduction.sever,
        label
      }),
      [{ name: tokenDocument.name, rows: [{ label: "Rolagem (armadilha)", value: String(roll.total) }, ...personalTraceTail(reduction, target)] }]
    )
  });
  return reduction.finalDamage;
}

/**
 * Alguém entrou na Região com o comportamento de armadilha. Só o Mestre designado, só Personagem.
 * Devolve o que aconteceu ("fired"/"disarmed"/outro motivo) para teste e depuração.
 */
export async function handleTrapEnter(behavior, tokenDocument) {
  if (!isDesignatedGm() || !isTrapsEnabled() || !behavior || behavior.disabled || !tokenDocument) return "off";
  const actor = tokenDocument.actor;
  if (!actor || actor.type !== "character") return "notCharacter";
  const trap = normalizeTrap(behavior.system);
  const region = behavior.parent;
  const scene = region?.parent ?? tokenDocument.parent;

  // Campo de Antimagia/Interferência que toca a Região desarma a armadilha mágica/tecnológica.
  if ((trap.magic || trap.tech) && scene) {
    const { fieldLevelsTouching } = await import("../structures/structures.js");
    const won = trapDisarmedByField(trap, fieldLevelsTouching(scene, regionSegments(region)));
    if (won) {
      await switchOff(behavior);
      await gmNote(`<p><i class="fa-solid fa-shield-halved"></i> <strong>${escapeHtml(trapName(behavior))}</strong> foi desarmada por um campo de ${won === "magic" ? "Antimagia" : "Interferência"} quando <strong>${escapeHtml(tokenDocument.name)}</strong> entrou.</p>`);
      return "disarmed";
    }
  }

  if (trap.trigger === "once" && spent.has(behavior.uuid)) return "spent";
  const verdict = trapShouldFire(trap, {
    elevation: tokenElevation(tokenDocument),
    immune: trapImmune(trap, actorTraits(actor)),
    elevationOn: isElevationEnabled()
  });
  if (!verdict.fire) return verdict.reason;

  if (trap.trigger === "once") spent.add(behavior.uuid);
  let damage = 0;
  try {
    if (trap.formula) damage = await dealTrapDamage(trap, behavior, tokenDocument);
    if (trap.conditionId) {
      const condition = getActiveStatusConditions().find(c => c.id === trap.conditionId);
      if (condition) {
        const { applyCondition } = await import("./environment.js");
        await applyCondition(actor, condition, damage);
      }
    }
  } catch (err) {
    reportError(`Armadilha: falha ao disparar em ${tokenDocument.name}.`, err, { gmOnly: true });
  }
  if (trap.trigger === "once") await switchOff(behavior);
  if (trap.reveal && region) await revealRegion(region);
  return "fired";
}

/**
 * Antimagia/PEM em Emissão: desarma as armadilhas de Região que a área toca, se o alcance (nível da
 * Skill × alcance) ≥ o nível delas e a natureza bate. Lado do Mestre. Devolve as linhas do chat.
 * @param {Scene} scene
 * @param {object} area - área já normalizada (normalizeArea)
 * @param {Array<"magic"|"tech">} kinds - os tipos que a Skill aplica
 * @param {number} reach - alcance da Skill
 */
export async function disarmTrapsInArea(scene, area, kinds, reach) {
  if (!isTrapsEnabled() || !scene || !area) return [];
  const lines = [];
  for (const region of scene.regions ?? []) {
    for (const behavior of region.behaviors ?? []) {
      if (behavior.type !== TRAP_BEHAVIOR || behavior.disabled) continue;
      const trap = normalizeTrap(behavior.system);
      if (!trap.magic && !trap.tech) continue;
      if (!areaTouchesStructure(area, regionSegments(region), true)) continue;
      if (!kinds.some(kind => trapDisarmedByEmission(trap, kind, reach))) continue;
      await switchOff(behavior);
      lines.push(`${trapName(behavior)}: desarmada`);
    }
  }
  return lines;
}

/* ------------------------------------------------------------------ Comportamento de Region */

function defineBehaviorType() {
  const { fields } = foundry.data;
  const Base = foundry.data.regionBehaviors.RegionBehaviorType;
  const E = CONST.REGION_EVENTS;
  return class TrapRegionBehavior extends Base {
    static defineSchema() {
      return {
        formula: new fields.StringField({ blank: true, initial: "", label: "Dano (fórmula)", hint: "Ex.: 2d6. Vazio = sem dano. Passa pelas defesas do alvo (Resistência, Imunidade, vantagem entre elementos) e sai um card com Aplicar." }),
        damageElements: new fields.SetField(
          new fields.StringField({ choices: () => Object.fromEntries(getActiveDamageElements().map(e => [e.id, e.label])) }),
          { label: "Elementos do dano", hint: "Dividem o dano em partes iguais, como num golpe." }
        ),
        isMagicDamage: new fields.BooleanField({ initial: false, label: "Dano Mágico", hint: "Defesa Mágica do alvo reduz o dano." }),
        conditionId: new fields.StringField({
          blank: true, initial: "",
          choices: () => ({ "": "— nenhuma —", ...Object.fromEntries(getActiveStatusConditions().map(c => [c.id, c.label])) }),
          label: "Condição", hint: "Aplicada em quem dispara, com o efeito padrão dela (rede = Lentidão, sono = Inconsciente…)."
        }),
        trigger: new fields.StringField({
          initial: "once", choices: { once: "Uma vez (depois se desliga)", always: "Toda vez que alguém entra" },
          label: "Dispara", hint: "Uma vez: o comportamento se desliga ao disparar (ligue de novo para armar)."
        }),
        reach: new fields.StringField({
          initial: "ground", choices: { ground: "Só quem pisa no chão", any: "Qualquer altura dentro da Região" },
          label: "Pega", hint: "Só no chão = elevação do Token entre −0,5 e 0,5 m (quem voa ou está enterrado passa). Qualquer altura: vale o teste da própria Região (ajuste o topo e a base dela)."
        }),
        immuneTraits: new fields.SetField(
          new fields.StringField({ choices: () => Object.fromEntries(getActiveTraits().map(t => [t.id, t.label])) }),
          { label: "Imune com (Traços)", hint: "Quem tem algum destes Traços não dispara a armadilha." }
        ),
        magic: new fields.BooleanField({ initial: false, label: "Mágica", hint: "Um campo de Antimagia (ou uma Antimagia em área) de nível ≥ o dela a desarma." }),
        tech: new fields.BooleanField({ initial: false, label: "Tecnológica", hint: "Um campo de Interferência (ou um PEM em área) de nível ≥ o dela a desarma. As duas marcadas = tecnomágica." }),
        level: new fields.NumberField({ integer: true, min: 0, initial: 0, nullable: false, label: "Nível", hint: "Contra o campo/Antimagia/PEM: precisa de nível igual ou maior para desarmar. 0 = qualquer um." }),
        reveal: new fields.BooleanField({ initial: false, label: "Mostrar ao disparar", hint: "Depois de disparar, a Região fica visível a todos." })
      };
    }

    static events = {
      [E.TOKEN_ENTER]: async function (event) {
        const token = event.data?.token;
        if (token) await handleTrapEnter(this.behavior ?? this.parent, token);
      }
    };
  };
}

/* ------------------------------------------------------------------ Registro */

export function registerTraps() {
  if (foundry.data?.regionBehaviors?.RegionBehaviorType && CONFIG.RegionBehavior) {
    CONFIG.RegionBehavior.dataModels[TRAP_BEHAVIOR] = defineBehaviorType();
    CONFIG.RegionBehavior.typeIcons ??= {};
    CONFIG.RegionBehavior.typeIcons[TRAP_BEHAVIOR] = "fa-solid fa-burst";
  }
  // Religada (o Mestre armou de novo): volta a poder disparar.
  Hooks.on("updateRegionBehavior", behavior => {
    if (behavior.type === TRAP_BEHAVIOR && !behavior.disabled) spent.delete(behavior.uuid);
  });
  Hooks.on("deleteRegionBehavior", behavior => {
    if (behavior.type === TRAP_BEHAVIOR) spent.delete(behavior.uuid);
  });
}
