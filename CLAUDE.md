# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Nihility RPG System — a custom Foundry VTT game system (id `nihility-rpg-system`, targets Foundry V12/V13/V14) built for a Fantasia/Isekai + Sci-Fi Arcano campaign. It's a manifest-driven Foundry system: pure static JS/Handlebars/CSS, no bundler, no `package.json`, no test framework. Foundry loads `module/nihility-rpg-system.js` as an ES module directly.

## Commands

There is no build step, linter, or test suite. The only local verification available is a syntax check:

```bash
node --check module/path/to/file.js
```

Run this on every JS file you touch before considering a change done. Real functional verification only happens inside a running Foundry world (manual load-test — there is no headless test harness in this repo).

**Version bump convention (always follow this):** `system.json`'s `"version"` must be bumped in its own `chore: bump version to x.y.z` commit after every meaningful feature/fix push. Foundry's update-check compares this field against the manifest URL, so without a bump, worlds never see new content as available. Look at recent `git log` for the exact pattern already in use.

**Install for manual testing:** copy `system.json`, `module/`, `templates/`, `styles/`, `lang/` into `Data/systems/nihility-rpg-system/` in a Foundry install, or point Foundry's "Install System" at the manifest URL in `system.json` (`manifest`/`download` point at this repo's `main` branch on GitHub).

## Architecture

### Entry point and registration

`module/nihility-rpg-system.js` is the only `esmodules` entry in `system.json`. On the `init` hook it:
- Registers all Game Settings (`registerSystemSettings()` in `config.js`) and three visual Settings Menu apps (Currencies, Species Presets, Damage Elements — see below).
- Registers `TypeDataModel` classes onto `CONFIG.Actor.dataModels` / `CONFIG.Item.dataModels` (this system uses `documentTypes` in `system.json`, not a `template.json`).
- Unregisters the core sheets and registers this system's custom `ActorSheet`/`ItemSheet` subclasses as default.
- Exposes a public API at `game.nihility` (`config`, `ai` = the `AIHelper` export from `ai-helper.js`, `openAssistant()`).

Other hooks worth knowing about, all in this same file: `preUpdateActor` grants Normal Skill Points on level-up (merged into the same write, so it works even when a player levels themself up), `preDeleteItem` cleans up Skills that an Item/Module granted when that source is deleted, `renderChatMessage` wires the Skill-request approve/reject buttons, `renderActorDirectory` injects the GM-only AI Assistant button (with a `game.nihility.openAssistant()` macro fallback since the injection point can vary across Foundry versions).

### `config.js` — the single source of truth for constants and settings

`MEU_SISTEMA` is one large exported config object (tiers, attribute keys/labels, effect targets, default currencies/species/damage-elements, etc.) plus `SYSTEM_ID`. Every GM-configurable list follows the same pattern: a `MEU_SISTEMA.DEFAULT_X` constant, a `getActiveX()` reader that does `setting-JSON > default`, a hidden `config: false` setting storing the JSON string, and a dedicated `FormApplication` in `module/apps/` (see below) that edits it visually. This pattern currently covers currencies, species presets (body parts + racial skills), and damage elements — extend it the same way for any new GM-editable list.

`game.settings` scope matters here: AI provider/endpoint/model/API key are registered `scope: "client"` deliberately (not `"world"`) — a `world`-scoped setting syncs to every connected client including players, which would leak the API key. Since only the GM uses the AI Assistant, client-scope solves this without any relay infrastructure, at the cost of needing to reconfigure per-browser.

### Data Models (`module/data/`)

- `character-model.js` — `CharacterDataModel` (player characters, mounts, and anything else built as `type: "character"`) and `CreatureDataModel` (NPCs; not registered as its own Actor type — NPCs use `"character"` with `isPlayerCharacter: false`). Both share `baseActorSchema()`.
- `starship-model.js` — `StarshipDataModel` (Hull/Shields/Maneuverability + a Power Grid derived from Reactor + Capacitor − module consumption, with overload detection) and `VehicleDataModel` (Integrity/Speed/Fuel).
- `item-models.js` — `SkillDataModel`, `BodyPartDataModel`, `TitleDataModel`, `StarshipModuleDataModel`, `GenericItemDataModel`. Several small schema-builder functions (`grantedSkillSchema()`, `statModifiersSchema()`, `attributeBonusesSchema()`) are reused across multiple of these — read them before adding a new field so you reuse rather than duplicate.

**The `prepareDerivedData()` pipeline in `character-model.js` encodes the game's core balance rule and must run in this order:** `deriveCombatAttributes()` before `deriveVitalStats()` (the latter reads `combat.<attr>.total`, computed by the former). The rule itself, arrived at through several rounds of explicit correction, is a strict three-tier split per combat attribute:

- `attr.total = points + Title bonus` — the only permanent base, and the **only** thing that feeds the HP/Mana Max formula (`HP Max = Força.Total × Defesa.Total × 10`, `Mana Max = Magia.Total × Defesa Mágica.Total × 10`, floored at `MEU_SISTEMA.MIN_BASE_VITAL_STAT`, currently 50).
- `attr.effectiveTotal = total + buffDelta` (buffDelta = temporary Active Effects created by a Skill's `"temporary"` effect) → `attr.bonus = floor(effectiveTotal / 3)` → feeds the escalating dice pool in `dice.js` (+1d20 per +10 of bonus, all dice summed). Temporary buffs/debuffs affect rolls but never HP/Mana.
- `attr.itemBonus` (sum of `attributeBonuses` from equipped Items / installed Body Part mods) is computed but deliberately **excluded** from both `total` and `effectiveTotal` — it never touches HP/Mana and never escalates the dice pool. It's only ever added as a flat `extraFlat` number at roll time (`rollAttribute(actor, key, { extraFlat })` in `dice.js`), matching this system's pre-existing rule that weapon/equipment bonuses "somam por fora, na hora da rolagem."

Separately, permanent `statModifiers.{hp,energy}` (present on Skill, equipped Item, and installed Body Part mods) and the `hp`/`energy` `buffDelta` stack on top of the floored formula result with no ceiling/floor of their own. `Shield` (`attributes.shield.value`) is a flat, max-less resource spent by hand as it absorbs damage — conceptually and mechanically distinct from starship shields (`StarshipDataModel.shields`).

### Skill mechanics: creation vs. runtime use

These are two separate files with two separate concerns — don't conflate them:
- `ai-helper.js` handles Skill **creation/lifecycle**: fusion (`fuseSkills`, tier-consumption rule via `canConsumeTier` — a skill can only consume sources of its own tier or lower), the Skill Point economy (break/merge/request/approve/reject, gated behind GM chat-message approval buttons), Item/Module-granted skills (`createGrantedSkill`/`removeGrantedSkill`, marked `isItemGranted: true` so they can never be fused and vanish automatically when their source is removed), and Compendium auto-registration.
- `skill-effects.js` handles **using** an already-created Skill (`useSkillEffect`): `effectType: "damage"` rolls the skill's free-form `damageFormula` (any Foundry dice syntax) and posts publicly, tagged with 0+ `damageElements` (flavor only); `effectType: "temporary"` applies each entry in `effects` as either a duration-bound `ActiveEffect` (targeting the `buffDelta` schema paths — this is how temporary buffs/debuffs/drawbacks are implemented) or a direct Shield add (no duration).

`isMagicDamage` (boolean) is independent of `damageElements` (array) — a skill can be magical with no element (pure arcane force), elemental with no magic tag (e.g. a flaming sword dealing physical damage), or both. Only `isMagicDamage` gates the Defesa Mágica reduction below; elements are pure chat flavor.

**Magic damage reduction**: when a damage Skill has `isMagicDamage: true` and is used against a target (target selection is only prompted for magic-damage or `"temporary"` skills — plain physical damage skips it), `rollSkillDamage` reduces the roll by `clamp(target.system.attributes.combat.magicalDefense.total × MEU_SISTEMA.MAGIC_DEFENSE_REDUCTION_PER_POINT, 0, MEU_SISTEMA.MAGIC_DEFENSE_REDUCTION_CAP)` — a percentage (not a flat number), so it stays relevant at every level range the same way the HP/Mana formula's multiplicative scaling does. Tune the two constants in `config.js`, not the formula shape, if this needs rebalancing.

Racial-tier skills only ever come from a Species preset (never bought with Skill Points); Ultimate-tier only ever comes from fusion (never bought directly) and is hidden from players in tier dropdowns/lists until they own one — but always visible to the GM (every tier-visibility filter in the sheets is `tier !== "ultimate" || game.user.isGM` or equivalent, deliberately).

### AI integration

`ai-helper.js` also owns all IA generation and editing, all routed through `generateJSON()`/`callAIProvider()` (in `module/ai/providers.js`, which adapts either OpenAI-compatible Chat Completions or the native Anthropic Messages API — this is the only place that knows either wire format). Two distinct capabilities:
- **Create**: `generateActorFromAI`, `generateVesselFromAI`, `generateNoteFromAI`, `generateSkillFromAI`, `generateFreeform` — always create a brand-new document.
- **Edit in place**: `editDocumentWithAI(doc, instruction)` — sends the doc's current `{name, type, system}` snapshot plus a free-text instruction, expects back a JSON patch restricted to `name`/`img`/`system.*` keys (`sanitizeDocumentPatch` strips anything else, e.g. `_id`/ownership), and applies it via `doc.update()`. Only Actor/Item are supported (not JournalEntry). Driven from `module/apps/ai-assistant.js`'s "Editar Existente" mode, which resolves the drag-dropped target via `TextEditor.getDragEventData`.

Currency conversion (`convertActorCurrency`) never leaves a fractional amount on the destination currency: `applyWholeCurrencyAmount` recursively cascades any fractional remainder down into the next-lower-`baseValue` currency (careful with this function if you touch it — it was fixed once for a bug where the cascade could land back on the source currency and get overwritten instead of accumulated).

"Voz do Mundo" (`announceVoiceOfTheWorld`) is the system's private-announcement channel (level-ups, fusions, new skills, currency transfers) — always sent via `whisper` to GMs + the Actor's owning player(s), never public. Don't make this public without being asked; that's a deliberate design choice, not an oversight.

### Sheets and Apps

- `module/sheets/*.js` + `templates/*.hbs` — classic `ActorSheet`/`ItemSheet` (AppV1-style, aliased in V13+), Handlebars templates. `getData()` computes UI-only derived values (percentages for header bars, tier-visibility lists, etc.); `activateListeners()` wires jQuery click handlers. `ItemSheet`/`ActorSheet` default to `submitOnChange: true`, which is why conditional template blocks driven by a `<select>` (e.g. Skill `effectType`, Title bonus target) don't need explicit `change` listeners — picking a new value auto-submits and re-renders.
- `module/apps/*.js` + `templates/apps/*.hbs` — `CurrencyConfigApp`, `SpeciesConfigApp`, `DamageElementsConfigApp` are `FormApplication` Settings Menus following one shared visual-row-editor shape (see `config.js` pattern above); `AIAssistantApp` is a plain `Application` (GM-only, defense-in-depth checked both by the injected button's visibility and inside the app itself).

### Handlebars context depth

Templates lean on Foundry's `eq`/`lookup`/`editor` helpers and nested `{{#each}}` blocks reading from `config.*`. Handlebars `{{#if}}`/`{{#unless}}` do **not** push a new context, but `{{#each}}` does — when adding a `../config.X` or `{{lookup ../../config.Y ...}}` reference, count the actual `{{#each}}` nesting depth from that point, not the visual indentation; getting this off by one silently renders an empty dropdown.

### Agent mode: tool-calling AI assistant

`module/apps/ai-assistant.js`'s third mode ("Agente", alongside the pre-existing "Criar"/"Editar") lets the GM ask for a *mix* of content in one prompt (e.g. "crie 3 skills e 2 personagens") and have the AI ground itself in the actual system state before proposing anything:
- `module/ai/providers.js` — `callAIProviderWithTools`/`appendAssistantAndToolResults` extend the existing single-shot `callAIProvider` with multi-turn tool-calling for both wire formats (Anthropic `tool_use`/`tool_result` blocks vs. OpenAI-compatible `tool_calls`/`role:"tool"` messages) — still the only place that knows either format.
- `module/ai/agent-runner.js` — `runAgentTask` drives the loop: calls the provider, executes whichever tool the model asks for, feeds the result back, repeats until the model stops or `maxTurns` is hit. Never touches the world directly.
- `module/ai/agent-tools.js` — `createAgentTools()` returns the actual tools: read-only ones for grounding (`list_skills`, `list_actors`, `get_system_rules`) and `propose_skill`/`propose_character`/`propose_edit`, which only push an already-normalized, schema-correct document into a `proposals` array — nothing is created yet.
- The app renders `proposals` as a review checklist; only on "Aplicar selecionados" do documents actually get created/edited (via the same `registerItemInCompendium`/`Actor.create`/`sanitizeDocumentPatch` primitives the other AI paths already use).
- Every apply records one entry in `module/helpers/world-backup.js` (a hidden World Compendium of `JournalEntry`, `recordBatchOperation`/`undoBatchOperation`/`listRecentBatchOperations`) so a whole batch — not just one document — can be undone from the same app. This replaced an earlier `localStorage`-based backup helper that didn't sync between GM/players and only tracked one document at a time; don't reintroduce that pattern.

`module/apps/nihility-menu.js` (the GM's single entry point — reachable from `game.nihility.openAssistant()` and the Actor Directory button) is where most of these modes get opened from; only its "Assistente de IA" tab and "backup-manager"/`generate-*` actions are wired to real functionality today — several of its other buttons (economy/titles/anatomy config shortcuts, sync/import/export data, generate-character/generate-item) are still inert placeholders left over from its initial scaffold.
