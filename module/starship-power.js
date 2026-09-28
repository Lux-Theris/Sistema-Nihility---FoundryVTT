import { SYSTEM_ID, MEU_SISTEMA, moduleRole, tractorHold, getShipActionConfig } from "./config.js";
import { splitTargetedStructural, hardenedChance } from "./damage-rules.js";

/**
 * Reparte `amount` de dano entre Módulos, em pedaços de tamanho ALEATÓRIO e em ordem ALEATÓRIA —
 * é o que faz um mesmo golpe na Integridade Estrutural atingir sistemas diferentes a cada vez,
 * em vez de lascar todos por igual.
 *
 * Cada Módulo nunca recebe mais do que a Vida que ainda tem; o que sobrar passa pro próximo
 * sorteado. Se todos zerarem antes do dano acabar, o excedente se perde — a nave já é sucata, e
 * não há mais o que quebrar.
 *
 * Função PURA (recebe a lista e a fonte de aleatoriedade, devolve a repartição): é a única forma
 * de testar uma regra de sorteio sem depender do que o dado deu — ver test/rules.test.mjs, onde
 * `random` é substituído por uma sequência fixa.
 * @param {number} amount
 * @param {Array<{id: string, remaining: number}>} targets
 * @param {() => number} [random]
 * @returns {Array<{id: string, damage: number}>} só os Módulos que de fato foram atingidos
 */
export function splitStructuralDamage(amount, targets, random = Math.random) {
  let remainingDamage = Math.max(0, Math.round(amount));
  const pool = targets.filter(t => t.remaining > 0).map(t => ({ ...t }));
  const dealt = new Map();

  while (remainingDamage > 0 && pool.length) {
    const index = Math.floor(random() * pool.length);
    const target = pool[Math.min(index, pool.length - 1)];

    // Pedaço aleatório do que ainda falta — nunca 0, senão o laço não anda.
    const chunk = Math.max(1, Math.round(random() * remainingDamage));
    const applied = Math.min(chunk, remainingDamage, target.remaining);

    dealt.set(target.id, (dealt.get(target.id) ?? 0) + applied);
    target.remaining -= applied;
    remainingDamage -= applied;

    if (target.remaining <= 0) pool.splice(pool.indexOf(target), 1);
  }

  return [...dealt.entries()].map(([id, damage]) => ({ id, damage }));
}

/**
 * Aplica o dano da Integridade Estrutural espalhando pelos Módulos elegíveis (todos menos o
 * Casco — ver `spreadDamageTargets` em starship-model.js). Escreve numa chamada só.
 * @returns {Array<{name: string, damage: number}>} pro resumo no chat
 */
export async function applyStructuralDamage(actor, amount) {
  const targets = actor.system.spreadDamageTargets.map(m => ({ id: m.id, remaining: m.system.hp.value ?? 0 }));
  const split = splitStructuralDamage(amount, targets, Math.random);
  if (!split.length) return [];

  const updates = [];
  const summary = [];
  for (const { id, damage } of split) {
    const module = actor.items.get(id);
    if (!module) continue;
    updates.push({ _id: id, "system.hp.value": Math.max(0, module.system.hp.value - damage) });
    summary.push({ name: module.name, damage });
  }

  if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
  return summary;
}

/**
 * Dano de Integridade com um Módulo MIRADO ("Mirar num sistema"): a fatia `share` vai nele até a
 * Vida dele, e o resto (inclusive o que ele não aguentou) se espalha como sempre.
 * @returns {Promise<Array<{name: string, damage: number}>>}
 */
export async function applyTargetedStructuralDamage(actor, amount, moduleId, share = 0.75) {
  const module = moduleId ? actor.items.get(moduleId) : null;
  if (!module || !((module.system.hp?.value ?? 0) > 0)) return applyStructuralDamage(actor, amount);
  const { toTarget, toSpread } = splitTargetedStructural(amount, module.system.hp.value, share);
  const hits = [];
  if (toTarget > 0) {
    await module.update({ "system.hp.value": Math.max(0, module.system.hp.value - toTarget) });
    hits.push({ name: `${module.name} (mirado)`, damage: toTarget });
  }
  if (toSpread > 0) hits.push(...(await applyStructuralDamage(actor, toSpread)));
  return hits;
}

/**
 * Dano direto no Casco (sem passar pelo Escudo) — usado por dano contínuo (Queimadura de Plasma)
 * e reparos negativos. Várias Blindagens: a mais danificada primeiro, como na cascata.
 * @returns {Promise<number>} quanto de fato saiu
 */
export async function damageCasco(actor, amount) {
  let left = Math.max(0, Math.round(Number(amount) || 0));
  const armors = actor.system
    .modulesByRole("armor")
    .filter(m => (m.system.hp?.value ?? 0) > 0)
    .sort((a, b) => actor.system.integrityRatioFor(a) - actor.system.integrityRatioFor(b));
  const updates = [];
  let dealt = 0;
  for (const armor of armors) {
    if (left <= 0) break;
    const take = Math.min(left, armor.system.hp.value);
    updates.push({ _id: armor.id, "system.hp.value": armor.system.hp.value - take });
    left -= take;
    dealt += take;
  }
  if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
  return dealt;
}

/**
 * Reparo: soma Vida nos Módulos, até o máximo de cada um, o mais danificado primeiro. `role`
 * "armor" repara só o Casco; `null` repara a Integridade (todos menos Casco).
 * @returns {Promise<number>} quanto de fato foi reparado
 */
export async function repairModules(actor, amount, role = null) {
  let left = Math.max(0, Math.round(Number(amount) || 0));
  const pool = role ? actor.system.modulesByRole(role) : actor.system.spreadDamageTargets;
  const damaged = pool
    .filter(m => (m.system.hp?.value ?? 0) < (m.system.hp?.max ?? 0))
    .sort((a, b) => actor.system.integrityRatioFor(a) - actor.system.integrityRatioFor(b));
  const updates = [];
  let healed = 0;
  for (const module of damaged) {
    if (left <= 0) break;
    const give = Math.min(left, module.system.hp.max - module.system.hp.value);
    updates.push({ _id: module.id, "system.hp.value": module.system.hp.value + give });
    left -= give;
    healed += give;
  }
  if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
  return healed;
}

/* ------------------------------------------------------------------ Efeitos de sistema */

const SHIP_EFFECTS_FLAG = "shipEffects";

/**
 * Tenta aplicar um efeito de sistema de elemento numa Nave (Phaser derruba Módulo, Pólaron drena
 * energia, Disruptor baixa resistência). A chance cai com o Endurecimento do Módulo afetado + o da
 * Classe. Efeitos iguais não somam: renova pro mais longo e mais forte (como Condições).
 * @param {Actor} ship
 * @param {{type: string, chance: number, percent?: number, rounds: number}} effect
 * @param {{targetModuleId?: string|null, label?: string}} [options]
 * @returns {Promise<string|null>} texto pro chat, ou null se não pegou
 */
export async function applyShipSystemEffect(ship, effect, { targetModuleId = null, label = "" } = {}) {
  const sys = ship.system;
  const rounds = Math.max(1, Math.round(Number(effect.rounds) || 1));
  const percent = Math.max(0, Number(effect.percent) || 0);
  let module = null;
  if (effect.type === "moduleDisable") {
    const online = sys.modules.filter(m => m.system.status === "online" && (m.system.hp?.value ?? 0) > 0);
    module = online.find(m => m.id === targetModuleId) ?? online[Math.floor(Math.random() * online.length)] ?? null;
    if (!module) return null;
  } else if (effect.type === "energyDrain") {
    module = sys.reactorModule;
  } else if (effect.type === "resistanceDown") {
    const shield = sys.shieldModule;
    const armor = sys.armorModule;
    module = (Number(shield?.system?.hardening) || 0) >= (Number(armor?.system?.hardening) || 0) ? shield : armor;
  } else {
    return null;
  }
  const chance = hardenedChance(effect.chance, sys.hardeningFor(module));
  if (!(Math.random() * 100 < chance)) return null;

  const kind = { moduleDisable: "moduleDisabled", energyDrain: "energyDrain", resistanceDown: "resistanceDown" }[effect.type];
  const list = foundry.utils.deepClone(ship.getFlag(SYSTEM_ID, SHIP_EFFECTS_FLAG) ?? []);
  const same = list.find(e => e.kind === kind && (kind !== "moduleDisabled" || e.moduleId === module.id));
  if (same) {
    same.rounds = Math.max(same.rounds ?? 0, rounds);
    same.percent = Math.max(same.percent ?? 0, percent);
  } else {
    list.push({ id: foundry.utils.randomID(), kind, percent, rounds, moduleId: kind === "moduleDisabled" ? module.id : null, label });
  }
  await ship.setFlag(SYSTEM_ID, SHIP_EFFECTS_FLAG, list);

  if (kind === "moduleDisabled") {
    await module.update({ "system.status": "offline" });
    return `${module.name} derrubado por ${rounds} rodada(s)`;
  }
  if (kind === "energyDrain") {
    // Na hora: some X% da Bateria; enquanto durar, o Reator gera X% a menos (starship-model.js).
    const capacitor = sys.powerGrid?.capacitor?.value ?? 0;
    const drained = Math.floor(capacitor * (percent / 100));
    if (drained > 0) await ship.update({ "system.powerGrid.capacitor.value": capacitor - drained });
    return `energia drenada (${percent}% por ${rounds} rodada(s))`;
  }
  return `resistência baixa (−${percent}% por ${rounds} rodada(s))`;
}

/** Adiciona um efeito de sistema direto (ações da Nave, como "Preparar para impacto"). */
export async function addShipSystemEffect(ship, { kind, percent = 0, rounds = 1, label = "" }) {
  const list = foundry.utils.deepClone(ship.getFlag(SYSTEM_ID, SHIP_EFFECTS_FLAG) ?? []);
  const same = list.find(e => e.kind === kind && !e.moduleId);
  if (same) {
    same.rounds = Math.max(same.rounds ?? 0, rounds);
    same.percent = Math.max(same.percent ?? 0, percent);
  } else {
    list.push({ id: foundry.utils.randomID(), kind, percent, rounds, moduleId: null, label });
  }
  await ship.setFlag(SYSTEM_ID, SHIP_EFFECTS_FLAG, list);
}

/**
 * Encerra um efeito de sistema (ação "Reiniciar sistemas" ou fim do prazo). Módulo derrubado volta
 * a ligar se tiver Vida pra isso.
 */
export async function endShipSystemEffect(ship, effectId) {
  const list = ship.getFlag(SYSTEM_ID, SHIP_EFFECTS_FLAG) ?? [];
  const effect = list.find(e => e.id === effectId);
  if (!effect) return false;
  await ship.setFlag(SYSTEM_ID, SHIP_EFFECTS_FLAG, list.filter(e => e.id !== effectId));
  if (effect.kind === "moduleDisabled") {
    const module = ship.items.get(effect.moduleId);
    if (module && (module.system.hp?.value ?? 0) > 0 && moduleCanRestart(module)) await module.update({ "system.status": "online" });
  }
  return true;
}

/** Turno da Nave: cada efeito de sistema perde uma rodada; os que acabam se encerram. */
async function tickShipSystemEffects(actor) {
  const list = actor.getFlag(SYSTEM_ID, SHIP_EFFECTS_FLAG) ?? [];
  if (!list.length) return;
  // Raio Trator não tem prazo: dura enquanto o Módulo que segura estiver ligado.
  const next = list
    .filter(e => e.kind !== "tractor" || fromUuidSync(e.sourceModuleUuid)?.system?.status === "online")
    .map(e => (e.kind === "tractor" ? e : { ...e, rounds: (e.rounds ?? 1) - 1 }));
  const ended = next.filter(e => e.rounds <= 0);
  await actor.setFlag(SYSTEM_ID, SHIP_EFFECTS_FLAG, next.filter(e => e.rounds > 0));
  for (const effect of ended) {
    if (effect.kind === "moduleDisabled") {
      const module = actor.items.get(effect.moduleId);
      if (module && (module.system.hp?.value ?? 0) > 0 && moduleCanRestart(module)) await module.update({ "system.status": "online" });
    }
  }
}

/**
 * Categorias sem throttle próprio (Bateria/Distribuidor não têm `powerAllocationPercent` na UI)
 * nunca sofrem dano por sobrecarga; Arma tem regra própria (sobrecarregar aumenta a Recarga em
 * vez de danificar o Módulo, ver Fase 5) — também fica de fora do tick de sobrecarga comum.
 */
/**
 * Limiar de `powerAllocationPercent` (%) a partir do qual o Módulo sofre dano por sobrecarga, pela
 * Função da Categoria (MEU_SISTEMA.MODULE_ROLES[role].overload). `null` = nunca sobrecarrega
 * (Armazenamento/Distribuição não têm throttle; Arma troca sobrecarga por Recarga mais longa).
 */
function overloadThreshold(category) {
  const role = moduleRole(category);
  if (role === "power") return MEU_SISTEMA.OVERLOAD_THRESHOLD_REACTOR;
  if (role === "shield") return MEU_SISTEMA.OVERLOAD_THRESHOLD_SHIELD;
  const threshold = MEU_SISTEMA.MODULE_ROLES[role]?.overload;
  return threshold === null ? null : MEU_SISTEMA.OVERLOAD_THRESHOLD_DEFAULT;
}

/**
 * Calcula o patch de update de UM Módulo pro tick por rodada (Overhaul de Naves, Fase 3):
 * decrementa Carga de Salto FTL e Recarga de Arma, aplica dano por sobrecarga
 * (MEU_SISTEMA.OVERLOAD_DAMAGE_PERCENT_OF_MAX_PER_ROUND, hoje 0.5 = ~5% da Vida Máxima por
 * rodada a cada 10 pontos de throttle acima do limiar da categoria) e desliga sozinho qualquer
 * Módulo cuja Vida chegue a 0. `null` se nada mudou.
 */
function computeModuleTickPatch(module) {
  const sys = module.system;
  const patch = {};

  // Carga de Salto (sub-tipo FTL "jump") decrementa por rodada — mesmo padrão de
  // cooldownRemaining de Arma, até chegar a 0.
  const role = moduleRole(sys.category);
  if (role === "ftl" && sys.ftlType === "jump" && sys.chargeRemaining > 0) {
    patch["system.chargeRemaining"] = Math.max(0, sys.chargeRemaining - 1);
  }

  // Recarga de Arma (Fase 5) decrementa por rodada — mesmo padrão da Carga de Salto acima.
  if (role === "weapon" && sys.cooldownRemaining > 0) {
    patch["system.cooldownRemaining"] = Math.max(0, sys.cooldownRemaining - 1);
  }

  let hpValue = sys.hp.value;
  const threshold = overloadThreshold(sys.category);
  if (sys.status === "online" && threshold !== null) {
    const excess = sys.powerAllocationPercent - threshold;
    if (excess > 0) {
      const damage = Math.round((excess / 100) * sys.hp.max * MEU_SISTEMA.OVERLOAD_DAMAGE_PERCENT_OF_MAX_PER_ROUND);
      if (damage > 0) {
        hpValue = Math.max(0, hpValue - damage);
        patch["system.hp.value"] = hpValue;
      }
    }
  }

  // Vida zerada desliga o Módulo sozinho, seja lá qual for a causa (sobrecarga aqui, dano de
  // combate, ajuste manual do Mestre...) — só religa depois de reparado a 15%+ (ver
  // moduleCanRestart, checado no toggle manual em starship-sheet.js).
  if (hpValue <= 0 && sys.status === "online") {
    patch["system.status"] = "offline";
  }

  return Object.keys(patch).length ? patch : null;
}

/**
 * Regen/Recarga do Escudo por rodada (campos no Ator, não no Módulo): enquanto
 * `rechargeRemaining > 0` (setado pela cascata de dano quando o Escudo zera, ver
 * `applyStarshipDamageCascade` em skill-effects.js) só decrementa, sem regenerar — 0% de
 * proteção durante a Recarga. Ao chegar a 0, volta a regenerar `shields.regenRate` por rodada
 * até o máximo. Só tica se houver um Módulo de Escudo instalado E "online" — um Escudo
 * desligado (manual ou por Vida zerada) não regenera nem recarrega sozinho.
 */
function computeShieldTickPatch(actor) {
  // Com vários Escudos, basta um online pra regenerar/recarregar.
  if (!actor.system.modulesByRole("shield").some(m => m.system.status === "online")) return null;

  const shields = actor.system.shields;
  const patch = {};
  if (shields.rechargeRemaining > 0) {
    patch["system.shields.rechargeRemaining"] = shields.rechargeRemaining - 1;
  } else if (shields.value < shields.max) {
    patch["system.shields.value"] = Math.min(shields.max, shields.value + shields.regenRate);
  }
  return Object.keys(patch).length ? patch : null;
}

/**
 * Tica uma Nave/Veículo por rodada: sobrecarga de Módulo, Carga de Salto FTL, desligamento por
 * Vida zerada e Regen/Recarga do Escudo. Chamado do mesmo hook `updateCombat` que já tica
 * Veneno/Habilidade Ativa de Personagem — GM-only, uma vez por turno do combatente dono do Ator.
 */
export async function tickStarshipPower(actor) {
  // Efeitos de sistema (Módulo derrubado, energia drenada, resistência baixa, Preparar para
  // impacto) descem uma rodada primeiro: um Módulo que volta agora já entra no resto do tick.
  await tickShipSystemEffects(actor);
  const itemUpdates = [];
  for (const module of actor.system.modules) {
    const patch = computeModuleTickPatch(module);
    if (patch) itemUpdates.push({ _id: module.id, ...patch });
  }
  if (itemUpdates.length) await actor.updateEmbeddedDocuments("Item", itemUpdates);

  const shieldPatch = computeShieldTickPatch(actor);
  if (shieldPatch) await actor.update(shieldPatch);

  // Carga/descarga do Capacitor por rodada. Antes isso só acontecia se alguém clicasse no botão
  // manual da ficha, então o Capacitor ficava congelado durante o combate inteiro — o que passou
  // a importar de verdade quando ele virou o pool de onde sai o Custo de Habilidade de Nave
  // (ver `energyValuePath` em skill-effects.js): sem este tick, gastar a reserva era definitivo.
  // Roda por último, depois de Módulos/Escudo, pra somar em cima do estado já atualizado.
  await actor.system.applyPowerGridTick();
}

/** Um Módulo desligado por Vida zerada só pode ser religado a partir de MODULE_RESTART_HP_THRESHOLD_PERCENT de Vida Máxima. */
export function moduleCanRestart(module) {
  if (!module.system.hp.max) return true;
  const percent = (module.system.hp.value / module.system.hp.max) * 100;
  return percent >= MEU_SISTEMA.MODULE_RESTART_HP_THRESHOLD_PERCENT;
}

/* ------------------------------------------------------------------ Raio Trator */

/**
 * Lado do Mestre: prende `targetUuid` com o Raio Trator `moduleUuid`. A força é recalculada aqui
 * (Porte do Módulo × Porte do alvo × throttle) — o payload vem de outro cliente. Um Módulo segura
 * um alvo por vez: prender outro solta o anterior.
 * @returns {Promise<number>} fração segurada (0 = grande demais pra este Módulo)
 */
export async function engageTractorAsGm({ moduleUuid, targetUuid }) {
  const module = typeof moduleUuid === "string" ? await fromUuid(moduleUuid) : null;
  const target = typeof targetUuid === "string" ? await fromUuid(targetUuid) : null;
  if (!module || !target?.system?.modules || module.system?.status !== "online") return 0;
  if (moduleRole(module.system.category) !== "tractor") return 0;
  const moduleRank = MEU_SISTEMA.MODULE_SIZE_RANK[module.system.moduleSize] ?? 0;
  const targetRank = target.system.vesselSize?.rank ?? 0;
  const hold = tractorHold(moduleRank, targetRank, (module.system.powerAllocationPercent ?? 100) / 100);
  await releaseTractorAsGm({ moduleUuid });
  if (hold <= 0) return 0;
  const list = foundry.utils.deepClone(target.getFlag(SYSTEM_ID, SHIP_EFFECTS_FLAG) ?? []);
  list.push({ id: foundry.utils.randomID(), kind: "tractor", percent: Math.round(hold * 100), rounds: 1, moduleId: null, sourceModuleUuid: module.uuid, label: module.parent?.name ?? module.name });
  await target.setFlag(SYSTEM_ID, SHIP_EFFECTS_FLAG, list);
  await module.setFlag(SYSTEM_ID, "tractorTarget", target.uuid);
  return hold;
}

/** Lado do Mestre: solta quem este Raio Trator estiver segurando. */
export async function releaseTractorAsGm({ moduleUuid }) {
  const module = typeof moduleUuid === "string" ? await fromUuid(moduleUuid) : null;
  const targetUuid = module?.getFlag(SYSTEM_ID, "tractorTarget");
  if (targetUuid) {
    const target = await fromUuid(targetUuid);
    const list = target?.getFlag(SYSTEM_ID, SHIP_EFFECTS_FLAG) ?? [];
    const kept = list.filter(e => !(e.kind === "tractor" && e.sourceModuleUuid === moduleUuid));
    if (target && kept.length !== list.length) await target.setFlag(SYSTEM_ID, SHIP_EFFECTS_FLAG, kept);
  }
  if (module?.getFlag(SYSTEM_ID, "tractorTarget")) await module.unsetFlag(SYSTEM_ID, "tractorTarget");
}

/* ------------------------------------------------------------------ Foco de energia */

/** As três Funções que o foco de energia mexe (os "pips" do Elite). */
export const POWER_FOCUS_ROLES = { shields: "shield", weapons: "weapon", engines: "propulsion" };

/**
 * Atalho de energia: `focus` = "shields" | "weapons" | "engines" | "balanced". No foco, os
 * Módulos daquela Função vão pra P1 e o throttle sobe pro valor de Regras da Mesa, nunca acima do
 * ponto em que a Sobrecarga começa; os das outras duas vão pra P3 e caem. Equilibrado: 100% e P3.
 * Reator, Bateria, Distribuidor e o resto não mudam.
 */
export async function applyPowerFocus(ship, focus) {
  const { focusBoost, focusCut } = getShipActionConfig();
  const focusRole = POWER_FOCUS_ROLES[focus] ?? null;
  const updates = [];
  for (const module of ship.system.modules) {
    const role = moduleRole(module.system.category);
    if (!Object.values(POWER_FOCUS_ROLES).includes(role)) continue;
    let throttle = 100;
    let priority = 3;
    if (focusRole && role === focusRole) {
      const threshold = MEU_SISTEMA.MODULE_ROLES[role]?.overload;
      throttle = threshold ? Math.min(focusBoost, threshold) : focusBoost;
      priority = 1;
    } else if (focusRole) {
      throttle = focusCut;
    }
    updates.push({ _id: module.id, "system.powerAllocationPercent": Math.round(throttle), "system.powerPriority": priority });
  }
  if (updates.length) await ship.updateEmbeddedDocuments("Item", updates);
  await ship.setFlag(SYSTEM_ID, "powerFocus", focus);
}

/** "Energia auxiliar para os Escudos": passa carga da Bateria pro Escudo, até o máximo dele. */
export async function transferCapacitorToShields(ship, amount) {
  const sys = ship.system;
  const capacitor = sys.powerGrid?.capacitor?.value ?? 0;
  const room = Math.max(0, (sys.shields?.max ?? 0) - (sys.shields?.value ?? 0));
  const moved = Math.max(0, Math.min(Math.round(Number(amount) || 0), capacitor, room));
  if (moved > 0) {
    await ship.update({ "system.powerGrid.capacitor.value": capacitor - moved, "system.shields.value": sys.shields.value + moved });
  }
  return moved;
}


/* ------------------------------------------------------------------ Escudo adaptativo */

/** O Escudo caiu (ou foi derrubado): todos os Escudos adaptativos da Nave esquecem o que aprenderam. */
export async function clearShieldAdaptation(ship) {
  for (const module of ship.system?.modulesByRole?.("shield") ?? []) {
    if (module.getFlag(SYSTEM_ID, "shieldAdaptation")) await module.unsetFlag(SYSTEM_ID, "shieldAdaptation");
  }
}

/**
 * Módulo de Escudo desligado (à mão, por Vida 0, por efeito de sistema) perde a adaptação. Só o
 * Mestre designado grava, pra dois clientes não apagarem juntos. Chamado no `init`.
 */
export function registerShieldAdaptationReset() {
  Hooks.on("updateItem", (item, changes) => {
    if (item.type !== "starship_module") return;
    const status = foundry.utils.getProperty(changes, "system.status");
    if (status === undefined || status === "online") return;
    if (!item.getFlag(SYSTEM_ID, "shieldAdaptation")) return;
    const gms = game.users.filter(u => u.isGM && u.active).sort((a, b) => a.id.localeCompare(b.id));
    if (gms[0]?.id !== game.user.id) return;
    item.unsetFlag(SYSTEM_ID, "shieldAdaptation");
  });
}

/**
 * "Modular frequência": as armas desta Nave passam a uma frequência nova. Escudos adaptativos que
 * aprenderam a frequência antiga começam do zero contra ela (e voltam a se adaptar).
 * @returns {Promise<number>} a frequência nova
 */
export async function modulateWeaponFrequency(ship) {
  const current = Number(ship.getFlag(SYSTEM_ID, "weaponFrequency")) || 0;
  let next = current;
  while (next === current) next = 1 + Math.floor(Math.random() * 999);
  await ship.setFlag(SYSTEM_ID, "weaponFrequency", next);
  return next;
}
