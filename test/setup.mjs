/**
 * Stubs mínimos do ambiente do Foundry pra rodar os testes em Node puro.
 *
 * Os módulos testados são as funções PURAS do sistema (matemática de dados, conversão de moeda,
 * regras de tier, presets de Módulo) — nenhuma delas fala com o Foundry. O problema é que o
 * arquivo onde elas moram importa `config.js`, e o Foundry injeta algumas coisas globalmente
 * (`Math.clamp`, `foundry.utils.*`) que em Node não existem. Este arquivo preenche só o que é
 * de fato tocado no caminho de import — deliberadamente NÃO é um mock do Foundry inteiro: se um
 * teste precisar de algo além disto, o certo é testar uma função mais pura, não crescer o mock.
 *
 * Rode com:  node --test test/
 */

// `Math.clamp` é uma extensão do Foundry (não existe no JS padrão).
if (typeof Math.clamp !== "function") {
  Math.clamp = (value, min, max) => Math.min(Math.max(value, min), max);
}

globalThis.foundry ??= {};
foundry.utils ??= {};

foundry.utils.getProperty ??= (object, key) =>
  key.split(".").reduce((acc, part) => (acc == null ? acc : acc[part]), object);

foundry.utils.setProperty ??= (object, key, value) => {
  const parts = key.split(".");
  const last = parts.pop();
  const target = parts.reduce((acc, part) => (acc[part] ??= {}), object);
  target[last] = value;
  return true;
};

foundry.utils.deepClone ??= value => structuredClone(value);
foundry.utils.randomID ??= () => Math.random().toString(36).slice(2, 12);

// `game.settings.get` lança em Node — é exatamente o caminho que os leitores de config.js
// tratam com try/catch pra cair no valor padrão, então o stub REPRODUZ esse erro de propósito
// em vez de devolver um valor: é assim que os testes verificam o comportamento de fallback.
globalThis.game ??= {
  settings: {
    get() {
      throw new Error("game.settings indisponível fora do Foundry");
    }
  }
};

globalThis.ui ??= { notifications: { warn() {}, error() {}, info() {} } };
