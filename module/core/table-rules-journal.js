/**
 * "Regras desta mesa" (backlog L6; canvas "Ferramentas da Mesa", prancha 3): lê o que está ligado
 * e os números deste mundo e cria (ou atualiza) o Diário "Regras desta mesa", com os jogadores
 * como Observador. As páginas geradas levam o flag `tableRulesPage` e são reescritas a cada
 * "Atualizar"; a página "Notas da mesa" é do Mestre e nunca é tocada.
 */
import {
  SYSTEM_ID,
  MEU_SISTEMA,
  isFeatureEnabled,
  getFeatureOption,
  getVitalFormula,
  getAttributeLabel,
  getVisibleAttributes,
  getCharacterEnergyLabel,
  getActiveStatusConditions,
  getActiveDamageElements
} from "./config.js";
import { buildTableRulesPages, conditionSentence } from "./table-rules-text.js";

const setting = (key, fallback) => {
  try {
    const value = game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS[key] ?? key);
    return value ?? fallback;
  } catch (err) {
    return fallback;
  }
};

/** Os dados do mundo que as páginas usam. */
export function gatherTableRules() {
  const vital = getVitalFormula();
  const elements = getActiveDamageElements();
  const byId = Object.fromEntries(elements.map(e => [e.id, e.label]));
  const features = Object.fromEntries(Object.keys(MEU_SISTEMA.FEATURES).map(key => [key, isFeatureEnabled(key)]));
  return {
    date: new Date().toLocaleDateString("pt-BR"),
    systemVersion: game.system.version,
    energyLabel: getCharacterEnergyLabel(),
    attributes: getVisibleAttributes().map(a => a.label),
    vital: {
      hp: vital.hp.map(getAttributeLabel),
      energy: vital.energy.map(getAttributeLabel),
      multiplier: vital.multiplier,
      floor: vital.floor,
      energyEnabled: vital.energyEnabled
    },
    xpFormula: String(setting("xpFormula", "100 * @nivel")).replace(/@nivel/g, "nível"),
    attributePool: features.attributePool,
    pointsStart: setting("attributePointsStarting", 35),
    pointsPerLevel: setting("attributePointsPerLevel", 5),
    skills: {
      powerPerLevel: setting("skillPowerPerLevel", 10),
      discountPerLevel: setting("skillDiscountPerLevel", 20),
      cyclePower: setting("skillCyclePower", 2),
      cycleDiscount: setting("skillCycleDiscount", 2),
      costFloor: setting("skillCostFloorPercent", 10)
    },
    initiative: getAttributeLabel(setting("initiativeAttribute", "dexterity")),
    movement: features.movement
      ? { base: getFeatureOption("movement", "movementBase"), step: getFeatureOption("movement", "movementStep"), cap: getFeatureOption("movement", "movementCap") }
      : null,
    incapacitation: features.incapacitation
      ? { deathRounds: getFeatureOption("incapacitation", "deathRounds"), wakeRounds: getFeatureOption("incapacitation", "wakeRounds"), npcDies: getFeatureOption("incapacitation", "npcDiesAtZero") }
      : null,
    features,
    conditions: getActiveStatusConditions().map(c => ({ label: c.label, sentence: conditionSentence(c, { attributeLabel: getAttributeLabel, energyLabel: getCharacterEnergyLabel() }), explanation: c.explanation ?? "" })),
    elements: elements.map(e => ({ label: e.label, parent: e.parent ? byId[e.parent] ?? "" : "" })),
    // Só os blocos de cima (um sub-bloco desligado com o pai desligado não repete).
    disabled: Object.entries(MEU_SISTEMA.FEATURES)
      .filter(([key, f]) => !features[key] && (!f.parent || features[f.parent]) && f.group !== "gm")
      .map(([, f]) => f.name)
  };
}

/** Cria ou atualiza o Diário e o abre. Só o Mestre. */
export async function generateTableRulesJournal() {
  if (!game.user.isGM) return ui.notifications.warn("Só o Mestre gera as Regras desta mesa.");
  const pages = buildTableRulesPages(gatherTableRules());
  const pageData = pages.map((p, i) => ({
    name: p.name,
    type: "text",
    sort: (i + 1) * 1000,
    text: { content: p.html, format: CONST.JOURNAL_ENTRY_PAGE_FORMATS?.HTML ?? 1 },
    flags: { [SYSTEM_ID]: { tableRulesPage: p.key } }
  }));
  const observer = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
  let journal = game.journal.find(j => j.getFlag(SYSTEM_ID, "tableRules"));
  if (!journal) {
    journal = await JournalEntry.create({
      name: "Regras desta mesa",
      ownership: { default: observer },
      flags: { [SYSTEM_ID]: { tableRules: true } },
      pages: [
        ...pageData,
        { name: "Notas da mesa", type: "text", sort: 100000, text: { content: "<p>Escreva aqui as regras da casa. O botão Atualizar nunca mexe nesta página.</p>", format: CONST.JOURNAL_ENTRY_PAGE_FORMATS?.HTML ?? 1 } }
      ]
    });
  } else {
    const old = journal.pages.filter(p => p.getFlag(SYSTEM_ID, "tableRulesPage")).map(p => p.id);
    if (old.length) await journal.deleteEmbeddedDocuments("JournalEntryPage", old);
    await journal.createEmbeddedDocuments("JournalEntryPage", pageData);
    if ((journal.ownership?.default ?? 0) < observer) await journal.update({ "ownership.default": observer });
  }
  ui.notifications.info(`"Regras desta mesa" ${pages.length} página(s) atualizada(s). Os jogadores podem abrir pelo Diário.`);
  journal.sheet.render(true);
  return journal;
}
