/**
 * Ponto de entrada do sistema "Nihility RPG System".
 * Registra Data Models, Game Settings, Sheets, o AI Helper e a criação
 * automática de Compêndios de World.
 */
import {
  SYSTEM_ID,
  NIHILITY,
  registerSystemSettings,
  applyRoundSeconds,
  getSkillPointsPerLevel,
  getSkillPointsStarting,
  isSkillPointsEnabled,
  isVesselsEnabled
} from "./core/config.js";
import { CharacterDataModel } from "./data/character-model.js";
import { PileDataModel } from "./data/pile-model.js";
import { NihilityPileSheet } from "./sheets/pile-sheet.js";
import { StarshipDataModel, VehicleDataModel } from "./starship/starship-model.js";
import {
  SkillDataModel,
  BodyPartDataModel,
  TitleDataModel,
  StarshipModuleDataModel,
  GenericItemDataModel
} from "./data/item-models.js";
import { AIHelper } from "./ai/ai-helper.js";
import { ensureSystemCompendiums, registerCompendiumCreateDefaults } from "./core/compendium.js";
import { renderSkillRequestControls, removeGrantedSkill } from "./skills/skill-economy.js";
import { announceLevelUp, announceVoiceOfTheWorld } from "./core/voice-of-the-world.js";
import { NihilityActorSheet } from "./sheets/actor-sheet.js";
import { NihilityStarshipSheet, NihilityVehicleSheet } from "./starship/starship-sheet.js";
import { NihilityItemSheet } from "./sheets/item-sheet.js";
import { CurrencyConfigApp } from "./apps/currency-config.js";
import { SpeciesConfigApp } from "./apps/species-config.js";
import { DamageElementsConfigApp } from "./apps/damage-elements-config.js";
import { StatusConditionsConfigApp } from "./apps/status-conditions-config.js";
import { NihilityMenuApp } from "./apps/nihility-menu.js";
import { FeatureConfigApp } from "./apps/feature-config.js";
import { AttributeConfigApp } from "./apps/attribute-config.js";
import { registerAnatomyHooks, registerImplantDragTracking } from "./species/anatomy.js";
import { shutdownActiveSkillsOnDepletion } from "./skills/upkeep.js";
import { isDesignatedGm } from "./helpers/gm-relay.js";
import { reportError } from "./helpers/report.js";
import { registerShieldAdaptationReset } from "./starship/starship-power.js";
import { requestShipRepair, approveShipRepairRoll, restoreShipRepairTarget } from "./starship/starship-repair.js";
import { registerGmRelay } from "./helpers/gm-relay.js";
import { registerAllRelayActions } from "./core/relay-actions.js";
import { registerInitiative } from "./combat/combat.js";
import { onCombatTurnStart } from "./combat/turn-start.js";
import { registerLuckDice } from "./combat/luck-dice.js";
import { registerReroll, renderRerollControls } from "./skills/reroll.js";
import { registerMovementLimit } from "./combat/movement.js";
import { registerConditionalRefresh } from "./combat/conditional-context.js";
import { registerFieldAntimagic } from "./combat/antimagic.js";
import { collapseStructuresOfCaster, renderStructureControls, registerStructureContact } from "./structures/structures.js";
import { registerStructureRendering } from "./structures/structure-render.js";
import { registerFloatingNumbers } from "./combat/floating-numbers.js";
import { registerReactionFloats } from "./combat/reactions.js";
import { registerEffectBadges, registerSystemEffectIcons } from "./combat/effect-badges.js";
import { registerVoiceBanner } from "./core/voice-banner.js";
import { registerEndCombat } from "./apps/end-combat.js";
import { registerSkillTimers } from "./skills/preparation.js";
import { registerSkillUndo, renderSkillUndo } from "./skills/skill-undo.js";
import { registerNpcTierHooks } from "./npc/npc-generator.js";
import { registerEncounterSimTracker } from "./apps/encounter-sim.js";
import { registerCombatPanelTracker } from "./apps/combat-panel.js";
import { registerCreationHooks, renderCreationReadyControls } from "./creation/creation.js";
import { registerGlossaryLinks } from "./glossary/glossary.js";
import { registerHotbarMacros, useItemFromHotbar } from "./core/hotbar.js";
import { registerWeaponMastery, renderMasterySuggestion, unarmedAttackFromHotbar } from "./combat/weapon-mastery.js";
import { registerIncapacitation } from "./combat/incapacitation.js";
import { registerEnvironment } from "./environment/environment.js";
import { registerRadiation } from "./environment/radiation.js";
import { registerTimeRate } from "./combat/time-rate.js";
import { registerTimeRewind, renderTimeRewind } from "./combat/time-rewind.js";
import { registerTimeStop } from "./combat/time-stop.js";
import { registerTraps } from "./environment/traps.js";
import { registerTimeChamber } from "./core/time-chamber.js";
import { registerWorldClock } from "./core/world-clock.js";
import { registerElevation } from "./combat/elevation.js";
import { registerForms } from "./skills/forms.js";
import { renderFormRequestControls } from "./skills/form-request.js";
import { registerSenses } from "./combat/senses.js";
import { registerNaming } from "./species/naming.js";
import { registerPredation } from "./skills/predation.js";
import { registerEnvironmentSceneMenu } from "./apps/environment-config.js";
import { registerSceneFolders } from "./environment/scene-config-apply.js";
import { registerShieldLightHooks } from "./combat/lights.js";
import { registerShieldPoolReconcile } from "./combat/shield-pools.js";
import { registerStatusConditions, interceptManualCondition } from "./combat/conditions.js";
import { registerModuleInstallRules } from "./starship/module-install.js";
import { registerShops } from "./economy/shops.js";
import { registerLoot } from "./economy/loot.js";
import { runPendingMigrations } from "./core/migrations.js";
import { registerDuelRules } from "./skills/duel.js";
import { registerSurfaces } from "./environment/surfaces.js";
import { renderDamageControls, renderDamageTrace } from "./combat/damage-apply.js";
import { isSpeciesLocked } from "./species/species-rules.js";
import { notifyIncomingPadMessage } from "./pad/pad-messaging.js";
import { isEnergyPoolEnabled } from "./core/config.js";
import { registerPortraitHelper } from "./helpers/portrait-frame.js";
import {
  actorsCollection,
  itemsCollection,
  coreActorSheetClass,
  coreItemSheetClass,
  registerSystemPartials
} from "./helpers/foundry-compat.js";

Hooks.once("init", () => {
  registerPortraitHelper();
  console.log(`${SYSTEM_ID} | Inicializando sistema...`);

  // Namespace público para macros, módulos externos e o AI Helper (game.nihility.ai).
  // openAssistant() é o atalho de macro para o Assistente de IA, caso o botão
  // injetado no diretório de Atores não apareça em alguma versão do Foundry.
  game.nihility = {
    id: SYSTEM_ID,
    config: NIHILITY,
    ai: AIHelper,
    openAssistant: () => new NihilityMenuApp().render(true),
    // Overhaul de Naves, Fase 7 — rode via macro na hotbar pra pedir reparo de Módulo/Nave.
    requestShipRepair: () => requestShipRepair(),
    // Macro criada ao arrastar uma Skill/arma da ficha para a hotbar (ver core/hotbar.js).
    useItem: uuid => useItemFromHotbar(uuid),
    // Ataque desarmado (H6) pela hotbar: arrastar a linha "Ataque desarmado" da ficha cria esta macro.
    unarmedAttack: actorUuid => unarmedAttackFromHotbar(actorUuid),
    // Gerador de NPC por arquétipo (só o Mestre).
    generateNpc: async () => (await import("./apps/npc-generator.js")).openNpcGenerator(),
    // Simulador de encontro (só o Mestre).
    simulateEncounter: async () => (await import("./apps/encounter-sim.js")).openEncounterSim(),
    // Ferramentas da mesa (L6, H10).
    tableRules: async () => (await import("./core/table-rules-journal.js")).generateTableRulesJournal(),
    combatPanel: async () => (await import("./apps/combat-panel.js")).openCombatPanel(),
    // Relógio do mundo (J9, só o Mestre) e pontos de restauração de ficha (H13, só o Mestre).
    clock: async () => (await import("./apps/world-clock-app.js")).openWorldClock(),
    restorePoints: async actorUuid => (await import("./world/actor-snapshots.js")).openRestorePoints(await fromUuid(actorUuid)),
    // Glossário do mundo (1.85.0), opcionalmente já num verbete: game.nihility.glossary("penetration").
    glossary: async key => (await import("./glossary/glossary.js")).openGlossary(key),
    // Ficha em modo criação (J10): jogador pede ao Mestre; Mestre cria direto.
    createCharacter: async () => (await import("./creation/creation.js")).requestNewCharacter(),
    // Nomeação (7a) pelo Token marcado com T (um jogador só abre o HUD de Token que controla).
    nameTarget: async () => {
      const token = game.user.targets?.first?.();
      if (!token) return ui.notifications.warn("Marque (tecla T) o Token a nomear.");
      return (await import("./species/naming.js")).requestNaming(token.document);
    }
  };

  registerSystemSettings();

  // Editores visuais (Settings Menu) para as settings de config:false acima.
  game.settings.registerMenu(SYSTEM_ID, "featureConfigMenu", {
    name: "Configurar Módulos do Sistema",
    label: "Configurar Módulos do Sistema",
    hint: "Liga/desliga blocos do sistema (Naves, Títulos, Fusão, PAD...) e aplica presets de campanha.",
    icon: "fas fa-toggle-on",
    type: FeatureConfigApp,
    restricted: true
  });

  game.settings.registerMenu(SYSTEM_ID, "attributeConfigMenu", {
    name: "Configurar Atributos",
    label: "Configurar Atributos",
    hint: "Renomeie os Atributos de Combate ou esconda os que esta campanha não usa.",
    icon: "fas fa-chart-simple",
    type: AttributeConfigApp,
    restricted: true
  });

  game.settings.registerMenu(SYSTEM_ID, "currencyConfigMenu", {
    name: "Configurar Moedas",
    label: "Configurar Moedas",
    hint: "Adicione, edite ou remova as moedas usadas nas fichas.",
    icon: "fas fa-coins",
    type: CurrencyConfigApp,
    restricted: true
  });

  game.settings.registerMenu(SYSTEM_ID, "speciesConfigMenu", {
    name: "Configurar Presets de Espécie",
    label: "Configurar Presets de Espécie",
    hint: "Adicione, edite ou remova espécies e suas Partes do Corpo padrão.",
    icon: "fas fa-dna",
    type: SpeciesConfigApp,
    restricted: true
  });

  game.settings.registerMenu(SYSTEM_ID, "damageElementsConfigMenu", {
    name: "Configurar Tipos de Dano",
    label: "Configurar Tipos de Dano",
    hint: "Adicione, edite ou remova os tipos de dano elemental disponíveis para Skills.",
    icon: "fas fa-fire",
    type: DamageElementsConfigApp,
    restricted: true
  });

  game.settings.registerMenu(SYSTEM_ID, "statusConditionsConfigMenu", {
    name: "Configurar Condições de Status",
    label: "Configurar Condições de Status",
    hint: "Adicione, edite ou remova as Condições (Cegueira, Veneno, Atordoamento...) disponíveis nos Efeitos de Skills.",
    icon: "fas fa-skull-crossbones",
    type: StatusConditionsConfigApp,
    restricted: true
  });

  // Iniciativa pelo pool de dados do Ator (ver module/combat.js) — precisa rodar no `init`,
  // antes de qualquer Combate existir.
  registerInitiative();
  // Sorte (8d.1): modificadores de dado `lu<n>`/`ul<n>`.
  registerLuckDice();
  // Rerrolar (8d.2): marca a iniciativa rolada pelo Combate com o que é preciso para refazê-la.
  registerReroll();
  registerCompendiumCreateDefaults();
  registerStructureRendering();
  registerShieldLightHooks();
  registerShieldPoolReconcile();
  registerShieldAdaptationReset();
  registerStructureContact();
  registerModuleInstallRules();
  // Lojas (G2): reabastecer pelo relógio do mundo e redesenhar a vitrine/avaliação abertas.
  registerShops();
  // Saque, pilhas no mapa, depósito de entregas e troca entre jogadores (G2, lote B).
  registerLoot();
  registerDuelRules();
  registerFieldAntimagic();
  registerFloatingNumbers();
  registerReactionFloats();
  registerVoiceBanner();
  registerEndCombat();
  registerSkillUndo();
  registerNpcTierHooks();
  registerEncounterSimTracker();
  registerCombatPanelTracker();
  // Ficha em modo criação (J10): trava de quem escreve, re-render nos pedidos, aviso "está pronto",
  // e o nome do Token acompanhando o da ficha.
  registerCreationHooks();
  // Link "Abrir o Glossário" do diário Regras desta mesa (o diário não roda script).
  registerGlossaryLinks();
  registerHotbarMacros();
  registerWeaponMastery();
  registerIncapacitation();
  registerSkillTimers();
  registerTimeRate();
  registerTimeStop();
  registerTimeRewind();
  registerEnvironment();
  registerEnvironmentSceneMenu();
  registerSceneFolders();
  registerRadiation();
  // Armadilhas de Região (I1) e Relógio do mundo (J9).
  registerTraps();
  registerTimeChamber();
  // Superfícies (8.2): entrada por movimento, validade pelo relógio do mundo.
  registerSurfaces();
  registerWorldClock();
  // Voo, altura e escavação (J4): botões ↑/↓ no Token HUD, queda, aviso de elevação à mão.
  registerElevation();
  registerForms();
  registerSenses();
  // Nomeação e Corredor de alma (7a): botão "Nomear" no Token HUD, card do pedido e XP compartilhado.
  registerNaming();
  // Predação (7b): o card do Mestre com Confirmar/Cancelar.
  registerPredation();

  // Partials reaproveitados entre templates (hoje só a Habilidade Concedida, usada 3x na ficha
  // de Item). Precisa estar registrado antes da primeira ficha abrir.
  registerSystemPartials({
    "nihility.grantedSkill": `systems/${SYSTEM_ID}/templates/parts/granted-skill.hbs`,
    "nihility.regenBlock": `systems/${SYSTEM_ID}/templates/parts/regen-block.hbs`,
    "nihility.elementChips": `systems/${SYSTEM_ID}/templates/parts/element-chips.hbs`,
    "nihility.traits": `systems/${SYSTEM_ID}/templates/parts/traits.hbs`,
    "nihility.conditionalModifiers": `systems/${SYSTEM_ID}/templates/parts/conditional-modifiers.hbs`,
    "nihility.effectCards": `systems/${SYSTEM_ID}/templates/parts/effect-cards.hbs`,
    "nihility.advSummary": `systems/${SYSTEM_ID}/templates/parts/adv-summary.hbs`,
    "nihility.skillWarnings": `systems/${SYSTEM_ID}/templates/parts/skill-warnings.hbs`,
    "nihility.itemShop": `systems/${SYSTEM_ID}/templates/parts/item-shop.hbs`
  });

  // Deslocamento por rodada (ver module/movement.js). Instala a classe de Token e os hooks no
  // `init`; cada um confere `isMovementEnabled()` na hora de agir, então o toggle vale sem reload.
  registerMovementLimit();
  // Depois do limite de deslocamento: as duas subclasses de Token se encadeiam.
  registerEffectBadges();
  registerSystemEffectIcons();

  // Bônus condicionais que dependem de "estou em combate" (ver conditional-context.js).
  registerConditionalRefresh();

  // Campos que o Foundry oferece nos seletores de barra de token. Sem isso ele lista o schema
  // cru, onde "shields.regenRate" aparece como se fosse uma barra plausível.
  CONFIG.Actor.trackableAttributes = {
    character: { bar: ["attributes.hp", "attributes.energy"], value: ["attributes.shield.value", "attributes.level"] },
    starship: { bar: ["shields", "casco", "hull", "powerGrid.capacitor"], value: ["powerGrid.reactorOutput"] },
    vehicle: { bar: ["shields", "casco", "hull", "fuel", "powerGrid.capacitor"], value: ["powerGrid.reactorOutput"] }
  };

  // Registro dos Data Models por tipo de documento (substitui template.json).
  CONFIG.Actor.dataModels.character = CharacterDataModel;
  CONFIG.Actor.dataModels.starship = StarshipDataModel;
  CONFIG.Actor.dataModels.vehicle = VehicleDataModel;
  CONFIG.Actor.dataModels.pile = PileDataModel;

  CONFIG.Item.dataModels.skill = SkillDataModel;
  CONFIG.Item.dataModels.body_part = BodyPartDataModel;
  CONFIG.Item.dataModels.title = TitleDataModel;
  CONFIG.Item.dataModels.starship_module = StarshipModuleDataModel;
  CONFIG.Item.dataModels.item = GenericItemDataModel;

  // NPCs/monstros/montarias usam o MESMO tipo "character", só com isPlayerCharacter=false —
  // não existe um Data Model separado pra eles (tinha um, `CreatureDataModel`, que nunca foi
  // registrado em lugar nenhum e por isso foi removido).

  // Registro das Sheets customizadas, substituindo as fichas padrão do core.
  const ActorsCollection = actorsCollection();
  const ItemsCollection = itemsCollection();

  ActorsCollection.unregisterSheet("core", coreActorSheetClass());
  ActorsCollection.registerSheet(SYSTEM_ID, NihilityActorSheet, { types: ["character"], makeDefault: true });
  ActorsCollection.registerSheet(SYSTEM_ID, NihilityStarshipSheet, { types: ["starship"], makeDefault: true });
  ActorsCollection.registerSheet(SYSTEM_ID, NihilityVehicleSheet, { types: ["vehicle"], makeDefault: true });
  ActorsCollection.registerSheet(SYSTEM_ID, NihilityPileSheet, { types: ["pile"], makeDefault: true });

  ItemsCollection.unregisterSheet("core", coreItemSheetClass());
  ItemsCollection.registerSheet(SYSTEM_ID, NihilityItemSheet, {
    types: ["skill", "body_part", "title", "starship_module", "item"],
    makeDefault: true
  });

  // Menu Principal do sistema. Fica AQUI dentro (e não no topo do módulo, como ficava antes):
  // registrar setting/menu fora do hook `init` não é suportado pela API — rodava em tempo de
  // import, antes de o Foundry garantir que `game.settings` existe, e qualquer mudança na
  // ordem de boot derrubaria o sistema inteiro na hora de carregar.
  game.settings.registerMenu(SYSTEM_ID, "nihilityMainMenu", {
    name: "Menu Principal Nihility",
    label: "Menu Principal",
    hint: "Interface centralizada para todas as funcionalidades do sistema.",
    icon: "fas fa-th-large",
    type: NihilityMenuApp,
    restricted: true
  });
});

Hooks.once("ready", async () => {
  // Canal de socket que deixa um cliente sem permissão pedir a escrita ao Mestre (ver
  // helpers/gm-relay.js) — é o que faz XP de Resistência funcionar em jogador vs. jogador.
  // As ações do relay moram nos subsistemas; têm de estar no mapa antes de o socket escutar.
  registerAllRelayActions();
  registerGmRelay();
  applyRoundSeconds();

  // Anatomia (board 5): Condições das partes perdidas, aviso de parte vital e o destaque de onde
  // um implante arrastado cabe.
  registerAnatomyHooks();
  registerImplantDragTracking();

  // Condições do sistema na paleta do token HUD (ver module/conditions.js). Roda no `ready`
  // porque lê a setting do catálogo, que só existe depois do `init`.
  registerStatusConditions();

  await ensureSystemCompendiums();
  await runPendingMigrations();
  console.log(`${SYSTEM_ID} | Sistema pronto.`);
});

// Concede os Pontos de Habilidade Normais iniciais (setting "Pontos de Habilidade Normais —
// Criação") em Personagens novos. Só entra se `system.skillPoints.normal` não veio explícito
// nos dados de criação — assim duplicar/importar um Ator existente (que carrega seu valor
// atual) não ganha pontos extra de graça.
/**
 * Barras de token por tipo de Ator. Personagem/Montaria mostra Vida e Mana; Nave/Veículo mostra
 * Escudo e Casco — o Foundry só tem DUAS barras, e a Integridade Estrutural (a camada final da
 * cascata) fica visível na ficha.
 *
 * Aplicado só em Ator NOVO e só quando os dados de criação não trazem `prototypeToken` próprio:
 * duplicar ou importar um Ator tem que preservar a configuração que ele já tinha (mesma cautela
 * do grant de Pontos de Habilidade na criação, logo abaixo).
 */
function defaultPrototypeToken(type) {
  // Pilha/Depósito (Lojas, lote B): sem barras, sem visão; o nome aparece ao passar o mouse.
  if (type === "pile") {
    return {
      "prototypeToken.actorLink": false,
      "prototypeToken.displayName": CONST.TOKEN_DISPLAY_MODES.HOVER,
      "prototypeToken.sight.enabled": false,
      "prototypeToken.disposition": CONST.TOKEN_DISPOSITIONS.NEUTRAL
    };
  }
  if (["starship", "vehicle"].includes(type)) {
    return {
      "prototypeToken.bar1.attribute": "shields",
      "prototypeToken.bar2.attribute": "casco",
      // Nave é sempre única no mundo — token não-vinculado criaria cópias com energia própria.
      "prototypeToken.actorLink": true,
      "prototypeToken.displayName": CONST.TOKEN_DISPLAY_MODES.HOVER,
      // Visão ligada: numa cena com Visão de Token, sem isso o Token não enxerga nem usa Sentidos (J4b).
      "prototypeToken.sight.enabled": true
    };
  }

  return {
    "prototypeToken.bar1.attribute": "attributes.hp",
    // Campanha sem pool de Mana não configura a segunda barra em vez de mostrar uma barra vazia.
    "prototypeToken.bar2.attribute": isEnergyPoolEnabled() ? "attributes.energy" : null,
    "prototypeToken.displayName": CONST.TOKEN_DISPLAY_MODES.HOVER,
    // Visão ligada: numa cena com Visão de Token, sem isso o Token não enxerga nem usa Sentidos (J4b).
    "prototypeToken.sight.enabled": true
  };
}

Hooks.on("preCreateActor", (actor, data, options, userId) => {
  if (!data.prototypeToken) actor.updateSource(defaultPrototypeToken(data.type));

  // Naves/Veículos desligados pela campanha (ver NIHILITY.FEATURES) não podem ser CRIADOS —
  // mas as que já existem continuam abrindo e funcionando normalmente. Desligar um bloco nunca
  // apaga nem esconde dado salvo, só impede conteúdo novo.
  if (["starship", "vehicle"].includes(data.type) && !isVesselsEnabled()) {
    ui.notifications.warn(
      "O bloco \"Naves e Veículos\" está desligado neste mundo (Configurar Módulos do Sistema)."
    );
    return false;
  }

  if (data.type !== "character") return;
  if (!isSkillPointsEnabled()) return;
  if (foundry.utils.getProperty(data, "system.skillPoints.normal") !== undefined) return;

  actor.updateSource({ "system.skillPoints.normal": getSkillPointsStarting() });
});

// Concede Pontos de Habilidade Normais automaticamente quando o Nível sobe
// (a quantidade por nível é a setting "Pontos de Habilidade Normais — Por Nível") e avisa
// pela Voz do Mundo. Usa preUpdate (não updateActor) pra mesclar o ganho na mesma escrita,
// em vez de disparar um segundo update — e assim funciona também quando é o próprio jogador
// quem sobe o nível na ficha, não só pelo botão de Level Up do Mestre.
/**
 * Trava da Espécie: depois do primeiro "Confirmar" de Pontos de Atributo, só o Mestre troca a
 * Espécie/Linhagem (a ficha já desliga o seletor; isto cobre qualquer outro caminho).
 */
Hooks.on("preUpdateActor", (actor, changes, options, userId) => {
  if (actor.type !== "character" || game.users.get(userId)?.isGM) return;
  const species = foundry.utils.getProperty(changes, "system.species");
  const lineage = foundry.utils.getProperty(changes, "system.lineage");
  const changing = (species !== undefined && species !== actor.system.species) || (lineage !== undefined && lineage !== actor.system.lineage);
  if (!changing || !isSpeciesLocked(actor.system)) return;
  if (userId === game.user.id) ui.notifications.warn("A Espécie já está definida: só o Mestre pode trocar agora.");
  return false;
});

Hooks.on("preUpdateActor", (actor, changes) => {
  if (actor.type !== "character") return;

  const newLevel = foundry.utils.getProperty(changes, "system.attributes.level");
  if (newLevel === undefined) return;

  const oldLevel = actor.system.attributes.level;
  if (newLevel <= oldLevel) return;

  // Sempre anuncia quando o nível sobe, mesmo que a setting de Pontos por Nível esteja
  // zerada (por isso fica ANTES do early-return de `gained <= 0` logo abaixo).
  announceLevelUp(actor, newLevel);

  if (!isSkillPointsEnabled()) return;

  const gained = (newLevel - oldLevel) * getSkillPointsPerLevel();
  if (gained <= 0) return;

  const currentNormal = actor.system.skillPoints.normal ?? 0;
  foundry.utils.setProperty(changes, "system.skillPoints.normal", currentNormal + gained);
});

/**
 * Avisa o Mestre (e o dono do Ator) quando o XP enche — o Level Up em si continua sendo clique
 * dele, aqui e em Skill. Dispara só na transição pro teto: como o XP é limitado no próprio
 * schema, ganhos posteriores não geram update nenhum e portanto não repetem o aviso.
 */
function announceXpReadyIfJustFilled(actor, label, xp, xpMax) {
  // Mestre designado: o hook roda em todos os clientes, e com `isGM` dois Mestres anunciavam em dobro.
  if (!isDesignatedGm() || !(xpMax > 0) || xp < xpMax) return;
  announceVoiceOfTheWorld(actor, {
    kind: "xp-ready",
    title: "Experiência no limite",
    body: `${label} acumulou todo o XP deste nível (${xpMax}). O Mestre pode subir o nível quando quiser.`
  });
}

// Condição marcada à mão no token abre a tela de configuração antes de existir de verdade
// (duração/efeito/valor, ou nada e vira só marcador visual) — ver module/conditions.js.
Hooks.on("preCreateActiveEffect", (effect, data, options, userId) => interceptManualCondition(effect, data, options, userId));

// Aviso de mensagem nova do PAD. Fica no hook de CRIAÇÃO (e não em quem envia) porque só o
// cliente do destinatário sabe se a conversa está aberta na tela — ver notifyIncomingPadMessage.
Hooks.on("createChatMessage", message => notifyIncomingPadMessage(message));

// Vida ou Mana de quem conjurou em 0 derruba as Estruturas dele que dependem disso (ver
// collapseStructuresOfCaster em structures.js).
Hooks.on("updateActor", (actor, changes) => {
  if (actor.type !== "character") return;
  const hp = foundry.utils.getProperty(changes, "system.attributes.hp.value");
  const energy = foundry.utils.getProperty(changes, "system.attributes.energy.value");
  const hpZero = hp !== undefined && hp <= 0;
  const energyZero = energy !== undefined && energy <= 0;
  if (!hpZero && !energyZero) return;
  collapseStructuresOfCaster(actor, { hpZero, energyZero }).catch(err => reportError("Falha ao derrubar Estruturas.", err, { gmOnly: true }));
});

// Mana em 0 desliga todas as Habilidades Ativas (ver shutdownActiveSkillsOnDepletion). Roda só
// no Mestre designado, pra dois Mestres conectados não desligarem/avisarem em dobro.
// Tripulação: quem joga com um tripulante vira Dono da Nave por qualquer caminho que mude a lista
// (ficha, console, importação) — não só pela aba Tripulação. Idempotente.
Hooks.on("updateActor", async (actor, changes) => {
  if (!["starship", "vehicle"].includes(actor.type) || changes?.system?.crewMembers === undefined || !isDesignatedGm()) return;
  try {
    const { syncShipOwnershipToCrew } = await import("./starship/crew-ownership.js");
    const { syncLibraryOwnershipToCrew } = await import("./pad/pad-library.js");
    await syncLibraryOwnershipToCrew(actor);
    await syncShipOwnershipToCrew(actor);
  } catch (err) {
    console.error("Nihility | falha ao sincronizar a tripulação", err);
  }
});

Hooks.on("updateActor", (actor, changes) => {
  if (actor.type !== "character" || !isEnergyPoolEnabled() || !isDesignatedGm()) return;
  const energy = foundry.utils.getProperty(changes, "system.attributes.energy.value");
  if (energy === undefined || energy > 0) return;
  shutdownActiveSkillsOnDepletion(actor).catch(err => reportError("Falha ao desligar Habilidades Ativas sem Mana.", err, { gmOnly: true }));
});

Hooks.on("updateActor", (actor, changes) => {
  if (foundry.utils.getProperty(changes, "system.attributes.xp") === undefined) return;
  announceXpReadyIfJustFilled(actor, actor.name, actor.system.attributes.xp, actor.system.attributes.xpMax);
});

Hooks.on("updateItem", (item, changes) => {
  if (item.type !== "skill" || !item.parent) return;
  if (foundry.utils.getProperty(changes, "system.xp") === undefined) return;
  announceXpReadyIfJustFilled(item.parent, `${item.name} (de ${item.parent.name})`, item.system.xp, item.system.xpMax);
});

// Limpa a Habilidade Concedida (ver skill-economy.js) quando o Item Geral ou Módulo de
// Nave que a concedeu é excluído — evita skill "órfã" sobrando na ficha.
Hooks.on("preDeleteItem", item => {
  if (!["item", "starship_module"].includes(item.type)) return;
  if (!item.parent) return;
  removeGrantedSkill(item.parent, item.id);
});

// Início de turno: ticks, Zonas, regeneração, manutenção etc. Só o Mestre DESIGNADO executa (com
// `isGM`, um segundo Mestre ticava tudo em dobro). A ordem dos passos está em combat/turn-start.js.
// Registrado aqui, na avaliação do módulo (antes do `ready`): o Reverter depende disso (ver o cabeçalho
// de turn-start.js).
Hooks.on("updateCombat", (combat, changed, options) => onCombatTurnStart(combat, changed, options));

// Botões de Aprovar/Rejeitar nos pedidos de criação de Skill via Pontos de Habilidade.
// `renderChatMessageHTML` (e não o antigo `renderChatMessage`) é o hook do V13+: entrega um
// HTMLElement puro em vez de jQuery, então tudo aqui é DOM nativo.
Hooks.on("renderChatMessageHTML", (message, html) => {
  const on = (selector, handler) => html.querySelectorAll(selector).forEach(el => el.addEventListener("click", handler));

  // Cartão de Estrutura (Vida, dano, derrubar) — ver structures.js.
  renderStructureControls(message, html);

  // Pedido de Skill (Aprovar / Ajustar e aprovar / Pedir mudança / Rejeitar; Editar para quem pediu).
  renderSkillRequestControls(message, html);
  renderFormRequestControls(message, html);
  // Card "está pronto" da ficha em modo criação (Abrir ficha / Pedir ajuste / Liberar, só o Mestre).
  renderCreationReadyControls(message, html);
  // Sugestão de Maestria de arma (aprender pela prática): botão "Dar Maestria de X", só o Mestre.
  renderMasterySuggestion(message, html);

  // Pedido de Reparo de Nave/Veículo (Overhaul de Naves, Fase 7) — o modificador do Mestre é
  // lido do próprio input no momento do clique, não guardado nas flags da mensagem.
  on(".repair-approve", event => {
    const card = event.currentTarget.closest(".nihility-skill-request");
    const modifier = Number(card?.querySelector(".repair-modifier-input")?.value) || 0;
    approveShipRepairRoll(message, modifier);
  });
  on(".repair-restore", () => restoreShipRepairTarget(message));

  // PAD — mensagens e compartilhamentos de contato (estilo WhatsApp/CyberCall) ficam fora do log
  // de chat padrão por padrão; o PAD lê direto de game.messages, independente disso. `showInLog`
  // fica reservado pra uma futura opção de exibição — hoje nenhuma UI liga essa flag.
  // Botões de aplicar dano (só Mestre) — ver module/damage-apply.js.
  renderDamageControls(message, html);
  renderDamageTrace(message, html);
  // Rerrolar (8d.2): "🎲 Rerrolar (Skill)" nas rolagens que uma Skill do usuário alcança.
  renderRerollControls(message, html);
  // Desfazer uso de Skill (só o Mestre, até o turno virar) — ver skills/skill-undo.js.
  renderSkillUndo(message, html);
  renderTimeRewind(message, html);

  const padMessage = message.getFlag(SYSTEM_ID, "padMessage");
  const padContactShare = message.getFlag(SYSTEM_ID, "padContactShare");
  if ((padMessage && !padMessage.showInLog) || padContactShare) html.style.display = "none";
});

// Botão do Menu Principal no diretório de Atores — ponto de entrada único pro sistema.
// Visível pra todo mundo agora (não só GM): o Menu tem uma aba "Fichas" acessível a
// jogadores (abre qualquer Ator que já possuam/tenham Observador); Configurações/IA/
// Geração/Ferramentas continuam bloqueadas por dentro do próprio App pra quem não é GM.
// Se o Foundry mudar essa estrutura de DOM em alguma versão futura e nenhum dos
// seletores abaixo bater, use game.nihility.openAssistant() num macro.
const AI_BUTTON_CONTAINER_SELECTORS = [".directory-footer", ".header-actions", ".directory-header", ".action-buttons"];

Hooks.on("renderActorDirectory", (app, html) => {
  // V13+ entrega um HTMLElement puro neste hook (no V12 era jQuery — por isso o sistema exige
  // V13 como mínimo; ver `compatibility` em system.json).
  const root = html;
  if (!root?.querySelector) return;
  if (root.querySelector(".nihility-ai-assistant-button")) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "nihility-ai-assistant-button";
  button.innerHTML = '<i class="fas fa-th-large"></i> Nihility RPG System';

  // Adiciona evento de clique
  button.addEventListener("click", () => new NihilityMenuApp().render(true));

  let container = null;
  for (const selector of AI_BUTTON_CONTAINER_SELECTORS) {
    const found = root.querySelector(selector);
    if (found) {
      container = found;
      break;
    }
  }

  // Se não encontrou um container específico, usa a própria raiz do diretório.
  (container ?? root).appendChild(button);
});

