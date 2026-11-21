# Ficha em modo criação, pedido de Skill com mecânica e Glossário

> Parte do guia do projeto. O índice e as regras que valem em todo lugar estão no `CLAUDE.md` da raiz. Quando o texto diz "abaixo"/"acima" ou cita uma seção que não está aqui, procure-a pelo índice.

## Ficha em modo criação e pedido de Skill com mecânica (1.84.0)

The owner approved the Design artifact "Ficha em Modo Criação" (version 2, boards 1–5) and chose that "Pronto para jogar" needs the GM's approval; build to it. A first version, a 6-step wizard in its own window, was rejected; a subagent, ChatGPT and Gemini all pointed to the same alternative, the real sheet with a strip. Backlog J10, plus an improved Skill request. The feature is `FEATURES.creationMode`, on by default and in group Personagem. The Skill request works with the feature off too. There are no new game rules.

- **State.** `system.creation = {active, status: editing|ready|adjust, gmNote, readyAt}` and `system.concept` (one sentence, also shown at the top of Biografia) on `CharacterDataModel`. `inCreation(actor)` = `creation.active` with the feature on. Turning the feature off only hides the strip; the saved state stays.
- **Who writes what.** Only the GM switches creation on or off and writes `gmNote`. The player only moves `status` between editing and ready. While in creation with the attribute pool on, the player can't write `points` or `speciesState.lockedAt` either, so the release is the only confirm. All of this is enforced by `guardCreationWrites`, a `preUpdateActor` hook in creation.js that strips those keys from a non-GM update.
- **The sheet in creation.**
  - The "Criando" strip (`creationSteps`, pure) shows Conceito · Origem · Pontos N/M · Skills N/M. Each item goes where it is fixed (`creationGo`) and gets a ✓ when done. Points and Skills still missing turn amber once "Pronto" is possible.
  - "Pronto" needs only a name and a Species (plus the Lineage when the Species requires one, and no Species when the catalog is empty).
  - The concept input sits under the name.
  - The Origem tab becomes the species grid (`originPicker`: `getSpeciesForCreation`, groups, search, lineage tiles, and the "X traz" lines from `speciesCardLines`, which runs on `resolveSpeciesTemplate`). The picked card is screen state (`this.originPick`). "Ficar com…" calls the usual `changeActorSpecies`.
  - The Anatomia tab is hidden.
  - "Confirmar" becomes "confirma quando o Mestre liberar".
- **Strip status.** "Pronto para jogar" (`markReady`) sets `status: ready` and whispers a `creationReady` card to the GMs (`templates/chat/creation-ready.hbs`). Every GM client's `createChatMessage` then shows the Voz do Mundo banner with buttons: `showVoiceBanner` now takes `label` and `actions`, and stays 30 s or until a button is clicked.
  - "Pedir ajuste…" (`requestAdjustment`) sets `status: adjust` plus the note, and announces it to the player through Voz do Mundo. The player then clicks "Pronto de novo".
  - "Liberar…" (`releaseCharacter`) moves pending points into `points` and sets `speciesState.lockedAt`. It switches creation off, fills Vida and Mana, approves the Skill requests left checked, flags the ready cards `released` and announces to the player.
- **Entry points.**
  - Player: Menu › Fichas "Criar personagem" calls `requestNewCharacter`. Foundry doesn't let players create Actors, so this goes through the `createCharacter` relay with `reply: true`; the GM creates the blank sheet, owned by the requester, with a linked friendly Token, and sets it as `user.character` if the player had none. A player gets one sheet in creation at a time: asking again returns the existing one, and the button becomes "Continuar X". With no GM online the button is disabled.
  - GM: "Criar personagem para [jogador | Ninguém (NPC)]" (`createCharacterFor`), plus the "Em criação" list (`creationListForGm`) with Liberar and Pedir ajuste on rows that are waiting.
  - GM: the sheet's ⋮ menu (`_getHeaderControls`, built when the menu opens) offers "Pôr em modo criação" (`enterCreation`, which also sets `speciesState.unlocked`; nothing is deleted), or "Liberar personagem…" and "Pedir ajuste…" while in creation.
  - Macro: `game.nihility.createCharacter()`.
- **Attributes, inside and outside creation.**
  - Each attribute gets a purpose line (`attributePurpose`, which follows `getVitalFormula`, the initiative attribute and movement).
  - "Começar de um jeito" (`QUICK_SPREADS` + `quickSpread`, largest remainder over visible attributes) fills pending points. It shows only while no point has been confirmed.
  - The "Ao confirmar" panel (`vitalPreview`, pure) shows the current vs. pending Vida/Mana with the formula, plus initiative and movement. It shows while points are pending or in creation. It sits under the attribute list, not beside it as on the board, because the sheet's left rail is narrow.
- **Skill request with mechanics.** The player builds the request in `openSkillEditorDialog` in request mode (`openSkillRequestEditor` in skill-economy.js; editor options `request`, `tierLabels`, `title`, `saveLabel`).
  - "Começar de" offers template tiles, "Do Compêndio…" (`pickCompendiumSkill`: a copy from the world's Skills pack, filtered by tier) and "Só descrever" (the old blank).
  - Level is always 1. Only tiers with free points are offered.
  - An open request **reserves** its point: `freeSkillPoints` = points minus open requests of that tier.
  - The flag stores `mechanics: requestSkillSystem(…)` (pure; it copies only `REQUEST_MECHANIC_FIELDS`, with no Sub-Skills, XP or level).
  - Old requests (text + cost only) still approve, and come out Descriptive.
- **The request card.** It shows the Skill sentence, the requested cost vs. the suggested cost, the warning count and the description, with four GM buttons (`renderSkillRequestControls`):
  - **Aprovar**: creates the Skill ready to use.
  - **Ajustar e aprovar…**: the same editor, tier locked; what the GM saves is what gets approved.
  - **Pedir mudança…**: `status: changes` plus `gmNote`, announced to the player.
  - **Rejeitar**.
- **Request extras.**
  - The author (the message's owner) gets "Editar pedido" on the card and "editar" on the sheet row, both via `editSkillRequest`. Editing puts the request back to `pending`.
  - Open requests show as dashed rows in their tier band (`requestsByTier`), and an empty band with a request is shown.
  - Clicking the name opens the Skill read-only: a temporary Item, with its sheet built with `editPermission: OWNER + 1`.
  - Item sheets hide GM writing buttons when not editable (`context.isGM = game.user.isGM && this.isEditable`).
  - Sheets re-render on chat message create/update/delete with a request flag.

## Glossário do mundo (1.85.0)

The owner approved the Design artifact "Glossário do Mundo" (boards 1–4); build to it. It is a read-only window for players and GM, always on (no feature toggle: it is just a button).

- **Pure part: `glossary/glossary-rules.js`** (tested in `test/glossary.test.mjs`).
  - `SYSTEM_TERMS` is `[key, group, term, text, feature, see]`. `{E}` is filled with the energy label and `{attr:key}` with the attribute's current label.
  - `buildGlossary(world, {isGM})` builds every visible entry. It covers system terms (hidden when their feature is off), attributes (purpose line), Conditions, Elements, Species, Heritages, Traits and the GM's own terms.
  - Each entry keeps a **fixed key** (`energy`, `attr:magic`, `condition:burn`, `custom:eter`…) and shows the **current** name. That is how renames are handled: nothing is stored by name, and the window recomputes on every open.
  - `linkSegments(text, entries, selfKey)` turns mentions of other terms into links. It links the first mention only; the plural counts on every word of a compound name ("Habilidades Ativas" → "Habilidade Ativa"); the longest name wins; it never links mid-word; a capitalised name only matches a capitalised mention ("uma magia" is not the attribute Magia); a GM term beats a system term of the same name. Matching is by the current name, so a free text saying "Mana" in a world whose energy is renamed does not link.
  - `searchGlossary` ignores accents, case and plural, and also drops the last vowel, so "cego" finds "Cegueira". Name matches come first, then body matches with a snippet.
  - `glossaryCounts` / `filterGlossary` back the GM filters. `elementSentence` / `traitSentence` / `originSentence` build "O sistema faz".
- **Foundry part: `glossary/glossary.js`.**
  - `gatherGlossaryWorld({asPlayerPreview})` reads the catalogs.
  - **Where each text lives** (board 4 B):
    - A catalog item's explanation lives **in the catalog**, as `explanation` on Conditions (shown as "Na mesa"; field also in the Condition card editor), Elements and Traits.
    - Species and Heritages use their own `description`; "Editar a descrição no catálogo" opens their editor on that entry.
    - GM terms and rewritten system texts live in the world setting `glossaryData` (`{custom, overrides: {key: {text, gmOnly}}}`). It ends in `Data`, so Exportar/Importar Configurações carries it in Catálogos.
  - **"Falta explicar"** flags only catalog items the GM created (id not in the factory lists) without text. Factory items show only "O sistema faz".
  - **Player visibility:** `gmOnly` (any entry). A Species with `availableAtCreation: false` and every Heritage show only when one of the player's characters has it. "Ver como jogador" uses all players' characters.
  - Factory Conditions without an automatic effect ship with an `explanation`, and `getActiveStatusConditions` fills it into saved catalogs only when the field is absent. An explanation the GM cleared on purpose stays cleared.
- **Window: `apps/glossary.js`** (`GlossaryApp`, id `nihility-glossary`, single instance, `GlossaryApp.open(key)`).
  - Search re-renders with a debounce and keeps the caret. Links are `gl-link` buttons (`openTerm`). There are Voltar and "Veja também".
  - The GM gets filters, "+ Termo da mesa", Editar/Reescrever, "Voltar ao padrão", Apagar (custom) and "Ver como jogador".
  - It re-renders on any system `updateSetting`.
- **Entry points:**
  - "Glossário" in Menu › Fichas, for everyone;
  - Configurações Gerais › Personagem › Glossário;
  - `game.nihility.glossary(key)`;
  - the `<a class="nihility-open-glossary">` on the first page of Regras desta mesa, caught by a document click listener (`registerGlossaryLinks`) because journal pages run no script.
- The Regras desta mesa Conditions page now also shows "Na mesa".
