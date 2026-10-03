/**
 * Regeneração de energia/Vida por rodada e Descanso (prancha 7) — o lado Foundry. A conta é pura
 * (core/regen-rules.js, species/anatomy-rules.js#restOutcome).
 *
 * Por rodada (início do turno do Personagem, em combate, Mestre): a regeneração natural da mesa
 * (bloco "Regeneração natural de energia") + o bloco "Regeneração por rodada" de Skill (escala com o
 * Poder do nível; Ativa só ligada), Título, Item Geral equipado e Espécie/Linhagem/Herança. Fonte
 * mágica suprimida pela Antimagia não conta. A Vida por rodada cura como uma cura do tipo e do nível
 * da fonte: bloqueios de cura, partes a 0% e a partilha entre as partes valem igual.
 *
 * Descanso (botão "Descansar…" da ficha): Curto ou Completo, com prévia. Partes a 0% seguram o %
 * delas na Vida; o que a Vida subiu vai para as partes feridas, proporcional ao que falta.
 */
import { SYSTEM_ID, getHealingRules, getFeatureOption, isFeatureEnabled, isEnergyPoolEnabled, isBodyInjuryEnabled, isAnatomyEnabled, getCharacterEnergyLabel, skillLevelBonuses } from "../core/config.js";
import { normalizeRegen, sumRegen, regenAmount } from "../core/regen-rules.js";
import { sourceSuppressed, suppressionLevel } from "../core/suppression.js";
import { restOutcome } from "../species/anatomy-rules.js";
import { healPlan, healBodyParts, partsSnapshot, partWrite } from "../species/anatomy.js";

/**
 * As fontes de regeneração por rodada de um Personagem (para o tick e para o "De onde vem").
 * @returns {Array<{label:string, energyPercent:number, hpPercent:number, hpKind:string, level:number, power:number}>}
 */
export function collectRegenSources(actor) {
  if (actor?.type !== "character") return [];
  const sources = [];
  if (isFeatureEnabled("naturalRegen")) {
    sources.push({ label: "Natural (Módulos do Sistema)", energyPercent: getFeatureOption("naturalRegen", "naturalEnergyRegenPercent") ?? 5, hpPercent: 0, level: 0, power: 1 });
  }
  const suppression = suppressionLevel(actor);
  for (const item of actor.items) {
    const regen = item.system?.regen;
    if (!regen || (!regen.energyPercent && !regen.hpPercent)) continue;
    if (item.type === "title") sources.push({ label: `Título: ${item.name}`, ...normalizeRegen(regen), level: 0, power: 1 });
    else if (item.type === "item") {
      if (!item.system.equipped || sourceSuppressed(actor, item, null, suppression)) continue;
      sources.push({ label: `Item: ${item.name}`, ...normalizeRegen(regen), level: 0, power: 1 });
    } else if (item.type === "skill") {
      if (item.system.hasUpkeep && !item.system.active) continue;
      if (sourceSuppressed(actor, item, null, suppression)) continue;
      const level = Math.max(0, Number(item.system.level) || 0);
      const power = skillLevelBonuses(level).power;
      sources.push({ label: `Skill: ${item.name}${power !== 1 ? ` (nível ${level}, Poder ×${power.toFixed(2)})` : ""}`, ...normalizeRegen(regen), level, power });
    }
  }
  const kindLabel = { species: "Espécie", lineage: "Linhagem", heritage: "Herança" };
  for (const layer of actor.system.originLayers ?? []) {
    const regen = layer.entry?.passives?.regen;
    if (!regen || (!regen.energyPercent && !regen.hpPercent)) continue;
    sources.push({ label: `${kindLabel[layer.kind] ?? "Origem"}: ${layer.entry.label ?? layer.id}`, ...normalizeRegen(regen), level: 0, power: 1 });
  }
  return sources;
}

/** Início do turno (Mestre): aplica a regeneração por rodada e posta uma linha no chat. */
export async function tickRegeneration(actor) {
  if (actor?.type !== "character") return null;
  const total = sumRegen(collectRegenSources(actor));
  if (!total.energy && !total.hp.length) return null;
  const parts = [];
  const update = {};

  const energy = actor.system.attributes.energy;
  if (total.energy > 0 && isEnergyPoolEnabled() && energy.value < energy.max) {
    const next = Math.min(energy.max, energy.value + regenAmount(energy.max, total.energy));
    if (next > energy.value) {
      update["system.attributes.energy.value"] = next;
      parts.push(`+${next - energy.value} ${getCharacterEnergyLabel()} (${Math.round(total.energy * 10) / 10}%)`);
    }
  }
  if (Object.keys(update).length) await actor.update(update);

  // Vida por rodada: cada (tipo, nível) cura como uma cura de verdade.
  for (const heal of total.hp) {
    const hp = actor.system.attributes.hp;
    if (hp.value >= hp.max) break;
    const plan = healPlan(actor, { kind: heal.kind, level: heal.level });
    const ceiling = Math.max(hp.value, Math.floor(hp.max * plan.cap + 1e-9));
    const gain = Math.floor(regenAmount(hp.max, heal.percent) * plan.bodyFactor);
    const next = Math.min(ceiling, hp.value + gain);
    if (next <= hp.value) {
      if (plan.bodyFactor < 1) parts.push(`${heal.kind === "regeneracao" ? "Regeneração" : "Cura"} bloqueada`);
      continue;
    }
    await actor.update({ "system.attributes.hp.value": next });
    const note = await healBodyParts(actor, next - hp.value, { kind: heal.kind, level: heal.level });
    parts.push(`+${next - hp.value} Vida${note ? ` (${note})` : ""}`);
  }

  if (!parts.length) return null;
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p><strong>${foundry.utils.escapeHTML(actor.name)}</strong> — início de turno, regeneração: ${parts.join(" · ")}</p>`
  });
  return parts;
}

/** O que cada descanso faria agora (sem gravar nada). */
export function restPreview(actor) {
  const rules = getHealingRules();
  const injury = isBodyInjuryEnabled() && isAnatomyEnabled();
  const plan = healPlan(actor, { kind: "descanso", level: 0 });
  const parts = injury ? partsSnapshot(actor) : [];
  const base = {
    hp: actor.system.attributes.hp,
    energy: actor.system.attributes.energy,
    parts,
    injury,
    shortHpPercent: rules.shortHpPercent,
    shortEnergyPercent: rules.shortEnergyPercent,
    bodyFactor: plan.bodyFactor,
    partFactor: plan.partFactor
  };
  return { short: restOutcome({ ...base, kind: "short" }), long: restOutcome({ ...base, kind: "long" }), parts };
}

/** Grava um descanso já calculado e avisa no chat. */
async function applyRest(actor, kind, outcome) {
  const hp = actor.system.attributes.hp;
  const energy = actor.system.attributes.energy;
  const update = { "system.attributes.hp.value": outcome.hp };
  if (isEnergyPoolEnabled()) update["system.attributes.energy.value"] = outcome.energy;
  await actor.update(update);
  if (outcome.healedParts.length) {
    await actor.updateEmbeddedDocuments("Item", outcome.healedParts.map(h => partWrite(actor.items.get(h.id), h.value)).filter(u => u._id));
  }
  const gained = [`+${outcome.hp - hp.value} Vida`];
  if (isEnergyPoolEnabled()) gained.push(`+${outcome.energy - energy.value} ${getCharacterEnergyLabel()}`);
  if (outcome.healedParts.length) gained.push(`${outcome.healedParts.length} parte(s) ferida(s) melhoraram`);
  if (outcome.cap < 1) gained.push(`Vida segura em ${Math.round(outcome.cap * 100)}% por partes a 0%`);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p><strong>${foundry.utils.escapeHTML(actor.name)}</strong> fez um <strong>Descanso ${kind === "long" ? "Completo" : "Curto"}</strong>: ${gained.join(" · ")}.</p>`
  });
}

/** "Descansar…": Curto ou Completo, com o resultado de cada um para esta ficha. */
export async function openRestDialog(actor) {
  if (!actor?.isOwner) return;
  const preview = restPreview(actor);
  const hp = actor.system.attributes.hp;
  const energy = actor.system.attributes.energy;
  const energyLabel = getCharacterEnergyLabel();
  const esc = value => foundry.utils.escapeHTML(String(value ?? ""));
  const partRows = outcome => {
    const byId = new Map(outcome.healedParts.map(h => [h.id, h.value]));
    return preview.parts
      .filter(p => p.state !== "intact")
      .map(p => {
        const pct = v => `${p.max > 0 ? Math.round((v / p.max) * 100) : 0}%`;
        if (p.state === "lost" || p.value <= 0) return `<span class="k">${esc(p.name)}</span><span class="v is-zero">${p.state === "lost" ? "perdida" : "0%"}</span>`;
        return `<span class="k">${esc(p.name)} (${pct(p.value)})</span><span class="v">→ ${pct(byId.get(p.id) ?? p.value)}</span>`;
      })
      .join("");
  };
  const card = (kind, title, text, outcome, checked) => `
    <label class="nihility-rest-opt ${checked ? "on" : ""}">
      <input type="radio" name="restKind" value="${kind}" ${checked ? "checked" : ""}/>
      <b>${title}</b>
      <span class="hint">${text}</span>
      <span class="pv">
        <span class="k">Vida</span><span class="v">${hp.value} → ${outcome.hp}</span>
        ${isEnergyPoolEnabled() ? `<span class="k">${esc(energyLabel)}</span><span class="v">${energy.value} → ${outcome.energy}</span>` : ""}
        ${partRows(outcome)}
      </span>
    </label>`;
  const capNote = preview.long.cap < 1 ? `<p class="nihility-rest-note">Partes a 0% seguram a Vida em <b>${Math.round(preview.long.cap * 100)}%</b>: elas só voltam com Cura, Regeneração ou Reparo.</p>` : "";
  const kind = await foundry.applications.api.DialogV2.wait({
    window: { title: `Descansar — ${actor.name}` },
    classes: ["nihility-rest-dialog"],
    content: `<div class="nihility-rest">
      <div class="nihility-rest-grid">
        ${card("short", "Descanso Curto", "Uma pausa: recupera parte da Vida e da energia.", preview.short, true)}
        ${card("long", "Descanso Completo", "Uma noite: Vida e energia ao máximo.", preview.long, false)}
      </div>
      ${capNote}
    </div>`,
    render: (event, dialog) => {
      const root = dialog.element ?? event?.target?.element;
      root?.querySelectorAll('input[name="restKind"]').forEach(input =>
        input.addEventListener("change", () => root.querySelectorAll(".nihility-rest-opt").forEach(opt => opt.classList.toggle("on", opt.contains(input) && input.checked)))
      );
    },
    buttons: [
      { action: "rest", label: "Descansar", default: true, callback: (event, button, dialog) => dialog.element.querySelector('input[name="restKind"]:checked')?.value ?? "short" },
      { action: "cancel", label: "Cancelar", callback: () => null }
    ],
    rejectClose: false
  });
  if (kind !== "short" && kind !== "long") return;
  // Recalcula na hora de gravar (algo pode ter mudado com o diálogo aberto).
  const fresh = restPreview(actor);
  await applyRest(actor, kind, fresh[kind]);
}

/** Linhas do "De onde vem" da energia/Vida: regeneração por rodada. */
export function regenExplainRows(actor, stat = "energy") {
  const total = sumRegen(collectRegenSources(actor));
  return total.rows
    .filter(r => (stat === "energy" ? r.energy : r.hp) > 0)
    .map(r => ({ label: r.label, value: `${Math.round((stat === "energy" ? r.energy : r.hp) * 10) / 10}%${stat === "hp" ? ` · ${r.kind === "regeneracao" ? "Regeneração" : "Cura"}` : ""}` }));
}
