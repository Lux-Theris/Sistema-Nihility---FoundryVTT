// Execute com duas sessões do mesmo mundo de teste abertas num Chromium com depuração remota.
// npm install --no-save playwright-core
// node test/foundry-smoke.mjs http://127.0.0.1:9222
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const endpoint = process.argv[2];
assert.ok(endpoint, "Informe o endpoint CDP do navegador.");
const browser = await chromium.connectOverCDP(endpoint);
const system = "nihility-rpg-system";
const prefix = `[Smoke ${Date.now()}]`;
let gm;
let fixturesStarted = false;

try {
  const sessions = [];
  for (const page of browser.contexts().flatMap(context => context.pages())) {
    if (!/^https?:/.test(page.url())) continue;
    const info = await page.evaluate(id => {
      const game = globalThis.game;
      if (!game?.ready || game.system.id !== id) return null;
      return { gm: game.user.isGM, userId: game.user.id, world: game.world.id };
    }, system);
    if (info) sessions.push({ page, ...info });
  }
  const master = sessions.find(session => session.gm);
  assert.ok(master, "Abra uma sessão de Mestre no mundo de teste.");
  gm = master.page;
  const player = sessions.find(session => !session.gm && session.world === master.world
    && new URL(session.page.url()).origin === new URL(gm.url()).origin);
  assert.ok(player, "Abra uma sessão de jogador no mesmo mundo de teste.");
  assert.equal(await gm.evaluate(() => !game.combats.some(combat => combat.started)), true,
    "Encerre os combates no mundo de teste antes de rodar.");

  fixturesStarted = true;
  const fixture = await gm.evaluate(async ({ prefix, userId }) => {
    const ActorClass = CONFIG.Actor.documentClass;
    const caster = await ActorClass.create({ name: prefix + " Conjurador", type: "character",
      ownership: { [userId]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
      system: { isPlayerCharacter: true } });
    const target = await ActorClass.create({ name: prefix + " Alvo", type: "character",
      ownership: { [userId]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER } });
    const [attack, fusion] = await caster.createEmbeddedDocuments("Item", [
      { name: prefix + " Golpe", type: "skill",
        system: { effectType: "damage", damageFormula: "1", cost: 1, isAbsoluteDamage: true } },
      { name: prefix + " Fusão", type: "skill", system: {
        hasUpkeep: true, active: true,
        subSkills: ["Primeira", "Segunda"].map(name => ({ name, hasUpkeep: true, active: true }))
      } }
    ]);
    await caster.update({ "system.attributes.hp.value": caster.system.attributes.hp.max,
      "system.attributes.energy.value": caster.system.attributes.energy.max });
    await target.update({ "system.attributes.hp.value": target.system.attributes.hp.max });
    return { caster: caster.id, target: target.id, attack: attack.id, fusion: fusion.id,
      hp: target.system.attributes.hp.value, mana: caster.system.attributes.energy.value };
  }, { prefix, userId: player.userId });
  assert.ok(fixture.hp > 1 && fixture.mana >= 1, "O cenário precisa de Vida e Mana disponíveis.");

  await player.page.waitForFunction(f =>
    game.actors.has(f.target) && game.actors.get(f.caster)?.items.has(f.attack), fixture);
  await player.page.evaluate(async f => {
    const { useSkillEffect } = await import("/systems/nihility-rpg-system/module/skills/skill-effects.js");
    await useSkillEffect(game.actors.get(f.caster), f.attack, { targetActor: game.actors.get(f.target) });
  }, fixture);
  const damageId = await gm.waitForFunction(({ system, prefix }) => game.messages.find(message =>
    message.getFlag(system, "damageApply") && message.getFlag(system, "skillUse") &&
    message.getFlag(system, "skillUse").label.startsWith(prefix))?.id, { system, prefix })
    .then(handle => handle.jsonValue());
  const card = `[data-message-id="${damageId}"]`;
  await gm.locator(`${card} .damage-apply[data-factor="1"]`).click();
  await gm.waitForFunction(f => game.actors.get(f.target).system.attributes.hp.value === f.hp - 1, fixture);
  assert.ok(await gm.evaluate(f => game.actors.get(f.caster).system.attributes.energy.value < f.mana, fixture));
  await gm.locator(`${card} .nihility-use-undo button`).click();
  await gm.locator(".nihility-undo-dialog button").filter({ hasText: /^Desfazer$/ }).click();
  await gm.waitForFunction(({ system, damageId }) => game.messages.get(damageId)?.getFlag(system, "skillUndone"),
    { system, damageId });
  const restored = await gm.evaluate(f => ({
    hp: game.actors.get(f.target).system.attributes.hp.value,
    mana: game.actors.get(f.caster).system.attributes.energy.value
  }), fixture);
  assert.deepEqual(restored, { hp: fixture.hp, mana: fixture.mana });

  await gm.evaluate(f => game.actors.get(f.caster).update({ "system.attributes.hp.value": 0 }), fixture);
  await gm.waitForFunction(f => {
    const actor = game.actors.get(f.caster);
    const skill = actor.items.get(f.fusion);
    return actor.statuses.has("fallen") && !skill.system.active
      && skill.system.subSkills.length === 2 && skill.system.subSkills.every(sub => !sub.active);
  }, fixture);
  console.log("Passou: jogador usa Skill, Mestre aplica e desfaz; Caído desliga a Skill e as duas Sub-Skills.");
} finally {
  try {
    if (fixturesStarted) await gm.evaluate(async prefix => {
      const actors = game.actors.filter(actor => actor.name.startsWith(prefix));
      const ids = new Set(actors.map(actor => actor.id));
      const messages = game.messages.filter(message => ids.has(message.speaker?.actor));
      await CONFIG.ChatMessage.documentClass.deleteDocuments(messages.map(message => message.id));
      await CONFIG.Actor.documentClass.deleteDocuments([...ids]);
    }, prefix);
  } finally {
    await browser.close();
  }
}
