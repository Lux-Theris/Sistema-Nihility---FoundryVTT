/**
 * Escudo pessoal em pools (documento): cada Skill que dá Escudo ganha um pool com Vida própria no
 * Personagem que recebe; `attributes.shield.value` continua sendo o TOTAL (o mostrador), e o que
 * passar da soma dos pools é o "avulso". As contas (quem apanha primeiro, Penetração camada por
 * camada, ajuste manual) são puras e testadas em damage-rules.js — aqui só se lê e grava.
 */
import { sustainedShieldGain, reconcileShieldPools } from "./damage-rules.js";

/** Pools atuais do Ator (cópia editável), ou `null` se o Ator não tem Escudo pessoal. */
export function shieldPoolsOf(actor) {
  const shield = actor?.system?.attributes?.shield;
  if (!shield) return null;
  return foundry.utils.deepClone(shield.pools ?? []);
}

/** Mesmo dono? (quem mantém + Skill + Sub-Skill) */
function sameSource(pool, source) {
  return pool.holderUuid === source.holderUuid && pool.skillId === source.skillId && (pool.subSkillIndex ?? null) === (source.subSkillIndex ?? null);
}

/**
 * Soma Escudo no pool desta fonte (cria o pool se não existir — ele vira o mais recente). Com
 * `cap` > 0, o POOL não passa do teto (Escudo mantido). Sem fonte (Condição marcada à mão, efeito
 * sem Skill), vai pro avulso.
 * @returns {Promise<number>} quanto entrou
 */
export async function addShieldToPool(actor, source, amount, { cap = 0 } = {}) {
  const pools = shieldPoolsOf(actor);
  if (!pools) return 0;
  const total = actor.system.attributes.shield.value ?? 0;
  const add = Math.max(0, Math.round(Number(amount) || 0));
  if (!source?.skillId) {
    await actor.update({ "system.attributes.shield.value": total + add });
    return add;
  }
  let pool = pools.find(p => sameSource(p, source));
  if (!pool) {
    pool = {
      id: foundry.utils.randomID(),
      label: source.label ?? "",
      value: 0,
      order: Date.now(),
      holderUuid: source.holderUuid ?? "",
      skillId: source.skillId,
      subSkillIndex: source.subSkillIndex ?? null,
      // Elemento do Escudo (Escudo de Água): a vantagem do golpe contra ele entra no Aplicar.
      elements: Array.isArray(source.elements) ? source.elements : []
    };
    pools.push(pool);
  }
  const gain = cap > 0 ? sustainedShieldGain(pool.value, add, cap) : add;
  pool.value += gain;
  if (source.label) pool.label = source.label;
  await actor.update({ "system.attributes.shield.value": total + gain, "system.attributes.shield.pools": pools });
  return gain;
}

/**
 * A Skill que mantinha um pool desligou: o pool some inteiro (e sai do total).
 * @returns {Promise<number>} quanto de Escudo saiu
 */
export async function removeShieldPool(actor, source) {
  const pools = shieldPoolsOf(actor);
  if (!pools) return 0;
  const pool = pools.find(p => sameSource(p, source));
  if (!pool) return 0;
  const total = actor.system.attributes.shield.value ?? 0;
  await actor.update({
    "system.attributes.shield.value": Math.max(0, total - pool.value),
    "system.attributes.shield.pools": pools.filter(p => p !== pool)
  });
  return pool.value;
}

/**
 * Total do Escudo mudado sem mexer nos pools (campo da ficha, Descanso, Efeito negativo): os pools
 * se ajustam antes de gravar — diminuir tira do mais recente, aumentar vira avulso. Pools zerados
 * saem da lista. Chamado no `init`.
 */
export function registerShieldPoolReconcile() {
  Hooks.on("preUpdateActor", (actor, changes) => {
    const newTotal = foundry.utils.getProperty(changes, "system.attributes.shield.value");
    if (newTotal === undefined) return;
    if (foundry.utils.hasProperty(changes, "system.attributes.shield.pools")) return;
    const pools = actor.system?.attributes?.shield?.pools;
    if (!pools?.length) return;
    const adjusted = reconcileShieldPools(foundry.utils.deepClone(pools), newTotal).filter(p => p.value > 0);
    foundry.utils.setProperty(changes, "system.attributes.shield.pools", adjusted);
  });
}

/** Resumo pra ficha/lista de efeitos: "Barreira 30 · Muralha 20 · avulso 5". */
export function describeShieldPools(actor) {
  const shield = actor?.system?.attributes?.shield;
  if (!shield) return "";
  const pools = [...(shield.pools ?? [])].sort((a, b) => (b.order ?? 0) - (a.order ?? 0));
  const loose = Math.max(0, (shield.value ?? 0) - pools.reduce((sum, p) => sum + (p.value ?? 0), 0));
  const parts = pools.filter(p => p.value > 0).map(p => `${p.label || "Escudo"} ${p.value}`);
  if (loose > 0) parts.push(`avulso ${loose}`);
  return parts.join(" · ");
}

