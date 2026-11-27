# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Nihility RPG System — a custom Foundry VTT game system (id `nihility-rpg-system`, **requires Foundry V13+**, verified to V14) built for a Fantasia/Isekai + Sci-Fi Arcano campaign. It's a manifest-driven Foundry system: pure static JS/Handlebars/CSS, no bundler and no `package.json` (the test suite runs on Node's built-in `node --test`, with zero dependencies). Foundry loads `module/nihility-rpg-system.js` as an ES module directly.

**Design goal to respect in every change:** the owner runs medieval-fantasy, sci-fi and mixed campaigns from this one system, and wants subsystems to be switchable per world. Anything you add should either sit behind a feature toggle or be small enough not to get in the way when the campaign doesn't use it — see "Feature toggles" under `config.js` below.

Everything user-facing is in **pt-BR**, hardcoded in the templates and JS. The `lang/*.json` files now contain only `TYPES.*` keys, which is all Foundry actually consumes here — the ~40 `NIHILITY.*` keys they used to carry were read by nothing (there is no `game.i18n` call anywhere in this system) and were removed so the files stop implying a translation layer that doesn't exist. Write new UI strings in pt-BR like the surrounding code; adding `NIHILITY.*` keys would not resolve anywhere. `NIHILITY` (no dot) is now the name of the configuration object in `module/core/config/constants.js` (formerly `MEU_SISTEMA`), not a translation key.

## Commands

There is no build step and no bundler. **Run `node scripts/check.mjs` before considering a change done** (backlog H19, ~6 s, no dependencies, exit code 1 on any failure). It does everything below in one go:
- the module-mode syntax check of every `module/**/*.js`;
- the test suite;
- `system.json` checks: it is valid JSON, the version is `x.y.z`, and every listed esmodule/style/language file exists;
- no CSS file in `styles/` is left out of `system.json`;
- every `templates/…hbs` cited in the code exists;
- no mojibake (ç, ã… turned into two garbled characters when a script writes UTF-8 as Latin-1);
- no local HTML-escape copy: nothing in `module/` outside `helpers/html.js` calls `escapeHTML(` or defines its own `esc` (`import { escapeHtml as esc }` is fine);
- every file in `docs/claude/` is listed in the index below, and every file the index lists exists.

`--no-tests` skips the suite. The two underlying commands, for a single file:

```bash
node --input-type=module --check < module/path/to/file.js   # syntax of a single file, AS AN ES MODULE
node --test "test/*.test.mjs"                               # unit tests of the pure rule functions
```

`node --test test/` does **not** work (Node treats the folder as a module); bare `node --test` works but also counts `setup.mjs` as an empty test. Use the quoted glob.

**Check syntax in module mode, never with a bare `node --check file.js`.** There is no `package.json` declaring `"type": "module"`, so the bare form parses the file with Node's CommonJS/auto-detect path and lets ES-module-only early errors through. The one that shipped in 1.37: `item-sheet.js` imported `getActiveDamageElements` **twice in the same import list** — a SyntaxError for a module, invisible to the bare check — and because `nihility-rpg-system.js` imports the sheet, the whole module graph failed to evaluate: no `init`, no sheets registered, and the only symptom in Foundry was an empty "Ficha Padrão" list ("as fichas sumiram"). To check everything at once: `for f in $(find module -name '*.js'); do node --input-type=module --check < "$f" || echo "$f"; done`.

The suite is split by subject into `test/*.test.mjs` (dice-progression, combat-damage, combat-effects, skills, species-anatomy, ships, economy, environment, movement-area, world-config, ai, npc-generator, skill-assist, encounter, table-tools, creation, glossary, plus gm-relay, anchored-targets, skill-use-flow, html); each file starts with `import "./setup.mjs";` — **put a new test in the file of its subject, or a new file**, there is no single `rules.test.mjs` any more (split in 1.78). It covers only what is callable without Foundry — dice pool and initiative formula, resistance curve, XP curve and Resistance-XP gain, the Skill level cycle (`skillLevelBonuses`/`effectiveSkillCost`), damage scaling, module presets and structural damage, currency conversion, AI batch prompts, fusion snapshot, Skill-area geometry, floating-number deltas, the Skill sentence, XP por uso, consumables/charges/magazine/ammo swap — with `test/setup.mjs` stubbing the handful of Foundry globals the import path touches (`Math.clamp`, `foundry.utils.*`, `foundry.data.fields`/`abstract.TypeDataModel`, `ui.notifications`). Note `game.settings.get` is stubbed to **throw**, on purpose: that is the real boot-order path every config reader has to survive, so the suite exercises each reader's default-fallback branch. A test that needs a *configured* value has to pass it in as an argument — which is a good reason to keep new rule functions taking their tuning as parameters. Every pure rule function currently has coverage; keep it that way when you add one. **The bar for adding a test there is that the function needs no Actor/Item/canvas** — if a test would need to fake a Document, extract the pure part instead of growing the stub. Everything involving documents, sheets or canvas is still manual load-testing inside a running world.

**Version bump convention (always follow this):** `system.json`'s `"version"` is bumped **in the same commit as the change itself**, never as a separate follow-up commit. Every meaningful feature/fix commit carries its own bump. Foundry's update-check compares this field against the manifest URL, so without a bump, worlds never see new content as available — and keeping the bump inside the commit that earned it means a version always points at exactly one set of changes. A push to `main` that changes `"version"` triggers `.github/workflows/release.yml`, which runs the check, builds a zip with only the system files (`scripts/build-release.mjs`, `download` pinned to that version) and publishes the Release `v<version>`; `main`'s `system.json` points at `releases/latest`. `check.yml` runs the check on every push/PR.

**Install for manual testing:** copy `system.json`, `module/`, `templates/`, `styles/`, `lang/` into `Data/systems/nihility-rpg-system/` in a Foundry install, or point Foundry's "Install System" at the manifest URL in `system.json` (`manifest`/`download` point at this repo's latest GitHub Release; users get it only after a version bump is pushed to `main`).

## Where each subject lives

This file holds only what applies to every change. Each subsystem is documented in its own file under `docs/claude/`. When the text below says "see X below" or names a section that is not in this file, it is in one of these files. **Before touching a subsystem, read its file** — the rules there (owner's decisions, known limits, "never do X") are as binding as the ones here.

| File | Subject |
|---|---|
| [config.md](docs/claude/config.md) | `config.js` and its split, catalog readers and cache, feature toggles, attributes, energy labels, picking Actors, Data Models and the `prepareDerivedData` order |
| [skills.md](docs/claude/skills.md) | Skill creation vs. use, Fusão/Evolução, weapons, Sub-Skills, Emissão, Resistência, Conditions and periodic ticks, Habilidade Ativa and anchors, Mana variável, Recarga/Preparo/investir, personal shield pools, Escudo mantido, hotbar, the Skill sentence, assisted editor (warnings, suggested cost, templates) |
| [dano.md](docs/claude/dano.md) | Damage by element, hierarchy, affinity table, Dano Absoluto, Escala, Traços, "Quando → Então", XP/level/damage-scaling curves, XP por uso, Shift+click roll modifiers |
| [estruturas.md](docs/claude/estruturas.md) | Estruturas (walls, render, blocking attacks, lights), material and regeneration, magic/tech nature, PEM, Antimagia fields, Manipulação, adaptive shield |
| [inventario.md](docs/claude/inventario.md) | Inventory, cargo, ammo, consumables, charges, weapon magazine |
| [conjuntos.md](docs/claude/conjuntos.md) | Conjuntos de Itens e Módulos (J12): catálogo, contagem de peças, faixas que somam, Habilidade concedida pela faixa, bônus de Nave, fábrica |
| [lojas.md](docs/claude/lojas.md) | Lojas (G2): ficha-loja, preço base × multiplicador × sorteio, compra e venda, avaliação do Mestre, Desfazer, reposição pelo relógio, o que falta (lotes B e C) |
| [gm-relay.md](docs/claude/gm-relay.md) | Writing in the GM's name (socket relay), `reply: true`, Skill effects on other people's Actors |
| [combate.md](docs/claude/combate.md) | Initiative, apply-damage cards, Vida 0, Contágio, scene environment and mana density, radiation, Conditions on the token HUD, floating numbers, on-screen notices, end of combat, Desfazer uso, movement per round |
| [achados-foundry.md](docs/claude/achados-foundry.md) | Everything the real-Foundry test sessions found (V14/core traps). **Read before writing anything that touches Active Effects, Tokens, combat or arrays** |
| [naves.md](docs/claude/naves.md) | Ships and vehicles: Porte, classes, module categories and roles, power grid and priority queue, overload, damage cascade, weapons, crew, repair |
| [sensores-abordagem.md](docs/claude/sensores-abordagem.md) | Ship sensors and stealth (F1: Sensor, Assinatura, Camuflagem, Escanear, último contato, Interferência de cena) and Boarding (F2: Acoplar, grupo de abordagem, Sabotar/Desligar/Hackear, teleporte, Região "A bordo"); also the "Trocar com…" within 2 m |
| [pad.md](docs/claude/pad.md) | The in-game phone |
| [ia.md](docs/claude/ia.md) | AI modules, generation, mechanics in generated content, Agent mode |
| [npc-simulador-ferramentas.md](docs/claude/npc-simulador-ferramentas.md) | NPC generator and tiers, encounter simulator, grouped feature menu, "Deixar leve", trimmed sheet, Regras desta mesa, combat panel |
| [criacao-glossario.md](docs/claude/criacao-glossario.md) | Sheet in creation mode, Skill request with mechanics, world Glossary |
| [alcance-movimento-sentidos.md](docs/claude/alcance-movimento-sentidos.md) | Range and Marks, push/pull, flight/elevation/burrowing, senses and visibility |
| [armas-maestria.md](docs/claude/armas-maestria.md) | Weapon types, Maestria, unarmed attack, weapon strikes |
| [mundo.md](docs/claude/mundo.md) | Region traps, world clock / day-night / Dormindo, sheet restore points |
| [tempo-espaco.md](docs/claude/tempo-espaco.md) | Time manipulation (8e): Acelerar/Desacelerar, Parar (+ area, temporary chamber), Reverter (photo ring, effect log, bonds), the time reserve in combat, weakening against stronger targets. **Space manipulation (8f lots 1-2):** the "Espaço" effect (Saltar, Trocar), the Âncora (Condição Ancorado, Campo de Âncora, Região) and the ship Interdição; Portal, Bolso and Domínio are still to come |
| [formas-nomeacao-predacao.md](docs/claude/formas-nomeacao-predacao.md) | Forms, Naming / soul link / Pact, Analysis / Concealment / Predation |
| [reacoes-superficies.md](docs/claude/reacoes-superficies.md) | Elemental reactions, "Só se…", surfaces |
| [marcas-combinada-sorte-rerrolar.md](docs/claude/marcas-combinada-sorte-rerrolar.md) | Marks and "ao acertar", attribute %, complexity, Combinada and the duel bubble, luck, reroll, dissipate |
| [fichas-ui.md](docs/claude/fichas-ui.md) | ApplicationV2 conversion pattern, Item sheet redesign, "Avançado ▸" folds, the array trap in forms |
| [especies.md](docs/claude/especies.md) | Species template with link, lineages, heritages, evolution, anatomy, part HP, healing/blocks, Antimagia, curses, regeneration, rest |
| [explicar-numeros.md](docs/claude/explicar-numeros.md) | "De onde vem", GM damage trace, Validar Mundo |

**When you add or change a subsystem,** write it in that subject's file (or a new file plus a row in this table), not here. Only a rule that applies to every change belongs in this file. Owner-facing additions usually also need an entry in the Glossário, in Regras desta mesa and in Validar Mundo — check the neighbouring subsystems' files for how they did it.

## Rules that apply everywhere

Short versions; the details are in the files above.

- **Config:** import everything from `module/core/config.js`, never from `core/config/`. Catalog readers are cached: never mutate what they return — `foundry.utils.deepClone` first, and deep-clone before it becomes document data ([config.md](docs/claude/config.md)).
- **Feature toggles:** a new switchable block is one line in `FEATURES` plus a row in `FEATURE_LAYOUT` (the test fails without it). Read toggles through `isFeatureEnabled`/the named shortcuts. **Turning a feature off only hides UI and blocks new content; it never deletes, migrates or rewrites saved data.**
- **Settings** are registered only inside the `init` hook. API keys stay `scope: "client"`. One-time migrations go through `runMigrationIfNeeded` **and** are added to `MIGRATION_KEYS` (`core/migration-keys.js`, frozen by a test) and `MIGRATIONS` (`core/migrations.js`), at the end.
- **Actors are compared by `uuid`, never `id`** (unlinked tokens share ids): `sameActor`, `combatantIsActor`, `actorToken`, `actorDisplayName`; store uuids in flags. Skill targets go through `pickTargetActor`.
- **Labels:** attributes through `getAttributeLabel(key)` (renamable, never re-keyable); energy through `getEnergyLabelForActor`/`getCharacterEnergyLabel`/`getStarshipEnergyAbbr` — never write "Mana"/"EPS", and never give the energy a fixed grammatical gender ("de {E}").
- **Writing someone else's document** (or anything inside a compendium, which players can never write) goes through `runAsGm` in `helpers/gm-relay.js`: check who asked (server-filled `user`), treat the payload as untrusted and rebuild from the sheet, and only the **designated** GM executes. Each subsystem exports its actions as `RELAY_HANDLERS`; `core/relay-actions.js` registers them and `core/relay-action-names.js` is the frozen list (a new action needs its name there). Never use `game.user.isGM` as the "who executes" guard of a hook that writes — use `isDesignatedGm()` ([gm-relay.md](docs/claude/gm-relay.md)).
- **Pure rules** live in `*-rules.js` files with no Foundry access, take their tuning as parameters, and get a test in the `test/*.test.mjs` of their subject.
- **A new Skill field** must go into every mechanic copy list: `skill-snapshot.js` (fusion and granted Skill), `evolveSkill`, `REQUEST_MECHANIC_FIELDS`, `sanitizeSkillMechanics` (AI), the quick editor and the sheet. State fields (cooldown left, active target, ratios) never go into copy lists.
- **One "Usar Skill" flow:** `useSkillFlow` in `skills/skill-use-flow.js`; never grow a per-sheet copy.
- **Foundry traps** (each one shipped a bug; details in [achados-foundry.md](docs/claude/achados-foundry.md)):
  - Active Effect changes only through `buildEffectChanges`/`readEffectChanges`/`createActiveEffects`; durations only through `effectDurationRounds`/`effectStartRound`/`effectRoundsUpdate` (V14 is `duration: {value, units}` + `start`).
  - Never write one field of one array element by an index path (`system.subSkills.0.active`): rewrite the list (`skillStateUpdate`).
  - Re-prepare an Actor with `actor.reset()`, never `prepareData()` alone. Never reuse an options object across writes.
  - Delete a key with `deleteKeyUpdate(path)`. Wall sense types with `wallSenseTypes()`.
  - Token elevation through `tokenElevation()`, and size/image through `_source`: the live document carries animation frames and goes stale in a background window. In `moveToken` the document is still at the OLD position: use `movement.destination`.
  - `createEmbeddedDocuments` returns in sort order: map original → copy by a flag stamp, never by index.
  - Combat scene through `combatantScene`/`combatScenes`, never `combat.scene`.
  - Async start-of-turn hooks capture `combat.combatant` at the start; ignore `options.direction < 0`.
- **HTML:** escape every document/catalog string with `escapeHtml` (`helpers/html.js`); user HTML goes through `foundry.utils.cleanHTML` before being saved. Errors someone at the table must see go through `reportError`. Noisy logs go through `debugLog`.
- **UI:** build to the approved design artifact when there is one; new UI gets a mockup approved first. All user-facing text is pt-BR.

## Architecture

### Layout de pastas (`module/`)

Code is grouped by subject, not by layer (reorganized in 1.53.1; file names did not change, only folders):

| Folder | What lives there |
|---|---|
| `core/` | `relay-actions.js` (collects every subsystem's GM-relay `RELAY_HANDLERS`) + `relay-action-names.js` (pure: the frozen action list), `config.js` (entry point that re-exports `core/config/*`: settings, FEATURES, catalogs and their readers — see below), `config/` (the split of config.js, with `config/defaults/` for factory data), `config-transfer.js`, `compendium.js`, `dice.js`, `roll-modifiers.js`, `voice-of-the-world.js`, `vfx.js`, `hotbar.js` (Skills/weapons/consumables on the hotbar), `migrations.js` + `migration-keys.js` (one-time migrations, their frozen keys and `runPendingMigrations`), `table-rules-text.js` (pure) + `table-rules-journal.js` (Regras desta mesa) |
| `combat/` | initiative (`combat.js`), `movement.js`, damage (`damage-rules.js` pure, `damage-roll.js` rolling + target reductions, `damage-apply.js` chat card), `resistance.js`, `antimagic.js`, Conditions (`conditions.js`, `conditional-*.js`), `effect-anchors.js`, `shield-pools.js`, `area-effects.js` + `area-geometry.js` (pure), `lights.js`, `stat-explain.js`, `floating-numbers.js` + `vital-deltas.js` (pure), `encounter-sim.js` + `encounter-rules.js` (pure; Simulador de encontro), `turn-start.js` + `turn-start-rules.js` (pure; start-of-turn steps) |
| `skills/` | `skill-effects.js` ("Usar Habilidade": `useSkillEffect` + applying effects to one target / an area), `effect-targets.js` (where each effect target lands per Actor type), `skill-state.js` (active/invest paths, energy source), `effects-apply.js` (Active Effects, Conditions, periodic ticks), `upkeep.js` (Active Skills: anchors release, drain, Mana em 0), `sustained-shields.js`, `zones.js`, `skill-economy.js`, `skill-snapshot.js`, `skill-xp.js` + `skill-xp-rules.js` (pure; XP por uso), `skill-summary.js` (pure) + `skill-summary-ui.js` (a Skill numa frase), `skill-undo.js` + `skill-undo-rules.js` (pure) + `skill-use-context.js` (Desfazer uso), `skill-assist.js` + `skill-lint-rules.js`/`skill-cost-rules.js`/`skill-template-rules.js` (pure; editor de Skill assistido) |
| `species/` | `species-rules.js` (pure), `species.js` (apply/preview) |
| `structures/` | `structures.js`, `structure-geometry.js` (pure), `structure-render.js`, `structure-contact.js` |
| `starship/` | `starship-model.js`, `starship-sheet.js`, `starship-power.js`, `starship-repair.js`, `ship-damage.js` (cascade, ship weapons, ammo, instant ship effects), `crew-ownership.js`, `module-install.js` + `module-install-rules.js` (pure) (Módulo install rules and the Porte-range hook) |
| `economy/` | `currency.js`, `inventory.js`, `consumables.js` + `consumable-rules.js` (pure: consumíveis, cargas, carregador, munição) |
| `ai/` | `ai-generation.js`, `ai-helper.js`, providers, agent runner/tools |
| `world/` | `world-validator.js` (pure), `world-backup.js` |
| `npc/` | `npc-generator-rules.js` (pure: point split, draws, names, NPC tier Vida), `npc-generator.js` (drafts, creating sheets, placing Tokens, the tier hook) |
| `glossary/` | `glossary-rules.js` (pure: entries with fixed keys and current names, auto links, search, catalog sentences), `glossary.js` (reads the world, saves GM edits, opens the window) |
| `creation/` | `creation-rules.js` (pure: the "Criando" strip, skill slots, quick spreads, "Ao confirmar" preview, attribute purpose, species card, `requestSkillSystem`), `creation.js` (Ficha em modo criação: ready/adjust/release, the GM banner and card, `createCharacter` relay, hooks) |
| `environment/` | `environment-rules.js` (pure), `environment.js` (scene/Region hazards, mana density, FXMaster), `radiation-rules.js` (pure) + `radiation.js` (radiation sources, irradiation, Passar tempo) |
| `data/`, `sheets/`, `apps/`, `helpers/`, `pad/` | Character/Item DataModels, Character/Item sheets, standalone apps, cross-cutting helpers (`foundry-compat`, `gm-relay`, `target-picker`…), the PAD |

`skill-effects.js` used to be one 2500-line file; it was split along those lines with no behavior change. Modules that call each other (e.g. `skills/upkeep.js` ↔ `skills/effects-apply.js`) form import cycles that are safe because nothing is used at module-evaluation time — keep it that way: no top-level code that *calls* an import from a sibling.

### Entry point and registration

`module/nihility-rpg-system.js` is the only `esmodules` entry in `system.json`. On the `init` hook it:
- Registers all Game Settings (`registerSystemSettings()` in `config.js`) and six visual Settings Menu apps (System Modules/feature toggles, Attributes, Currencies, Species Presets, Damage Elements, Status Conditions — see below).
- Registers `TypeDataModel` classes onto `CONFIG.Actor.dataModels` / `CONFIG.Item.dataModels` (this system uses `documentTypes` in `system.json`, not a `template.json`).
- Unregisters the core sheets and registers this system's custom `ActorSheetV2`/`ItemSheetV2` subclasses as default (see "Sheets and Apps" below — everything UI-related runs on ApplicationV2 now, not the classic AppV1 API).
- Calls `registerInitiative()` (`combat.js`), which swaps `CONFIG.Combatant.documentClass` so initiative rolls the system's own attribute pool — see "Iniciativa" below.
- Exposes a public API at `game.nihility` (`config`, `ai` = the `AIHelper` export from `ai-helper.js` — itself just an assembly point over several focused modules, see "AI integration and the ai-helper.js split" below, `openAssistant()` — opens `NihilityMenuApp`, the system's single GM entry point, not a bare AI assistant popup).

On the `ready` hook it calls `registerGmRelay()` (the socket bridge, see "Escritas em nome do Mestre" below) and `registerStatusConditions()` (publishes the Condition catalog into `CONFIG.statusEffects`, see "Condições no HUD do token"), then `ensureSystemCompendiums()` and the guarded migrations.

Other hooks worth knowing about, all in this same file: `preCreateActor` applies `defaultPrototypeToken(type)` — Vida/Mana bars for Personagem, Escudo/Casco plus `actorLink: true` for Nave/Veículo (a ship is unique in the world; an unlinked token would spawn copies with their own power grid), skipped entirely when the creation data already carries its own `prototypeToken` so duplicating/importing preserves what the Actor had — and seeds a new `character` with the starting Normal Skill Points (skipped when the creation data already carries a value, so duplicating/importing an Actor doesn't gift extra points); `preUpdateActor` grants Normal Skill Points on level-up (merged into the same write, so it works even when the level changes some other way than the GM's Level Up button) and always calls `announceLevelUp` first — before the skill-point early-return, so the announcement still fires even if the per-level grant setting is 0; `preDeleteItem` cleans up Skills that an Item/Module granted when that source is deleted; `preCreateItem`/`preUpdateItem` (now in `starship/module-install.js`, registered by `registerModuleInstallRules()` in `init`) enforce the three Módulo install rules (see "Sistema de Naves"); `renderChatMessageHTML` wires the Skill-request approve/reject buttons, the ship-repair buttons **and** the damage-apply buttons (`renderDamageControls`, see "Aplicar dano pelo chat"), and hides PAD message/contact-share cards from the normal chat log (the PAD reads `game.messages` directly, so hiding the DOM card costs it nothing); `preCreateActiveEffect` routes a Condition marked by hand on the token HUD through `interceptManualCondition`; `createChatMessage` raises the PAD's incoming-message notice (it lives on the *creation* hook, not on the sender, because only the recipient's own client knows whether that conversation is currently open on screen); `updateActor`/`updateItem` fire `announceXpReadyIfJustFilled` when an Actor's or a Skill's XP reaches its cap — the Level Up itself stays a GM click; `renderActorDirectory` injects a button that opens `NihilityMenuApp` — visible to **every** user now, not just the GM, because the menu has a player-accessible "Fichas" tab (with a `game.nihility.openAssistant()` macro fallback since the injection point can vary across Foundry versions); `updateCombat` runs the start-of-turn chain (`onCombatTurnStart` in `combat/turn-start.js`, designated GM only; the ordered step list is `TURN_STEP_IDS`, see "Início de turno" in [combate.md](docs/claude/combate.md)).

**Every `game.settings.register`/`registerMenu` call must sit inside the `init` hook.** The `nihilityMainMenu` menu used to be registered at module-evaluation time, at the bottom of the file, outside any hook — unsupported by the API and one boot-order change away from breaking the whole system load. It now lives with the other six `registerMenu` calls inside `init`; keep it that way.

One-time migrations (`migrateCommonTierToNormal`, `migrateElementalDamageToMagicTag` and the rest, now in `core/migrations.js`; the `ready` hook just calls `runPendingMigrations()`) run through `runMigrationIfNeeded(key, fn)`, which checks/records completion in the `completedMigrations` world setting (`getCompletedMigrations()`/`markMigrationCompleted()` in `config.js`) — **always use this wrapper for a new one-time migration**, never call a migration function directly from the `ready` hook. Without the guard a migration re-scans every Actor and the whole relevant Compendium on every single world load, forever, even decades after it already succeeded once.

## UI code and Foundry compatibility

### DialogV2 content must not contain a `<form>`

`DialogV2` already wraps its `content` in its own `<form>`. The HTML parser drops a `<form>` start tag found inside another form — **together with its class** — so `<form class="nihility-roll-options">` rendered as bare children and none of the dialog's CSS applied (the shift+click roll dialog showed its modifier row stacked and unstyled). Wrap dialog content in a `<div class="…">`; the callbacks read fields off `dialog.element` either way. Same for any content string that ends up inside another form.

### Using a Skill, escaping HTML, showing errors (1.78)

- **One "Usar Skill" flow** — `useSkillFlow(actor, itemId, {event, pickTarget})` in `skills/skill-use-flow.js` (with `promptSubSkillChoice`; the decision of *which* mode a click is — deactivate / structure / zone / emission / self / targeted / plain — is the pure `skillUseMode` in `skills/skill-use-mode.js`, tested). Both sheets' `useSkillItem` delegate to it, passing their own `_promptSkillTarget`, and the hotbar calls `useSkillItem`. The ship sheet used to have a reduced copy that ignored Sub-Skills, Emission, Zona and Estrutura and always applied "temporary" Skills to the ship itself; now a ship's targeted temporary Skill opens the picker with the ship preselected. Never re-grow a per-sheet copy.
- **Escape every document/catalog string that goes into HTML** with `escapeHtml` from `helpers/html.js` (the only copy; `card-list-config-factory.js` re-exports it). Cards, flavors, `innerHTML`, DialogV2 `content`, `<option>` values. Effect summaries are plain text and get escaped when joined (`summary.map(escapeHtml)`). The Voz do Mundo template renders `{{body}}` (escaped) — `body` is always plain text; the screen banner extracts text with `DOMParser`, never by assigning to a live element's `innerHTML` (an `<img onerror>` in a name would run). A player's Skill request description is HTML on purpose and goes through `foundry.utils.cleanHTML`. Notifications are **not** escaped by the core: a plain message only goes through `cleanHTML` (scripts and handlers are stripped, but `<b>` in a name still renders), and `escape` applies only to `format` arguments — escape a name with `escapeHtml` when it must show literally.
- **Failures someone at the table must see** go through `reportError(message, err, {notify, gmOnly})` (`helpers/report.js`): console + `ui.notifications.error`. The start-of-turn ticks use `gmOnly`. Purely visual failures (per-frame drag, badges) stay `console.error`.

### Stylesheets

Since 1.78 the CSS is 13 files in `styles/` (`01-base.css` … `13-screen-and-combat.css`), listed **in order** in `system.json` `styles` — the order is the cascade; their concatenation is byte-identical to the old single file. The old file was written chronologically, so a file holds a contiguous run, not a perfectly clean subject: search before adding. Colors that equal exactly one `:root` token were turned into `var(--nihility-…)`; use the tokens for new rules.

### Two CSS traps from the Foundry core theme

Both of these produced bugs that looked like something else entirely, so check them first when layout or text "disappears":

- **The core gives every `<button>` a fixed height** (`var(--button-size)`). A button whose content is taller than that stays clamped to it: the content overflows its own box, overlaps whatever is next to it, and **only the original short strip stays clickable**. That single rule caused both PAD symptoms at once — the icon grid reported `clientHeight: 23` while the tiles drew at ~100px, so the status line underneath was overlapped and most of each icon was dead to clicks. Any button in this system whose content is a tile/card needs `height: auto; min-height: 0; line-height: normal`.
- **Anything the core styles is dark-on-dark by default** — and `<label>` is the one that bites most: the core paints labels with the light theme's text color, and every child inherits it, so a whole panel of text renders invisible while still occupying its space (tall empty rows with just a checkbox is the signature). This emptied the *Módulos do Sistema* list once. Every standalone app/dialog in this system therefore sets `color` explicitly on its own text — see the block at the end of the stylesheet covering `.nihility-config-app`, `.nihility-condition-dialog` and `.nihility-target-picker`. Never rely on inheritance for color inside an application window.
- **Rich text is dark-on-dark by default.** `<prose-mirror>`'s editable area inherits the core's light-theme text color, which vanishes against this system's dark panels — you can type, the content saves, the HTML source view shows it, and the visual editor looks empty. Always set an explicit `color` on `.ProseMirror` *and* on the block elements inside it (`p`, `h1`…), since those get their own color from the core.

Rich text fields use the `<prose-mirror>` custom element, never the old `{{editor ... button=true}}` helper — that helper draws a pencil button whose click handler was wired by AppV1's `FormApplication#activateEditor`, which DocumentSheetV2 does not do, so the button renders and does nothing. `<prose-mirror name="system.x" value="{{system.x}}">` is a real form field, so `submitOnChange` saves it with no handler of our own.

### Handlebars context depth

Templates lean on Foundry's `eq`/`lookup`/`editor` helpers and nested `{{#each}}` blocks reading from `config.*`. Handlebars `{{#if}}`/`{{#unless}}` do **not** push a new context, but `{{#each}}` does — when adding a `../config.X` or `{{lookup ../../config.Y ...}}` reference, count the actual `{{#each}}` nesting depth from that point, not the visual indentation; getting this off by one silently renders an empty dropdown.

### Foundry version compatibility — `helpers/foundry-compat.js`

`system.json` declares `minimum: 13` / `verified: 14`. V12 is **not** supported: the V13 render hooks hand you a plain `HTMLElement` where V12 handed jQuery, and the whole codebase now assumes the former (there is no jQuery anywhere in `module/`).

**Active Effect format (V13 × V14).** V14 moved changes to `system.changes` with a string `type` (add, multiply, override…) instead of `changes` + numeric `mode`; the old form still works there but is deprecated. The system keeps speaking `{key, mode, value}` internally and translates only in `foundry-compat.js`: `effectModes()` (the numeric modes, with a fallback if `CONST.ACTIVE_EFFECT_MODES` ever disappears), `buildEffectChanges(changes, generation)` (writes the version's format; pure, tested), `readEffectChanges(effect)` (reads both), and `createActiveEffects(parent, data)` (retries in the old format if the new one is refused). Never write `changes:` into an Active Effect or read `effect.changes` directly — go through these.

**Janela de Efeitos** (`apps/effects-list.js`, one window per Actor uuid, opened from the "✦ Efeitos" button on both sheets): read-only view of Active Effects (described through `describeEffectChangeKey` and `readEffectChanges`), personal shield pools, sustained shields (with "Regenerar agora" → `regenerateSustainedShields` relay action), Active Skills (`collectActiveUpkeepSources`, now exported), maintained Structures (all scenes), `pendingUpkeepRemoval`, encumbrance; on ships, system effects, tractor holds and adaptive shield learning. Re-renders from `updateActor`/`*ActiveEffect`/`updateItem`/`updateScene` hooks registered once and removed in `_onClose`. Ending effects is GM-only.

**Combat × Scene (V14).** A V14 Combat is created with `scene: null` unless the GM links it, and `Combatant` has no `scene` getter (it stores `sceneId` and resolves `token` from it). Never read `combat.scene`/`combatant.scene` for game logic — use `combatantScene(combatant)` and `combatScenes(combat)` (`foundry-compat.js`). Until 1.66.0 the `updateCombat` hook gated Zones and Structures on `combat.scene`, so on V14 they never counted rounds nor ticked damage.

Every API the V13 release moved into a namespace goes through `module/helpers/foundry-compat.js`, which is the single place allowed to name them: `renderSystemTemplate`, `pickImageFile`/`filePickerClass`, `getDragEventData`/`textEditor`, `compendiumCollectionClass`, `actorsCollection`/`itemsCollection`, `coreActorSheetClass`/`coreItemSheetClass`, `saveTextToFile`/`readFileAsText`. **Never call `renderTemplate`, `FilePicker`, `TextEditor`, `CompendiumCollection`, `Actors`/`Items`, `saveDataToFile` or `readTextFromFile` directly** — those bare globals are V12-era deprecation shims that disappear in a future release, and they were all removed from this codebase on purpose. The chat hook is `renderChatMessageHTML` (not the old `renderChatMessage`), which delivers an `HTMLElement`.
