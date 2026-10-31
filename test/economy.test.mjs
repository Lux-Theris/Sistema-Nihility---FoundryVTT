/**
 * Moeda, inventário, porão, consumíveis, cargas, carregador e munição.
 * Critério e como rodar: ver o cabeçalho de test/setup.mjs.
 */
import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";

import {
  convertCurrencyAmount,
  speciesCarry,
  stackCount,
  inventoryLoad,
  currencyWeight,
  carryCapacity,
  encumbrancePenalty,
  cargoSlotsFor,
  cargoMassFactor,
  ammoFitsLauncher
} from "../module/core/config.js";
import {
  consumeUse,
  chargesLeft,
  magazineState,
  ammoFitsWeapon,
  resolveEffectAmount
} from "../module/economy/consumable-rules.js";
import { reloadPlan } from "../module/economy/consumable-rules.js";

/* -------------------------------------------- */
/*  Conversão de moeda                           */
/* -------------------------------------------- */

test("conversão de moeda: usa a razão de Valor-Base das duas moedas", () => {
  // Sem settings, cai nas moedas padrão: ouro=100, prata=10, cobre=1.
  assert.equal(convertCurrencyAmount("gold", "silver", 1), 10);
  assert.equal(convertCurrencyAmount("silver", "gold", 10), 1);
  assert.equal(convertCurrencyAmount("gold", "copper", 2), 200);
  // Conversão que não fecha em inteiro devolve fração — quem trata o resto é a cascata
  // de applyWholeCurrencyAmount (currency.js), não esta função.
  assert.equal(convertCurrencyAmount("silver", "gold", 5), 0.5);
});

test("conversão de moeda: moeda desconhecida devolve 0 em vez de NaN", () => {
  assert.equal(convertCurrencyAmount("gold", "moeda-inexistente", 5), 0);
  assert.equal(convertCurrencyAmount("moeda-inexistente", "gold", 5), 0);
});

test("Inventário: pilhas, contêineres, peso e carga", () => {
  assert.equal(stackCount(0, 20), 0);
  assert.equal(stackCount(1, 20), 1);
  assert.equal(stackCount(20, 20), 1);
  assert.equal(stackCount(21, 20), 2);
  assert.equal(stackCount(5, 0), 1); // sem tamanho: padrão 20
  const load = inventoryLoad(
    [
      { id: "potion", quantity: 25, stackSize: 20, weight: 0.5, containerId: "" },
      { id: "bag", quantity: 1, weight: 1, isContainer: true },
      { id: "rope", quantity: 1, stackSize: 1, weight: 10, containerId: "bag" },
      { id: "gold-bar", quantity: 3, stackSize: 1, weight: 2, containerId: "sumiu" }
    ],
    [{ id: "bag", slots: 4, weightReduction: 50 }]
  );
  assert.equal(load.looseSlots, 2 + 1 + 3); // poções (2 pilhas) + bolsa + barras soltas
  assert.equal(load.byContainer.bag.used, 1);
  assert.equal(load.weight, 12.5 + 1 + 5 + 6);
  assert.equal(currencyWeight({ gold: 100 }, [{ id: "gold", weight: 0.01 }]), 1);
  assert.equal(carryCapacity({ base: 30, strength: 10, defense: 10, bonus: 5 }), 50);
  assert.equal(encumbrancePenalty(40, 50), 0);
  assert.equal(encumbrancePenalty(60, 50), 20);
  assert.equal(encumbrancePenalty(200, 50), 100);
  assert.deepEqual(speciesCarry(undefined, "anao"), { slots: 12, carry: 45 });
  assert.deepEqual(speciesCarry({ inventorySlots: 5, carryBase: 7 }, "anao"), { slots: 5, carry: 7 });
  assert.deepEqual(speciesCarry(undefined, "especie-nova"), { slots: 10, carry: 30 });
});

test("Porão e munição", () => {
  assert.equal(cargoSlotsFor("compact"), 10);
  assert.equal(cargoSlotsFor("colossal", 1.5), 240);
  assert.equal(cargoSlotsFor("standard", 0.75), 15);
  assert.equal(cargoMassFactor(0, 2000), 1);
  assert.equal(cargoMassFactor(2000, 2000), 2);
  assert.equal(cargoMassFactor(500, 0), 1);
  const launcher = { usesAmmo: true, ammoTypes: ["torpedo", "mine"], moduleSize: "standard" };
  assert.equal(ammoFitsLauncher({ enabled: true, type: "torpedo" }, launcher), true);
  assert.equal(ammoFitsLauncher({ enabled: true, type: "missile" }, launcher), false);
  assert.equal(ammoFitsLauncher({ enabled: true, type: "torpedo", minLauncherSize: "reinforced" }, launcher), false);
  assert.equal(ammoFitsLauncher({ enabled: true, type: "torpedo" }, { ...launcher, usesAmmo: false }), false);
});

test("Consumível: sem cargas gasta 1 da pilha; com cargas gasta a unidade aberta primeiro", () => {
  assert.deepEqual(consumeUse({ quantity: 3 }), { quantity: 2, used: 0, unitSpent: true, gone: false, left: 2 }, "granada ×3 → ×2");
  assert.equal(consumeUse({ quantity: 1 }).gone, true, "a última some");
  const kit = consumeUse({ quantity: 2, charges: 5, used: 0 });
  assert.deepEqual(kit, { quantity: 2, used: 1, unitSpent: false, gone: false, left: 9 }, "kit ×2 de 5 cargas: gasta 1 carga, sobram 9 usos");
  assert.equal(chargesLeft({ charges: 5, used: 1 }), 4);
  const last = consumeUse({ quantity: 2, charges: 5, used: 4 });
  assert.deepEqual([last.quantity, last.used, last.unitSpent], [1, 0, true], "acabou a unidade: sai 1 da pilha e a próxima começa cheia");
  assert.equal(consumeUse({ quantity: 1, charges: 5, used: 4 }).gone, true);
  assert.equal(chargesLeft({ charges: 0 }), null, "sem cargas não mostra contador");
  assert.equal(consumeUse({ quantity: 0 }).gone, true, "pilha vazia não usa");
});

test("Arma com carregador e munição; efeito em % do máximo", () => {
  assert.deepEqual(magazineState({ size: 0 }), { uses: false, max: 0, loaded: 0, empty: false, full: true }, "sem carregador = infinito");
  assert.equal(magazineState({ size: 10, loaded: 0 }).empty, true);
  assert.equal(magazineState({ size: 10, loaded: 25 }).loaded, 10, "carregador diminuído conta como cheio");
  assert.equal(ammoFitsWeapon("cell", []), true, "arma sem tipos aceita qualquer munição");
  assert.equal(ammoFitsWeapon("cell", ["cell", "plasma"]), true);
  assert.equal(ammoFitsWeapon("arrow", ["cell"]), false);
  assert.equal(resolveEffectAmount(25, "percentMax", 1000), 250, "Poção 25% em quem tem 1000 de Vida");
  assert.equal(resolveEffectAmount(25, "percentMax", 100), 25);
  assert.equal(resolveEffectAmount(1, "percentMax", 50), 1, "1% de 50 ainda cura 1");
  assert.equal(resolveEffectAmount(-10, "percentMax", 200), -20, "dano/debuff em % também");
  assert.equal(resolveEffectAmount(7, "flat", 1000), 7, "fixo passa direto");
});

test("Trocar munição: o que estava dentro volta (cheio pra pilha, aberto com o que sobrou)", () => {
  assert.deepEqual(reloadPlan({ size: 10, loaded: 5 }), { loaded: 10, max: 10, returned: { rounds: 5 } }, "5/10 volta como aberta (5)");
  assert.deepEqual(reloadPlan({ size: 10, loaded: 10 }), { loaded: 10, max: 10, returned: { rounds: 0 } }, "cheia volta pra pilha normal");
  assert.deepEqual(reloadPlan({ size: 10, loaded: 0 }), { loaded: 10, max: 10, returned: null }, "vazia não devolve nada");
  assert.deepEqual(reloadPlan({ size: 10, loaded: 0, ammoRounds: 4 }), { loaded: 4, max: 10, returned: null }, "unidade aberta dá só o que tinha");
  assert.deepEqual(reloadPlan({ size: 10, loaded: 2, ammoRounds: 30 }), { loaded: 10, max: 10, returned: { rounds: 2 } }, "aberta maior que o carregador enche");
});

test("Munição com Carga própria: Célula de 20 e Célula de 10 na mesma arma", () => {
  assert.deepEqual(reloadPlan({ size: 10, loaded: 0, capacity: 20 }), { loaded: 20, max: 20, returned: null }, "a Carga da munição manda, não o carregador da arma");
  assert.deepEqual(reloadPlan({ size: 10, loaded: 20, currentMax: 20, capacity: 10 }), { loaded: 10, max: 10, returned: { rounds: 0 } }, "a de 20 ainda cheia volta pra pilha");
  assert.deepEqual(reloadPlan({ size: 10, loaded: 12, currentMax: 20, capacity: 10 }).returned, { rounds: 12 }, "12/20 volta aberta (12) — não é 'cheia' só por passar de 10");
  assert.deepEqual(reloadPlan({ size: 10, loaded: 0, ammoRounds: 12, capacity: 20 }), { loaded: 12, max: 20, returned: null }, "aberta de 20 com 12 entra 12/20");
  assert.deepEqual(magazineState({ size: 10, loaded: 18, capacity: 20 }), { uses: true, max: 20, loaded: 18, empty: false, full: false }, "18/20 com a Célula grande");
  assert.equal(magazineState({ size: 0, loaded: 5, capacity: 20 }).uses, false, "sem carregador na arma, munição não muda nada");
});
