/**
 * Consumíveis, cargas e carregador de arma — a parte pura e testada. Quem lê e grava fichas é
 * `economy/consumables.js`.
 */

/**
 * Um uso de um consumível. Sem cargas (`charges` 0), cada uso gasta 1 da pilha. Com cargas, cada
 * uso gasta 1 carga da unidade aberta (`used` conta as gastas); quando ela acaba, sai 1 da pilha e
 * a próxima unidade começa cheia.
 * @param {{quantity:number, charges?:number, used?:number}} state
 * @returns {{quantity:number, used:number, unitSpent:boolean, gone:boolean, left:number}}
 *   `left` = usos que sobram no total (para mostrar "restam N")
 */
export function consumeUse({ quantity, charges = 0, used = 0 }) {
  const qty = Math.max(0, Math.floor(Number(quantity) || 0));
  const per = Math.max(0, Math.floor(Number(charges) || 0));
  if (qty <= 0) return { quantity: 0, used: 0, unitSpent: false, gone: true, left: 0 };
  if (per <= 1) {
    const next = qty - 1;
    return { quantity: next, used: 0, unitSpent: true, gone: next <= 0, left: next };
  }
  const spent = Math.min(per, Math.max(0, Math.floor(Number(used) || 0))) + 1;
  if (spent >= per) {
    const next = qty - 1;
    return { quantity: next, used: 0, unitSpent: true, gone: next <= 0, left: next * per };
  }
  return { quantity: qty, used: spent, unitSpent: false, gone: false, left: (qty - 1) * per + (per - spent) };
}

/** Cargas que a unidade aberta ainda tem (para "3/5" no inventário). */
export function chargesLeft({ charges = 0, used = 0 }) {
  const per = Math.max(0, Math.floor(Number(charges) || 0));
  if (per <= 1) return null;
  return Math.max(0, per - Math.min(per, Math.max(0, Math.floor(Number(used) || 0))));
}

/**
 * Estado do carregador de uma arma. `size` 0 = arma sem carregador (ataque infinito, como sempre
 * foi). `loaded` acima do tamanho (o Mestre diminuiu o carregador) conta como cheio.
 */
export function magazineState({ size = 0, loaded = 0 }) {
  const max = Math.max(0, Math.floor(Number(size) || 0));
  if (!max) return { uses: false, max: 0, loaded: 0, empty: false, full: true };
  const current = Math.min(max, Math.max(0, Math.floor(Number(loaded) || 0)));
  return { uses: true, max, loaded: current, empty: current <= 0, full: current >= max };
}

/** A munição serve nesta arma? Arma sem tipos marcados aceita qualquer munição pessoal. */
export function ammoFitsWeapon(ammoType, acceptedTypes = []) {
  const list = (acceptedTypes ?? []).filter(Boolean);
  return !list.length || list.includes(ammoType);
}

/**
 * Valor de uma entrada de Efeito em "% do máximo do alvo" (Poção: Vida +25% da Vida máxima) →
 * número. Fixo passa como está. Arredonda para longe de zero, para 1% de 50 ainda curar 1.
 */
export function resolveEffectAmount(amount, mode, max) {
  const value = Number(amount) || 0;
  if (mode !== "percentMax") return Math.round(value);
  const raw = (value / 100) * Math.max(0, Number(max) || 0);
  if (!raw) return 0;
  return raw > 0 ? Math.max(1, Math.round(raw)) : Math.min(-1, Math.round(raw));
}

/**
 * Trocar/recarregar: o que entra e o que volta. A munição escolhida enche o carregador — ou, se for
 * uma unidade aberta (`ammoRounds` > 0), dá só os disparos que ela tinha. O que estava dentro volta
 * para o inventário: cheio volta para a pilha normal (`rounds` 0); pela metade volta como unidade
 * aberta com o que sobrou; vazio não volta nada.
 * @param {{size:number, loaded:number, ammoRounds?:number}} state
 * @returns {{loaded:number, returned:{rounds:number}|null}}
 */
export function reloadPlan({ size, loaded = 0, ammoRounds = 0 }) {
  const max = Math.max(0, Math.floor(Number(size) || 0));
  const inside = Math.min(max, Math.max(0, Math.floor(Number(loaded) || 0)));
  const open = Math.max(0, Math.floor(Number(ammoRounds) || 0));
  return {
    loaded: open > 0 ? Math.min(open, max) : max,
    returned: inside > 0 ? { rounds: inside >= max ? 0 : inside } : null
  };
}
