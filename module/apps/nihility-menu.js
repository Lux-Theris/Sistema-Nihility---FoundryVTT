/**
 * Menu principal do Nihility RPG System — hub em duas colunas (trilha lateral + conteúdo).
 * "Fichas" é a única aba visível/usável para jogadores (abre qualquer Ator que já possuam
 * ou tenham permissão de Observador); Configurações/IA/Geração/Ferramentas continuam
 * exclusivas do Mestre — a trilha mostra essas abas com cadeado pro jogador em vez de
 * simplesmente escondê-las, pra deixar claro que existem e são intencionalmente bloqueadas.
 */
import {
  SYSTEM_ID,
  MEU_SISTEMA,
  isVesselsEnabled,
  isAIAssistantEnabled,
  isFeatureEnabled,
  getActiveDamageElements,
  getActiveStatusConditions,
  getActiveTraits,
  getActiveCurrencies,
  getActiveSpeciesPresets,
  getScaleConfig,
  getStructures,
  getModuleCategories,
  getVesselClasses,
  getCrewRoles,
  getVisibleAttributes,
  debugLog
} from "../config.js";
import { ensureSystemCompendiums, registerItemInCompendium } from "../compendium.js";
import { saveTextToFile, readFileAsText } from "../helpers/foundry-compat.js";
import { readTransferBundle, buildTransferBundle, diffTransfer, transferGroup } from "../config-transfer.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

/** Ações que abrem o AIAssistantApp já no modo "Criar" com a tarefa certa. */
const AI_TASK_ACTIONS = {
  "generate-npc": "npc",
  "generate-character": "npc", // mesma capacidade da aba de IA, rótulo diferente na aba de Geração
  "generate-mount": "mount",
  "generate-starship": "starship",
  "generate-vehicle": "vehicle",
  "generate-skill": "skill",
  "generate-note": "note",
  "generate-item": "item",
  freeform: "freeform"
};

/** Abas exclusivas do Mestre — o jogador nunca consegue selecioná-las, mesmo clicando no item travado da trilha. */
const GM_ONLY_TABS = ["system", "ai", "generation", "tools"];

/**
 * Macros que o sistema oferece pra hotbar. `game.nihility.*` é a API pública (ver o `init` em
 * nihility-rpg-system.js) — estas macros existem só pra poupar o Mestre de digitar a chamada à
 * mão, que era a única forma de chegar nelas antes.
 *
 * `ownership.default: OBSERVER` no Reparo é proposital: reparar é uma ação de JOGADOR (ele
 * escolhe a Nave, a peça e o engenheiro; o Mestre só rola e aprova depois), então a macro
 * precisa ser executável por quem não é Mestre. O Menu Principal também é aberto a jogadores,
 * por causa da aba "Fichas".
 */
const SYSTEM_MACROS = [
  {
    name: "Nihility — Menu Principal",
    img: "icons/svg/book.svg",
    command: "game.nihility.openAssistant();"
  },
  {
    name: "Nihility — Conceder XP",
    img: "icons/svg/upgrade.svg",
    // Abre a ficha do Ator selecionado direto na aba onde o bloco de XP (só-Mestre) aparece —
    // conceder XP mora lá, junto do estado atual, em vez de num diálogo solto sem contexto.
    command: [
      "const actor = canvas.tokens.controlled[0]?.actor ?? game.user.character;",
      'if (!actor) ui.notifications.warn("Selecione o token de um Personagem primeiro.");',
      "else actor.sheet.render(true);"
    ].join("\n")
  },
  {
    name: "Nihility — Pedir Reparo de Nave",
    img: "icons/svg/hazard.svg",
    command: "game.nihility.requestShipRepair();"
  }
];

/**
 * Cria as macros do sistema no mundo e coloca cada uma na primeira vaga livre da hotbar de quem
 * clicou. Idempotente: uma macro com o mesmo nome que já exista é reaproveitada (nunca duplica,
 * e nunca sobrescreve uma que o Mestre tenha editado à mão).
 */
async function createSystemMacros() {
  const created = [];
  const reused = [];

  for (const definition of SYSTEM_MACROS) {
    let macro = game.macros.find(m => m.name === definition.name);
    if (macro) {
      reused.push(macro);
    } else {
      macro = await Macro.create({
        name: definition.name,
        type: "script",
        img: definition.img,
        command: definition.command,
        ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER }
      });
      if (macro) created.push(macro);
    }

    // Só ocupa a hotbar se a macro ainda não estiver nela — e só se sobrar vaga (slots 1-50).
    if (macro && !Object.values(game.user.hotbar).includes(macro.id)) {
      const freeSlot = Array.from({ length: 50 }, (_, i) => i + 1).find(slot => !game.user.hotbar[slot]);
      if (freeSlot) await game.user.assignHotbarMacro(macro, freeSlot);
    }
  }

  const parts = [];
  if (created.length) parts.push(`${created.length} macro(s) criada(s)`);
  if (reused.length) parts.push(`${reused.length} já existia(m)`);
  ui.notifications.info(`${parts.join(", ")} — confira a barra de macros.`);
}

/**
 * Skills de exemplo pro Compêndio, pra um mundo novo não começar 100% vazio — e pra servirem de
 * referência de como cada campo se comporta.
 *
 * **Só tier Extra e Normal, nunca Único ou Ultimate**: essas duas só nascem de fusão e de
 * narrativa na mesa, então vir uma pronta no Compêndio contradiria a própria regra do sistema.
 *
 * A divisão segue a do mundo: **Extra** é o que um humano bem treinado do nosso mundo faria;
 * **Normal** é a evolução com componente mágico/arcano por cima.
 */
const SAMPLE_SKILLS = [
  // ---------------- Extra: perícia humana, sem nada sobrenatural
  { name: "Golpe Preciso", tier: "extra", cost: 4, effectType: "damage", damageFormula: "1d8", scalingAttribute: "precision",
    description: "<p>Um ataque calculado, mirando a brecha na guarda em vez da força bruta.</p>" },
  { name: "Investida", tier: "extra", cost: 5, effectType: "damage", damageFormula: "1d10", scalingAttribute: "strength",
    description: "<p>Avança usando o peso do corpo inteiro para carregar o golpe.</p>" },
  { name: "Passo Lateral", tier: "extra", cost: 3, effectType: "temporary",
    effects: [{ target: "defense", amount: 3, durationRounds: 2 }],
    description: "<p>Um deslocamento curto e treinado que abre ângulo e fecha a guarda.</p>" },
  { name: "Leitura de Combate", tier: "extra", cost: 3, effectType: "temporary",
    effects: [{ target: "precision", amount: 3, durationRounds: 3 }],
    description: "<p>Observar o oponente por alguns segundos revela o padrão dos golpes dele.</p>" },
  { name: "Primeiros Socorros", tier: "extra", cost: 6, effectType: "temporary",
    effects: [{ target: "hp", amount: 8, durationRounds: 0 }],
    description: "<p>Estancar sangramento e imobilizar o que estiver quebrado. Não faz milagre — só impede a piora.</p>" },
  { name: "Andar Silencioso", tier: "extra", cost: 2, effectType: "temporary",
    effects: [{ target: "stealth", amount: 4, durationRounds: 3 }],
    description: "<p>Distribuir o peso e escolher onde pisar. Qualquer um aprende; poucos treinam.</p>" },
  { name: "Aparar", tier: "extra", cost: 4, effectType: "temporary",
    effects: [{ target: "defense", amount: 5, durationRounds: 1 }],
    description: "<p>Desviar a lâmina inimiga com a própria, em vez de bloquear de frente.</p>" },
  { name: "Tiro Firme", tier: "extra", cost: 5, effectType: "damage", damageFormula: "1d12", scalingAttribute: "precision",
    description: "<p>Prender a respiração, esperar a janela e soltar. Vale para arco, besta ou cano.</p>" },

  // ---------------- Normal: a mesma perícia, agora com componente arcano
  { name: "Lâmina Flamejante", tier: "normal", cost: 12, effectType: "damage", damageFormula: "2d8",
    scalingAttribute: "magic", isMagicDamage: true, damageElements: ["fire"],
    description: "<p>A arma pega fogo sem se consumir. O corte queima muito depois de a lâmina passar.</p>" },
  { name: "Manto de Gelo", tier: "normal", cost: 10, effectType: "temporary",
    effects: [{ target: "shield", amount: 25, durationRounds: 0 }],
    description: "<p>Uma casca de gelo se forma sobre o corpo e absorve o impacto até rachar.</p>" },
  { name: "Toque Vital", tier: "normal", cost: 14, effectType: "temporary",
    effects: [{ target: "hp", amount: 20, durationRounds: 0 }],
    description: "<p>Acelera a própria carne a fechar o ferimento — cansa quem cura tanto quanto quem é curado.</p>" },
  { name: "Descarga Elétrica", tier: "normal", cost: 12, effectType: "damage", damageFormula: "2d10",
    scalingAttribute: "magic", isMagicDamage: true, damageElements: ["lightning"],
    description: "<p>Um arco curto salta da mão. Contra armadura de metal, é pior ainda.</p>" },
  { name: "Passo das Sombras", tier: "normal", cost: 9, effectType: "temporary",
    effects: [{ target: "stealth", amount: 8, durationRounds: 3 }],
    description: "<p>A sombra ao redor engrossa e engole o contorno de quem se move dentro dela.</p>" },
  { name: "Peso de Ferro", tier: "normal", cost: 11, effectType: "temporary",
    effects: [{ target: "strength", amount: 6, durationRounds: 3 }],
    description: "<p>Os músculos endurecem como cabo de aço pelo tempo que a concentração aguentar.</p>" },
  { name: "Névoa Ácida", tier: "normal", cost: 15, effectType: "temporary",
    effects: [{ target: "hp", amount: -5, durationRounds: 4, periodic: true, tickUnit: "combatRound",
               conditionId: "poison", damageElements: ["acid"] }],
    description: "<p>Uma névoa baixa que corrói o que toca. Continua corroendo depois que se dispersa.</p>" },
  { name: "Escudo Arcano", tier: "normal", cost: 10, effectType: "temporary",
    effects: [{ target: "magicalDefense", amount: 6, durationRounds: 3 }],
    description: "<p>Uma malha invisível que dispersa o que é feito de energia antes de chegar à pele.</p>" },
  { name: "Cegueira Luminosa", tier: "normal", cost: 8, effectType: "temporary",
    effects: [{ target: "precision", amount: -6, durationRounds: 2, conditionId: "blindness" }],
    description: "<p>Um estouro de luz branca. Não fere — mas por alguns segundos ninguém acerta nada.</p>" }
];

/**
 * Cria as Skills de exemplo no Compêndio de Habilidades. Idempotente: `registerItemInCompendium`
 * reaproveita o que já existir com a mesma assinatura, então clicar duas vezes não duplica nada.
 */
async function createSampleContent() {
  await ensureSystemCompendiums();

  let criadas = 0;
  for (const skill of SAMPLE_SKILLS) {
    const { name, tier, cost, description, ...mechanics } = skill;
    const created = await registerItemInCompendium({
      name,
      type: "skill",
      system: { tier, level: 1, cost, description, ...mechanics }
    });
    if (created) criadas += 1;
  }

  ui.notifications.info(
    `${criadas} Skill(s) de exemplo no Compêndio de Habilidades (${SAMPLE_SKILLS.length} no total; as repetidas foram reaproveitadas).`
  );
}

/** Recria os compêndios auto-geridos do sistema (Skills/Partes do Corpo/Títulos/Módulos), caso algum tenha sido apagado. */
async function syncData() {
  await ensureSystemCompendiums();
  ui.notifications.info("Compêndios do sistema sincronizados (recriados se algum estava faltando).");
}

/** Settings do sistema que viajam num export: as de mundo, menos o registro de migrações. */
function transferableSettings() {
  const out = new Map();
  for (const config of game.settings.settings.values()) {
    if (config.namespace !== SYSTEM_ID || config.scope !== "world") continue;
    if (config.key === "completedMigrations") continue;
    out.set(config.key, config);
  }
  return out;
}

/** Chaves que pertencem a Módulos do Sistema (interruptores e seus campos). */
function featureSettingKeys() {
  const keys = new Set();
  for (const feature of Object.values(MEU_SISTEMA.FEATURES)) {
    keys.add(feature.setting);
    for (const optionKey of Object.keys(feature.options ?? {})) keys.add(optionKey);
  }
  return keys;
}

/**
 * Diálogo de escolha do que exportar/importar, agrupado (Catálogos / Módulos do Sistema /
 * Regras). Devolve as chaves marcadas, ou `null` se cancelou.
 */
async function pickTransferKeys({ title, hint, rows, confirmLabel }) {
  const features = featureSettingKeys();
  const groups = new Map();
  for (const row of rows) {
    const group = transferGroup(row.key, features);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(row);
  }
  const escape = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const html = [...groups]
    .map(([group, list]) => `<fieldset class="transfer-group"><legend><label><input type="checkbox" class="transfer-group-toggle" checked/> ${group}</label></legend>
        ${list.map(row => `<label class="transfer-row"><input type="checkbox" name="key" value="${escape(row.key)}" ${row.checked === false ? "" : "checked"}/> ${escape(row.label)}${row.note ? ` <span class="hint-inline">${escape(row.note)}</span>` : ""}</label>`).join("")}
      </fieldset>`)
    .join("");

  const result = await DialogV2.wait({
    window: { title },
    classes: ["nihility-transfer-dialog"],
    position: { width: 520 },
    content: `<form class="nihility-transfer">${hint ? `<p class="hint">${hint}</p>` : ""}${html}</form>`,
    buttons: [
      {
        action: "ok",
        label: confirmLabel,
        default: true,
        callback: (event, button, dialog) => Array.from(dialog.element.querySelectorAll('[name="key"]:checked')).map(cb => cb.value)
      },
      { action: "cancel", label: "Cancelar", callback: () => false }
    ],
    rejectClose: false,
    render: (event, dialog) => {
      const root = dialog?.element ?? dialog;
      root?.querySelectorAll?.(".transfer-group-toggle").forEach(toggle => {
        toggle.addEventListener("change", () => {
          toggle.closest(".transfer-group").querySelectorAll('[name="key"]').forEach(cb => (cb.checked = toggle.checked));
        });
      });
    }
  });
  return Array.isArray(result) ? result : null;
}

/**
 * Exporta a configuração do sistema — tudo, ou só o que for marcado. O arquivo leva o valor
 * exato de cada setting; a chave de IA (por navegador) nunca entra.
 */
async function exportData() {
  const settings = transferableSettings();
  const rows = [...settings.values()].map(config => ({ key: config.key, label: config.name || config.key }));
  const keys = await pickTransferKeys({
    title: "Exportar Configurações",
    hint: "Marque o que vai no arquivo. Chave e endereço de IA ficam de fora — são de cada navegador.",
    rows,
    confirmLabel: "Exportar"
  });
  if (!keys?.length) return;
  const values = Object.fromEntries(keys.map(key => [key, game.settings.get(SYSTEM_ID, key)]));
  const bundle = buildTransferBundle(values, SYSTEM_ID, game.system.version);
  saveTextToFile(JSON.stringify(bundle, null, 2), "application/json", "nihility-config.json");
}

/**
 * Importa um arquivo de configurações (o formato atual ou o antigo, de 4 listas). Mostra só o
 * que MUDA em relação ao mundo, deixa escolher, e grava.
 */
async function importData() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json";
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;

    try {
      const incoming = readTransferBundle(JSON.parse(await readFileAsText(file)), SYSTEM_ID);
      if (!incoming) {
        ui.notifications.error("Arquivo inválido — não parece ser uma exportação de configurações do Nihility RPG System.");
        return;
      }
      const settings = transferableSettings();
      const current = Object.fromEntries([...settings.keys()].map(key => [key, game.settings.get(SYSTEM_ID, key)]));
      const diff = diffTransfer(current, incoming);
      const changed = diff.filter(d => d.changed);
      if (!changed.length) {
        ui.notifications.info("Nada muda: o mundo já tem exatamente essas configurações.");
        return;
      }

      const keys = await pickTransferKeys({
        title: "Importar Configurações",
        hint: `${changed.length} configuração(ões) mudam (${diff.length - changed.length} já iguais ficam de fora). Marque o que substituir no mundo.`,
        rows: changed.map(d => ({ key: d.key, label: settings.get(d.key)?.name || d.key })),
        confirmLabel: "Importar"
      });
      if (!keys?.length) return;

      for (const key of keys) await game.settings.set(SYSTEM_ID, key, incoming[key]);
      ui.notifications.info(`${keys.length} configuração(ões) importada(s). Recarregue o mundo (F5) para tudo acompanhar.`);
    } catch (err) {
      console.error(`${SYSTEM_ID} | Falha ao importar configurações.`, err);
      ui.notifications.error(`Falha ao importar: ${err.message}`);
    }
  });
  input.click();
}

export class NihilityMenuApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "nihility-menu",
    window: { title: "Nihility RPG System", resizable: true },
    classes: [SYSTEM_ID, "nihility-menu-app"],
    position: { width: 880, height: 620 },
    actions: {
      selectTab: NihilityMenuApp.#onSelectTab,
      runAction: NihilityMenuApp.#onRunAction,
      openActor: NihilityMenuApp.#onOpenActor
    }
  };

  static PARTS = {
    body: { template: `systems/${SYSTEM_ID}/templates/apps/nihility-menu.hbs`, scrollable: [".nm-content"] }
  };

  constructor(options = {}) {
    super(options);
    this.activeTab = "fichas";
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const isGM = game.user.isGM;
    context.isGM = isGM;

    // Jogador nunca cai numa aba GM-only, mesmo se essa era a última aba aberta (troca de usuário/re-render).
    if (!isGM && GM_ONLY_TABS.includes(this.activeTab)) this.activeTab = "fichas";
    context.activeTab = this.activeTab;

    // Blocos desligados pela campanha somem da trilha inteira (diferente de gmOnly, que mostra
    // o cadeado): não é "existe mas você não pode", é "esta campanha não usa isso".
    const aiEnabled = isAIAssistantEnabled();
    context.vesselsEnabled = isVesselsEnabled();
    context.structuresEnabled = isFeatureEnabled("structures");
    context.aiAssistantEnabled = aiEnabled;

    context.railItems = [
      { id: "fichas", label: "Fichas", icon: "fas fa-users" },
      { id: "system", label: "Configurações Gerais", icon: "fas fa-cog", gmOnly: true },
      // "Assistente de IA" e "Geração Automática" abriam o mesmo assistente (e o NPC aparecia
      // duas vezes) — viraram uma aba só.
      { id: "ai", label: "Criar com IA", icon: "fas fa-wand-magic-sparkles", gmOnly: true, feature: aiEnabled },
      { id: "tools", label: "Ferramentas de Admin", icon: "fas fa-tools", gmOnly: true }
    ]
      .filter(item => item.feature !== false)
      .map(item => ({ ...item, active: item.id === context.activeTab, locked: item.gmOnly && !isGM }));

    // Se a aba ativa acabou de sumir (bloco desligado), volta pra Fichas em vez de renderizar vazio.
    if (!context.railItems.some(item => item.id === this.activeTab)) {
      this.activeTab = "fichas";
      context.activeTab = "fichas";
      context.railItems = context.railItems.map(item => ({ ...item, active: item.id === "fichas" }));
    }

    context.actors = this._getVisibleActors();
    if (isGM) {
      context.settingsSections = this._settingsSections();
      context.disabledFeatures = Object.entries(MEU_SISTEMA.FEATURES)
        .filter(([key, feature]) => !feature.parent && !isFeatureEnabled(key))
        .map(([, feature]) => feature.name);
      context.aiSections = this._aiSections();
    }

    debugLog(`${SYSTEM_ID} | NihilityMenuApp._prepareContext, aba ativa:`, this.activeTab);
    return context;
  }

  /**
   * Configurações Gerais em seções por assunto. Cada linha diz o estado atual ("14 tipos ·
   * 4 grupos") pra o Mestre saber o que tem sem abrir. Linha de bloco desligado some — o rodapé
   * lista o que a campanha desligou (é "não usa", não "não pode").
   */
  _settingsSections() {
    const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    const elements = getActiveDamageElements();
    const conditions = getActiveStatusConditions();
    const categories = getModuleCategories();
    const featuresOn = Object.entries(MEU_SISTEMA.FEATURES).filter(([key, f]) => !f.parent && isFeatureEnabled(key)).length;
    const featuresTotal = Object.values(MEU_SISTEMA.FEATURES).filter(f => !f.parent).length;
    const rulesCount = [...game.settings.settings.values()].filter(c => c.namespace === SYSTEM_ID && c.scope === "world" && c.config).length;

    const sections = [
      {
        label: "Campanha",
        rows: [
          { action: "feature-config", icon: "fas fa-toggle-on", title: "Módulos do Sistema", desc: "Ligar/desligar blocos e aplicar presets de campanha.", state: `${featuresOn} de ${featuresTotal} ligados` },
          { action: "rules-config", icon: "fas fa-scale-balanced", title: "Regras da Mesa", desc: "XP, pontos por nível, fórmulas de Vida/Mana, iniciativa e as outras regras numéricas.", state: count(rulesCount, "regra", "regras") }
        ]
      },
      {
        label: "Personagem",
        rows: [
          { action: "attribute-config", icon: "fas fa-chart-simple", title: "Atributos", desc: "Renomear ou esconder os Atributos de Combate.", state: `${getVisibleAttributes().length} visíveis` },
          { action: "anatomy-config", icon: "fas fa-dna", title: "Espécies", desc: "Partes do Corpo, Skills Raciais e Traços de cada Espécie.", state: count(Object.keys(getActiveSpeciesPresets()).length, "espécie", "espécies"), feature: "anatomy" },
          { action: "traits-config", icon: "fas fa-tags", title: "Traços", desc: "Dracônico, Voador, Orgânico… usados por Elementos e bônus condicionais.", state: count(getActiveTraits().length, "traço", "traços") },
          { action: "economy-config", icon: "fas fa-coins", title: "Moedas", desc: "Moedas, valores e conversão.", state: count(getActiveCurrencies().length, "moeda", "moedas"), feature: "economy" },
          { action: "titles-config", icon: "fas fa-crown", title: "Compêndio de Títulos", desc: "Títulos do mundo.", feature: "titles" },
          { action: "items-compendium", icon: "fas fa-suitcase", title: "Compêndio de Itens", desc: "Armas, equipamentos e itens gerais." }
        ]
      },
      {
        label: "Combate e Dano",
        rows: [
          { action: "damage-elements-config", icon: "fas fa-fire", title: "Tipos de Dano", desc: "Elementos por grupo e o que cada um causa ao acertar.", state: `${count(elements.length, "tipo", "tipos")} · ${count(new Set(elements.map(e => e.group)).size, "grupo", "grupos")}` },
          { action: "status-conditions-config", icon: "fas fa-skull-crossbones", title: "Condições", desc: "Queimadura, Lentidão, Veneno… com efeito padrão.", state: `${conditions.length} · ${conditions.filter(c => c.effect?.kind).length} com efeito`, feature: "statusConditions" },
          { action: "scales-config", icon: "fas fa-up-right-and-down-left-from-center", title: "Escalas", desc: "Pessoal, Veículo, Nave, Capital — quanto o dano muda entre elas.", state: count(getScaleConfig().scales.length, "escala", "escalas"), feature: "scale" },
          { action: "structures-config", icon: "fas fa-dungeon", title: "Estruturas", desc: "Paredes, blocos e barreiras que as Skills erguem no mapa.", state: count(getStructures().length, "estrutura", "estruturas"), feature: "structures" }
        ]
      },
      {
        label: "Naves",
        feature: "vessels",
        rows: [
          { action: "module-categories-config", icon: "fas fa-microchip", title: "Categorias de Módulo", desc: "Reator, Impulso, Manobradores, Transdobra… com Função e vagas.", state: `${count(categories.length, "categoria", "categorias")} · ${count(new Set(categories.map(c => c.role)).size, "função", "funções")}` },
          { action: "ship-classes-config", icon: "fas fa-shuttle-space", title: "Classes de Nave", desc: "Encouraçado, Cruzador, Cargueiro…", state: count(getVesselClasses("ship").length, "classe", "classes") },
          { action: "vehicle-classes-config", icon: "fas fa-truck-monster", title: "Classes de Veículo", desc: "Carro, Tanque, Moto…", state: count(getVesselClasses("vehicle").length, "classe", "classes") },
          { action: "crew-roles-config", icon: "fas fa-users-gear", title: "Postos de Tripulação", desc: "Quem está em qual posto (não é permissão).", state: count(getCrewRoles().length, "posto", "postos") }
        ]
      }
    ];

    return sections
      .filter(section => !section.feature || isFeatureEnabled(section.feature))
      .map(section => ({
        ...section,
        rows: section.rows
          .filter(row => !row.feature || isFeatureEnabled(row.feature))
          .map(row => ({ ...row, search: `${row.title} ${row.desc}`.toLowerCase() }))
      }))
      .filter(section => section.rows.length);
  }

  /** "Criar com IA" em grupos (tudo abre o mesmo Assistente, com a tarefa já escolhida). */
  _aiSections() {
    const vessels = isVesselsEnabled();
    return [
      {
        label: "Assistente",
        rows: [
          { action: "open-ai-assistant", icon: "fas fa-robot", title: "Assistente Completo", desc: "Criar, Editar Existente e Agente (vários documentos de uma vez, com desfazer)." },
          { action: "freeform", icon: "fas fa-comment-dots", title: "Pergunta Livre", desc: "Consulta à IA sem criar nada." }
        ]
      },
      {
        label: "Personagens e Criaturas",
        rows: [
          { action: "generate-npc", icon: "fas fa-user", title: "Personagem / NPC", desc: "A partir de uma descrição, com pontos de atributo." },
          { action: "generate-mount", icon: "fas fa-horse", title: "Montaria", desc: "Montarias e bestas de carga." }
        ]
      },
      vessels && {
        label: "Naves",
        rows: [
          { action: "generate-starship", icon: "fas fa-rocket", title: "Nave Espacial", desc: "Porte e Módulos escolhidos pela IA; os números vêm dos presets." },
          { action: "generate-vehicle", icon: "fas fa-car", title: "Veículo Terrestre", desc: "Mesma ideia, nos Portes de Veículo." }
        ]
      },
      {
        label: "Conteúdo",
        rows: [
          { action: "generate-skill", icon: "fas fa-bolt", title: "Habilidade", desc: "Skill avulsa, direto no Compêndio." },
          { action: "generate-item", icon: "fas fa-shield-halved", title: "Item", desc: "Itens e equipamentos." },
          { action: "generate-note", icon: "fas fa-book", title: "Nota", desc: "Nota narrativa no Diário." }
        ]
      }
    ].filter(Boolean);
  }

  /** Atores que este usuário pode abrir: o Mestre vê todo mundo, o jogador só quem possui/tem Observador. */
  _getVisibleActors() {
    const isGM = game.user.isGM;
    return game.actors
      .filter(actor => isGM || actor.testUserPermission(game.user, "OBSERVER"))
      .map(actor => ({
        id: actor.id,
        name: actor.name,
        nameLower: actor.name.toLowerCase(),
        img: actor.img,
        typeLabel: this._typeLabelFor(actor),
        typeClass: this._typeClassFor(actor),
        metaLine: this._metaLineFor(actor)
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  _typeLabelFor(actor) {
    if (actor.type === "character") return actor.system.isPlayerCharacter ? "Personagem" : "NPC";
    if (actor.type === "starship") return "Nave";
    if (actor.type === "vehicle") return "Veículo";
    return actor.type;
  }

  _typeClassFor(actor) {
    if (actor.type === "character") return actor.system.isPlayerCharacter ? "pc" : "npc";
    if (actor.type === "starship") return "ship";
    if (actor.type === "vehicle") return "vehicle";
    return "";
  }

  _metaLineFor(actor) {
    if (actor.type === "character") return `Nível ${actor.system.attributes?.level ?? "?"}`;
    if (actor.type === "starship") return `Casco ${actor.system.hull?.value ?? 0}/${actor.system.hull?.max ?? 0}`;
    if (actor.type === "vehicle") return `Integridade ${actor.system.hull?.value ?? 0}/${actor.system.hull?.max ?? 0}`;
    return "";
  }

  /** @override — busca/filtro de tipo em Fichas são só DOM (sem re-render): a lista já está toda renderizada. */
  _onRender(context, options) {
    super._onRender(context, options);

    this.element.querySelector(".nm-actor-search")?.addEventListener("input", () => this._filterActorGrid());
    this.element.querySelectorAll(".nm-type-filter").forEach(chip => {
      chip.addEventListener("click", () => {
        this.element.querySelectorAll(".nm-type-filter").forEach(c => c.classList.remove("active"));
        chip.classList.add("active");
        this._filterActorGrid();
      });
    });
    this.element.querySelector(".nm-settings-search")?.addEventListener("input", event => this._filterSettings(event.target.value));
  }

  /** Busca em Configurações Gerais: esconde linhas (e seções vazias) que não batem com o texto. */
  _filterSettings(text) {
    const query = String(text ?? "").trim().toLowerCase();
    let visible = 0;
    this.element.querySelectorAll(".nm-pane:not(.hidden) .nm-settings-section").forEach(section => {
      let inSection = 0;
      section.querySelectorAll(".nm-settings-row[data-search]").forEach(row => {
        const show = !query || row.dataset.search.includes(query);
        row.classList.toggle("hidden", !show);
        if (show) inSection++;
      });
      section.classList.toggle("hidden", inSection === 0);
      visible += inSection;
    });
    this.element.querySelector(".nm-settings-empty")?.classList.toggle("hidden", visible > 0);
  }

  _filterActorGrid() {
    const query = (this.element.querySelector(".nm-actor-search")?.value ?? "").trim().toLowerCase();
    const activeType = this.element.querySelector(".nm-type-filter.active")?.dataset.type ?? "all";
    let visibleCount = 0;

    this.element.querySelectorAll(".nm-actor-card").forEach(card => {
      const matchesType = activeType === "all" || card.dataset.type === activeType;
      const matchesQuery = !query || card.dataset.name.includes(query);
      const show = matchesType && matchesQuery;
      card.classList.toggle("hidden", !show);
      if (show) visibleCount++;
    });

    this.element.querySelector(".nm-actor-empty")?.classList.toggle("hidden", visibleCount > 0);
  }

  static #onSelectTab(event, target) {
    event.preventDefault();
    const tab = target.dataset.tab;
    if (GM_ONLY_TABS.includes(tab) && !game.user.isGM) return; // trava mesmo se o cadeado da trilha for clicado direto
    this.activeTab = tab;
    this.render();
  }

  static #onOpenActor(event, target) {
    event.preventDefault();
    const actorId = target.closest("[data-actor-id]")?.dataset.actorId;
    game.actors.get(actorId)?.sheet?.render(true);
  }

  static async #onRunAction(event, target) {
    event.preventDefault();
    if (!game.user.isGM) return; // toda ação de Configurações/IA/Geração/Ferramentas é GM-only

    // Atributo separado de `data-action` (que a própria Foundry consome pra escolher ESTE
    // handler) — `data-menu-action` guarda qual ação específica do menu foi clicada.
    const action = target.dataset.menuAction;
    debugLog(`${SYSTEM_ID} | NihilityMenuApp: ação clicada ->`, action);

    if (action in AI_TASK_ACTIONS) {
      const { AIAssistantApp } = await import("./ai-assistant.js");
      new AIAssistantApp({ initialMode: "create", initialTask: AI_TASK_ACTIONS[action] }).render(true);
      return;
    }

    switch (action) {
      case "open-ai-assistant": {
        const { AIAssistantApp } = await import("./ai-assistant.js");
        new AIAssistantApp().render(true);
        break;
      }
      case "backup-manager": {
        // O gerenciador de backup/desfazer vive no modo "Agente" do Assistente de IA.
        const { AIAssistantApp } = await import("./ai-assistant.js");
        new AIAssistantApp({ initialMode: "agent" }).render(true);
        break;
      }
      case "rules-config": {
        const { TableRulesConfigApp } = await import("./table-rules-config.js");
        new TableRulesConfigApp().render(true);
        break;
      }
      case "feature-config": {
        const { FeatureConfigApp } = await import("./feature-config.js");
        new FeatureConfigApp().render(true);
        break;
      }
      case "attribute-config": {
        const { AttributeConfigApp } = await import("./attribute-config.js");
        new AttributeConfigApp().render(true);
        break;
      }
      case "damage-elements-config": {
        const { DamageElementsConfigApp } = await import("./damage-elements-config.js");
        new DamageElementsConfigApp().render(true);
        break;
      }
      case "economy-config": {
        const { CurrencyConfigApp } = await import("./currency-config.js");
        new CurrencyConfigApp().render(true);
        break;
      }
      case "anatomy-config": {
        // Presets de Espécie SÃO a configuração de Anatomia (Partes do Corpo + Skills Raciais).
        const { SpeciesConfigApp } = await import("./species-config.js");
        new SpeciesConfigApp().render(true);
        break;
      }
      case "status-conditions-config": {
        const { StatusConditionsConfigApp } = await import("./status-conditions-config.js");
        new StatusConditionsConfigApp().render(true);
        break;
      }
      case "module-categories-config":
      case "ship-classes-config":
      case "vehicle-classes-config":
      case "crew-roles-config": {
        const apps = await import("./vessel-catalogs-config.js");
        const App = {
          "module-categories-config": apps.ModuleCategoriesConfigApp,
          "ship-classes-config": apps.ShipClassesConfigApp,
          "vehicle-classes-config": apps.VehicleClassesConfigApp,
          "crew-roles-config": apps.CrewRolesConfigApp
        }[action];
        new App().render(true);
        break;
      }
      case "structures-config": {
        const { StructuresConfigApp } = await import("./structures-config.js");
        new StructuresConfigApp().render(true);
        break;
      }
      case "traits-config": {
        const { TraitsConfigApp } = await import("./traits-config.js");
        new TraitsConfigApp().render(true);
        break;
      }
      case "scales-config": {
        const { ScalesConfigApp } = await import("./scales-config.js");
        new ScalesConfigApp().render(true);
        break;
      }
      case "items-compendium": {
        // Itens Gerais (armas, equipamentos, PAD) não têm criação automática no Compêndio — o
        // Mestre cria/arrasta aqui dentro o que quiser ter à mão.
        const pack = game.packs.get(`world.${MEU_SISTEMA.COMPENDIUM.items.key}`);
        if (pack) pack.render(true);
        else ui.notifications.warn("Compêndio de Itens ainda não existe — use 'Sincronizar' primeiro.");
        break;
      }
      case "titles-config": {
        // Não existe preset global de Títulos (são só Items por Ator) — o mais útil que já
        // existe é abrir o Compêndio de Títulos do mundo pra navegar/gerenciar.
        const pack = game.packs.get(`world.${MEU_SISTEMA.COMPENDIUM.titles.key}`);
        if (pack) pack.render(true);
        else ui.notifications.warn("Compêndio de Títulos ainda não existe — use 'Sincronizar' primeiro.");
        break;
      }
      case "create-macros":
        await createSystemMacros();
        break;
      case "create-sample-content":
        await createSampleContent();
        break;
      case "sync-data":
        await syncData();
        break;
      case "export-data":
        await exportData();
        break;
      case "import-data":
        await importData();
        break;
      default:
        console.warn(`${SYSTEM_ID} | NihilityMenuApp: ação "${action}" ainda não implementada.`);
    }
  }
}
