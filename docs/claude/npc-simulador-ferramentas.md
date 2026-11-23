# Gerador de NPC, Níveis de NPC, Simulador de encontro e Ferramentas da mesa

> Parte do guia do projeto. O índice e as regras que valem em todo lugar estão no `CLAUDE.md` da raiz. Quando o texto diz "abaixo"/"acima" ou cita uma seção que não está aqui, procure-a pelo índice.

## Gerador de NPC e Níveis de NPC (1.80.0)

The owner approved the Design artifact "Gerador de NPC" with all three boards; build to it. The work is behind `FEATURES.npcGenerator` and `FEATURES.npcTiers`, both on by default.

**Catalog.** `npcArchetypesData`:
- The defaults are `NIHILITY.DEFAULT_NPC_ARCHETYPES` in `core/config/defaults/npc.js`: 14 archetypes in the groups Comum, Fantasia and Sci-Fi, plus `NPC_NAME_TABLES`.
- Read the catalog through `getActiveNpcArchetypes()`, which is cached and normalized through `normalizeArchetype`.
- Fields of an entry: `{id, label, group, img, description, species[], pointsPercent, weights{attr: 0–3}, luck, skillsMin/Max, skillLevel "follow"|"one", skills[], items[]}`.
- Skills use the loose Racial-Skill format (`key`, `always`).
- Items are Item Geral data with a `chance`.
- Sci-Fi element ids are dropped at creation in a world that lacks them (`keepKnownIds`).

**The rule.** An NPC gets the **same attribute points as a PC of its level**, times the archetype's %. `distributePoints` splits them by weight (Pouco 1 … Muito 4) with a luck spread, so an NPC never leaves the power curve.

**Generator.** The window is `apps/npc-generator.js`, opened from the "Gerar NPC…" button in the menu's Fichas tab, `game.nihility.generateNpc()`, or the "Nihility — Gerar NPC" macro.
- It holds drafts only; nothing is created until "Criar".
- `createNpcs` creates the Actor **without** `prototypeToken`, because `preCreateActor` adds the Vida/Mana bars only when the creation data has none. It then applies the Species through `changeActorSpecies(…, {interactive: false})`, creates the Skills (`archetypeSkillItem`, level from `skillLevelFor`) and the items, and fills Vida/Mana.
- "Pôr no mapa" waits for one canvas click (`pickCanvasPoint`) and lays the Tokens out in a grid.
- "Detalhar com IA" (`describeNpcWithAI`) writes only biography and personality.
- Don't name an ApplicationV2 field `state`: it is a read-only getter there, which is why the app uses `opts`.

**Editor.** `apps/npc-archetypes-config.js` follows the Species editor model: a working copy, "Salvar", a padrão/editado/do Mestre tag (`archetypeStatus`), "Voltar ao padrão" and "Trazer do padrão…".
- A Skill or Item Geral dropped from a Compendium or a sheet is stored as a copy.
- Skills are edited in `openSkillEditorDialog`.

**Níveis de NPC (M6).** These are the `system.npcTier` values (`minion`/`normal`/`elite`/`boss`) on `CharacterDataModel`. They apply only when `isPlayerCharacter` is false and the block is on:
- In `deriveVitalStats`, Lacaio sets Vida máx to 1, and Elite/Chefe multiply it by the `npcTiers` options (`npcEliteHp`/`npcBossHp`).
- The value before the tier stays in `hp.hpMaxBeforeTier`, and "De onde vem" shows the row.
- When the tier changes, `registerNpcTierHooks` (`preUpdateActor`) keeps the same **fraction** of current Vida (`rescaleHpValue`).
- The GM-only select sits next to the "PJ" box.
- Elite/Chefe draw extra Skills in the generator (`npcEliteSkills`/`npcBossSkills`).
- Turning the block off counts everyone as Normal; the saved tier stays.
- Left out on purpose: "each X of damage drops another minion", and extra points for Elite/Chefe.

## Simulador de encontro (1.82.0)

The owner approved the Design artifact "Simulador de Encontro" with all three boards; build to it. It sits behind `FEATURES.encounterSim`, on by default. It is a GM tool only: it rolls nothing and changes no sheet.

**Average hits: `combat/encounter-sim.js`.** It computes each attack's average hit against each target type through **the same path as real damage**, so the simulator and the table agree. Change the damage path and this follows by itself.
- `averageRoll` of the formula;
- × `damageScalingMultiplier`;
- × the level's Power (Skills);
- × `damageScaleFor`;
- × `situationalDamageFactor`;
- then `applyDamageReductions(…, {attacker, triggerConditions: false})`, which has no side effects with that flag. Its `traceRows` are the breakdown on board 2.

**Attacks: `attackOptions`.** It lists damage Skills and Sub-Skills, and equipped weapons (with loaded ammo).
- `buildSides` picks the attack with the highest damage per round against the other side, unless the user chose one with ▾.
- An area attack hits `DEFAULT_AREA_TARGETS` (3), editable per unit.
- `uses` = max Mana ÷ effective cost. A `fallback` free attack takes over when Mana runs out.

**Rounds and verdict: `combat/encounter-rules.js`** (pure, tested).
- `roundsToDefeat` simulates one side hitting with no reply: one attack each per round, focus on whoever falls fastest, area hitting up to N alive.
- `roundsToDropEach` is the worst case: everyone on one PC.
- `evaluateEncounter` gives the verdict:
  - **easy:** win < first PC drop;
  - **fair:** win ≤ drop + 1;
  - **dangerous:** a PC drops first but the group wins;
  - **deadly:** the group is wiped first.
- `suggestAdjustment` tries one NPC tier step and ±1 count per opponent type, and returns the first change that reaches "fair".
- Unit HP is `unitHp`: `hpMaxBeforeTier` with the NPC tier applied, plus the current Escudo.

**Window: `apps/encounter-sim.js`.**
- It opens with the players' PCs. Actors can be dragged in from the Directory, and "+ Selecionados no mapa" / "+ Ficha / arquétipo" add more. An archetype NPC is a **temporary unsaved Actor** (`temporaryActorFromDraft`).
- Clicking a number shows the breakdown.
- Ships and vehicles are left out for now (`canSimulate`).

**Entry points:**
- Menu › Ferramentas card;
- the GM-only "Simular" button on the combat tracker (`registerEncounterSimTracker`, `renderCombatTracker`). It reads `ui.combat.viewed` **at click time**: the tracker may switch combats after rendering.
- the NPC generator's "Testar contra o grupo" (drafts as temporary opponents);
- `game.nihility.simulateEncounter()`.

**Combat sides (`openEncounterSimFromCombat`):** the player-owned or FRIENDLY-disposition actors go on one side, and the rest, grouped by base actor with a count, on the other.

## Ferramentas da mesa: Módulos agrupados, Deixar leve, ficha enxuta, Regras desta mesa, Painel do combate (1.83.0)

The owner approved the Design artifact "Ferramentas da Mesa" (boards 1–4); build to it. Backlog items K2, K3, K4, L6 and H10.

- **Módulos do Sistema grouped (K4).** `FEATURE_GROUPS` (Personagem / Combate / Mundo / Ferramentas do Mestre) and `FEATURE_LAYOUT` live in `core/config/defaults/features.js`. `FEATURE_LAYOUT` maps each feature key to `[group, short, heavy]`, which is merged into `FEATURES` as `group`, `short` (one line, ≤ 90 chars, what the player needs to know) and `heavy`. **A new feature must get a `FEATURE_LAYOUT` row** — the test fails without a group and a short line. `FeatureConfigApp` shows the short line, a "pesado" tag, and the long `hint` plus the options behind a `<details class="fc-more">` ("mais ▸"); sub-features render their options too.
- **Deixar leve (K2).** `CAMPAIGN_PRESETS.leve` (`light: true`, no `content`) turns off exactly the features marked `heavy` and leaves the rest alone — it is not a fourth genre. Mark a new feature `heavy` only if it adds rules the players must learn (today: naturalRegen, bodyPartInjury, movement, radiation, encumbrance, scale, shipManeuver, elevation, surfaces).
- **Ficha enxuta (K3).** `sheets/sheet-trim-rules.js` (pure, tested): `sheetTrim({isGM, showAll, empty})` → per block (`TRIM_BLOCKS`: titles, skillPoints, gear, economy, anatomy) `{hide, gmEmpty}` plus counts. For the player an empty block is hidden, with "N bloco(s) vazio(s) escondido(s) · mostrar" at the foot of the sheet (`toggleShowEmpty`, remembered per sheet in `localStorage`); the GM always sees everything, empty blocks tagged "vazio". An empty Anatomia tab falls back to the Ficha tab. The same rule hides, for the player, the header's Títulos chip when the Títulos block is hidden and every empty Tier band of the Habilidades list (`shownSkillTiers`, pure; the GM and "mostrar" see all bands). Hiding only skips rendering; nothing is written.
- **Regras desta mesa (L6).** `core/table-rules-text.js` (pure, tested: `buildTableRulesPages`, `conditionSentence`) builds the pages from what `gatherTableRules()` (`core/table-rules-journal.js`) reads off this world — features, vital formula, XP formula, Skill level cycle, initiative, movement, Vida 0, the Condition and element catalogs, the energy label. `generateTableRulesJournal()` creates or updates **one** JournalEntry flagged `tableRules`, readable by everyone (`ownership.default` OBSERVER). Generated pages are flagged `tableRulesPage` and replaced on each run; the "Notas da mesa" page has no flag and is never touched. It updates only when the GM clicks again (Menu › Ferramentas, `game.nihility.tableRules()`), never by itself. Write the text in player language and escape every catalog string.
- **Painel do combate (H10).** `apps/combat-panel.js` (`CombatPanelApp`, id `nihility-combat-panel`) reads `ui.combat.viewed ?? game.combat` and shows one row per combatant: Vida/Escudo/Mana (ship: Integridade Estrutural, Escudo and Bateria), Condition icons with the same duration as the Token badges (`badgeFor`), Active Skills (`collectActiveUpkeepSources`), movement spent/total and the Vida-0 counter. Clicking opens the sheet, pans to the Token or opens the Efeitos window. Re-renders from Actor/Effect/Item/Combat hooks, debounced, removed in `_onClose`. Entry points: Menu › Ferramentas, the GM-only "Painel" button on the combat tracker (`registerCombatPanelTracker`), `game.nihility.combatPanel()`. Read-only: it never writes.
