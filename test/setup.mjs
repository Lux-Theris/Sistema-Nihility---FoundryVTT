/**
 * Testes das funções PURAS do sistema — as que decidem números de regra e não dependem de nada
 * do Foundry em tempo de execução. É a verificação automatizada do projeto; tudo que é
 * UI/documento continua sendo teste manual dentro de um mundo aberto (temp/testes-no-foundry.md).
 *
 * Os testes ficam divididos por assunto em `test/*.test.mjs` (combate, naves, espécies…); cada
 * arquivo começa com `import "./setup.mjs"`. Para rodar todos:
 *
 *   node --test "test/*.test.mjs"
 *
 * (`node --test test/` não funciona: o Node trata a pasta como um módulo. `node --test` sem
 * argumento também roda tudo, mas conta este setup.mjs como um teste vazio.)
 *
 * Critério pra entrar aqui: a função tem que ser chamável sem Actor/Item/canvas. Se um teste
 * precisar simular documento do Foundry, o alvo está errado — extraia a parte pura primeiro.
 * Teste novo vai no arquivo do assunto dele (ou num arquivo novo `<assunto>.test.mjs`).
 *
 * ---
 *
 * Stubs mínimos do ambiente do Foundry pra rodar os testes em Node puro.
 *
 * Os módulos testados são as funções PURAS do sistema (matemática de dados, conversão de moeda,
 * regras de tier, presets de Módulo) — nenhuma delas fala com o Foundry. O problema é que o
 * arquivo onde elas moram importa `config.js`, e o Foundry injeta algumas coisas globalmente
 * (`Math.clamp`, `foundry.utils.*`) que em Node não existem. Este arquivo preenche só o que é
 * de fato tocado no caminho de import — deliberadamente NÃO é um mock do Foundry inteiro: se um
 * teste precisar de algo além disto, o certo é testar uma função mais pura, não crescer o mock.
 */

// `Math.clamp` é uma extensão do Foundry (não existe no JS padrão).
if (typeof Math.clamp !== "function") {
  Math.clamp = (value, min, max) => Math.min(Math.max(value, min), max);
}

globalThis.foundry ??= {};
foundry.utils ??= {};

// `data/*.js` monta schemas no topo do módulo (`const fields = foundry.data.fields`) e estende
// `foundry.abstract.TypeDataModel` na definição das classes — as duas coisas acontecem só por
// IMPORTAR o arquivo, antes de qualquer teste rodar. Os stubs existem pra que o import não
// exploda; nenhum teste chama schema ou Data Model de verdade (se precisasse, o alvo estaria
// errado — ver o critério no cabeçalho deste arquivo).
foundry.data ??= { fields: {} };
foundry.abstract ??= { TypeDataModel: class {} };

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
