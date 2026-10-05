/**
 * Cache dos leitores de catálogo (backlog A3), a parte pura e testada.
 *
 * Cada `getActive*()` fazia `JSON.parse` (e a normalização: grupos e vantagens dos elementos,
 * números saneados…) a cada chamada — inclusive por golpe e por preparação de Ator. As settings de
 * catálogo são texto (`type: String`): enquanto o texto salvo não mudar, o resultado é o mesmo, então
 * fica guardado com o próprio texto como chave. O Mestre salvou outro catálogo → o texto muda → a
 * próxima leitura reconstrói. Nada de invalidar à mão.
 *
 * **Quem recebe não pode alterar o resultado** (é o mesmo objeto para todo mundo) — copie antes
 * (`foundry.utils.deepClone`), como os editores de catálogo já fazem. O caminho sem setting salva
 * já devolvia os objetos compartilhados de MEU_SISTEMA, então a regra não é nova.
 */

/**
 * @returns {(key: string, raw: unknown, build: (raw: unknown) => unknown) => unknown}
 *   Só guarda quando `raw` é texto; qualquer outra coisa (setting ausente na carga) reconstrói.
 */
export function createRawCache() {
  const entries = new Map();
  return (key, raw, build) => {
    if (typeof raw !== "string") return build(raw);
    const hit = entries.get(key);
    if (hit && hit.raw === raw) return hit.value;
    const value = build(raw);
    entries.set(key, { raw, value });
    return value;
  };
}

/** Memo de uma função de um objeto (a Tabela de Vantagens da lista de elementos): mesma lista, mesmo resultado. */
export function memoByObject(fn) {
  const seen = new WeakMap();
  return arg => {
    if (!arg || typeof arg !== "object") return fn(arg);
    if (!seen.has(arg)) seen.set(arg, fn(arg));
    return seen.get(arg);
  };
}
