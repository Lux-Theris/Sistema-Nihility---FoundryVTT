/**
 * Conversão e transferência de Moedas Dinâmicas — extraído de ai-helper.js (Fase 4 do
 * refactor). Nada aqui tem relação com IA; ficava em ai-helper.js só por herança histórica.
 */
import { getActiveCurrencies, convertCurrencyAmount } from "./config.js";
import { announceVoiceOfTheWorld } from "./voice-of-the-world.js";

/**
 * Soma `rawAmount` (pode ser fracionário) na moeda `currencyId` dentro de `updates`.
 * Nunca deixa fração na moeda de destino: a parte inteira fica ali, e a fração
 * "cai" pra moeda de Valor-Base mais próxima abaixo (convertida pra unidades
 * dela), recursivamente, até sobrar zero ou não haver mais nenhuma moeda menor
 * (aí a fração residual é descartada — só acontece se essa já for a menor de todas).
 */
function applyWholeCurrencyAmount(actor, currencyId, rawAmount, updates) {
  const whole = Math.floor(rawAmount);
  const fraction = rawAmount - whole;

  const key = `system.currencies.${currencyId}`;
  const current = foundry.utils.getProperty(updates, key) ?? actor.system.currencies?.[currencyId] ?? 0;
  foundry.utils.setProperty(updates, key, current + whole);

  if (fraction <= 1e-9) return;

  const currencies = getActiveCurrencies();
  const currentCurrency = currencies.find(c => c.id === currencyId);
  const currentBaseValue = currentCurrency?.baseValue ?? 1;

  const nextLower = currencies
    .filter(c => c.id !== currencyId && (c.baseValue ?? 1) < currentBaseValue)
    .sort((a, b) => (b.baseValue ?? 1) - (a.baseValue ?? 1))[0];

  if (!nextLower) return; // já é a moeda de menor Valor-Base — não tem pra onde a fração cair

  const fractionInLowerUnits = (fraction * currentBaseValue) / (nextLower.baseValue ?? 1);
  applyWholeCurrencyAmount(actor, nextLower.id, fractionInLowerUnits, updates);
}

/**
 * Converte uma quantidade de uma moeda da ficha do Ator para outra, usando a
 * razão de Valor-Base das duas (funciona pra qualquer hierarquia de moedas
 * que o Mestre tiver configurado no editor visual). Nunca gera fração: se a
 * conversão não fechar num número inteiro na moeda de destino, o resto cai
 * automaticamente pra moeda de Valor-Base mais próxima abaixo (nunca 0,5 Ouro
 * solto — vira o correspondente em Prata, por exemplo).
 * @returns {Promise<number>} quantidade inteira creditada na moeda de destino
 */
export async function convertActorCurrency(actor, fromId, toId, amount) {
  const currentFrom = actor.system.currencies?.[fromId] ?? 0;
  if (amount <= 0 || currentFrom < amount) {
    ui.notifications?.warn("Saldo insuficiente para converter.");
    throw new Error("Saldo insuficiente.");
  }

  const rawConverted = convertCurrencyAmount(fromId, toId, amount);
  if (!rawConverted) {
    ui.notifications?.warn("Conversão inválida (confira o Valor-Base das moedas em Configurar Moedas).");
    throw new Error("Conversão inválida.");
  }

  const updates = {};
  applyWholeCurrencyAmount(actor, toId, rawConverted, updates);

  // A fração pode ter caído de volta na própria moeda de origem (ex: convertendo
  // Prata->Ouro, o resto de Ouro cai justamente em Prata) — soma sobre o que já
  // estiver em `updates`, nunca sobrescreve.
  const fromKey = `system.currencies.${fromId}`;
  const alreadyCredited = foundry.utils.getProperty(updates, fromKey) ?? actor.system.currencies?.[fromId] ?? 0;
  foundry.utils.setProperty(updates, fromKey, alreadyCredited - amount);

  await actor.update(updates);
  return Math.floor(rawConverted);
}

/**
 * Transfere uma quantidade de uma moeda da ficha de um Ator pra outro, e
 * publica um recibo privado (Voz do Mundo) pros dois donos + Mestre.
 */
export async function transferCurrency(fromActor, toActor, currencyId, amount) {
  const currentFrom = fromActor.system.currencies?.[currencyId] ?? 0;
  if (amount <= 0 || currentFrom < amount) {
    ui.notifications?.warn("Saldo insuficiente para enviar.");
    throw new Error("Saldo insuficiente.");
  }

  const currentTo = toActor.system.currencies?.[currencyId] ?? 0;
  await fromActor.update({ [`system.currencies.${currencyId}`]: currentFrom - amount });
  await toActor.update({ [`system.currencies.${currencyId}`]: currentTo + amount });

  const label = getActiveCurrencies().find(c => c.id === currencyId)?.label ?? currencyId;
  const receiptBody = `${fromActor.name} enviou ${amount} ${label} para ${toActor.name}.`;

  await announceVoiceOfTheWorld(fromActor, { kind: "transfer", title: "Transferência Enviada", body: receiptBody });
  await announceVoiceOfTheWorld(toActor, { kind: "transfer", title: "Transferência Recebida", body: receiptBody });
}
