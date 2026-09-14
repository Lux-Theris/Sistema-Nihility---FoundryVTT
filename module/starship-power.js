import { MEU_SISTEMA } from "./config.js";

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
 * Categorias sem throttle próprio (Bateria/Distribuidor não têm `powerAllocationPercent` na UI)
 * nunca sofrem dano por sobrecarga; Arma tem regra própria (sobrecarregar aumenta a Recarga em
 * vez de danificar o Módulo, ver Fase 5) — também fica de fora do tick de sobrecarga comum.
 */
const OVERLOAD_EXEMPT_CATEGORIES = ["battery", "distributor", "weapon"];

/** Limiar de `powerAllocationPercent` (%) a partir do qual a categoria sofre dano por sobrecarga. */
function overloadThreshold(category) {
  if (category === "reactor") return MEU_SISTEMA.OVERLOAD_THRESHOLD_REACTOR;
  if (category === "shield") return MEU_SISTEMA.OVERLOAD_THRESHOLD_SHIELD;
  return MEU_SISTEMA.OVERLOAD_THRESHOLD_DEFAULT;
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
  if (sys.category === "ftl" && sys.ftlType === "jump" && sys.chargeRemaining > 0) {
    patch["system.chargeRemaining"] = Math.max(0, sys.chargeRemaining - 1);
  }

  // Recarga de Arma (Fase 5) decrementa por rodada — mesmo padrão da Carga de Salto acima.
  if (sys.category === "weapon" && sys.cooldownRemaining > 0) {
    patch["system.cooldownRemaining"] = Math.max(0, sys.cooldownRemaining - 1);
  }

  let hpValue = sys.hp.value;
  if (sys.status === "online" && !OVERLOAD_EXEMPT_CATEGORIES.includes(sys.category)) {
    const threshold = overloadThreshold(sys.category);
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
  const shieldModule = actor.system.shieldModule;
  if (!shieldModule || shieldModule.system.status !== "online") return null;

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
