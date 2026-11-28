# Placas, Reserva e programas (Lote 9)

> Part of the project guide. The index and the rules that apply everywhere are in the root `CLAUDE.md`. Everything user-facing is pt-BR.

Status: **logic foundation only (1.125.0)**. There is no sheet section, drag-and-drop or Inventory panel yet: that is phase 2, after the owner approves the screens (canvas "Invasão", boards 7-10). Feature toggle: `devices` ("Placas e programas", group Combate, off by default, on in the Sci-Fi and Misto presets). Off hides/ignores the new behavior and blocks new content; saved data is never touched.

## Files

- `economy/device-rules.js` (pure, tested in `test/devices.test.mjs`): `defaultDevice`, `normalizeDevice`, `reserveState`, `programCost`, `payProgramCost`, `restRecharge`, `cellRecharge`, `actionRecharge`, `programFits`, `slotsFree`, `deviceWorks`/`deviceBlockReason`, `empDrainPercent`/`empReserveDrain`, `rollShortCircuit`/`shortCircuitHit`/`normalizeShortBands`, `disasterDamageFormula`, `offExpired`, `isEnergyCell`, `deviceSourceKey`/`parseDeviceSourceKey`, `canRepairDevice`, `deviceProgramIssues` (Validar Mundo).
- `economy/device-state.js` (light read side, imported by `character-model.js` and `conditional-context.js`): `deviceOf`, `actorDevices`, `liveDevice` (an expired "off" reads as normal), `deviceWorksNow`, `deviceBlockedReason`, `workingPrograms`.
- `economy/devices.js` (Foundry side): `installProgram`/`uninstallProgram`, `removeDeviceGrants`, `planDevicePayment`/`commitDevicePayment`, `rechargeOnRest`/`rechargeWithCell`/`rechargeByAction`, `shortCircuit`/`undoShortCircuit`/`renderDeviceShortControls`, `empHitDevices`, `repairDevice`/`requestDeviceRepair`/`actorCanRepair`, `RELAY_HANDLERS.deviceRepair`, `registerDevices()` (called in `init`).

## Data model (Item Geral, `system.*`)

- `device`: `enabled`, `nature` (`tech` | `technomagic`), `slots` (int >= 0, default 2), `reserveMax` (50), `reserve` (50), `accepts` (`any` | `invasion` | `weapon`), `rechargeRest` (true), `rechargeCell` (true), `rechargeAction` (false), `actionAmount` (10), `infinite` (false), `state` (`normal` | `off` | `damaged`), `offMode` (`combat` | `time`), `offCombatId`, `offSince` (world seconds), `offRounds` (3), `programs: [{uid, sourceItem}]`.
- `program`: `enabled`, `slotsUsed` (>= 1), `costPerUse` (0 = use the granted Skill's Cost; > 0 replaces it), `fits` (`any` | `weapon`), `invasion: {enabled, minigame: "sequence", target: "tech", prepRounds}` (stored only; the Invasão lot uses it).
- `consumable.energyCell` (boolean): marks the "Célula de energia".
- Skill `engineering` (boolean, "Engenharia"): configuration, not state, so it is in every copy list (`GRANTED_MECHANIC_FIELDS`, `evolveSkill`, `REQUEST_MECHANIC_FIELDS`, `sanitizeSkillMechanics`) and has a checkbox in `item-skill-general.hbs`.

## Rules (dono, 27/11)

- **Nature:** a placa is always tech (`itemIsTech` returns true when `device.enabled`, even with the tech box unchecked); `technomagic` is also magic (`itemIsMagic`, used by `itemNature` and `sourceSuppressed`), so Antimagia reaches it too. A placa is suppressed by PEM like any tech Item.
- **Install/uninstall is free** (anyone who can edit the actor). The program Item is stored whole in `device.programs`; one unit leaves the inventory; the granted Skill gets `grantedBySource = device:<host item id>:<uid>`. Uninstall returns the Item and removes the Skill; the Skill's level and XP travel in the returned Item's flag `deviceSkillProgress` and are restored on reinstall (implants do not do this; the placa does). Always rewrite the whole `programs` array. `programFits` refuses when slots are full or `accepts`/`fits` do not match (`fits: "weapon"` needs `weapon.enabled` on the host).
- **Passive bonuses** (`attributeBonuses`, `statModifiers`, "Quando → Então") of an installed program count only while the host is **equipped** and `deviceWorksNow` (state normal, not off/damaged, not suppressed). Not wired: `regen` of a program.
- **Paying (the hook):** `skill-effects.js` step `payDeviceReserve`, between `resolveCostAndInvestment` and `startPreparationIfNeeded`. For a Skill whose `grantedBySource` starts with `device:` it plans the payment (`planDevicePayment`): placa not working gives a warning and nothing is spent; Reserva covers it, so Reserva goes down and Mana 0; short on a tech placa is "sem Reserva" and blocked; short on a technomagic placa spends what is left and the **difference** is paid in energy through the normal path (`ctx.paid` becomes that difference; if the energy is short too, nothing is written); infinite is free. The plan is only **written** later (`commitDeviceIfPlanned`, inside `payUseCost` or after the Preparo first-part check), so a use stopped by a later step (Reverter shortfall, Mana short for the Preparo) spends no Reserva. Desfazer uso refunds the Reserva because `system.device.reserve` is in `UNDO_ITEM_PATHS`. Not wired yet (phase 2): the per-round upkeep of an Active program Skill still drains energy, and a placa that lives inside an implant already installed on a Body Part (`mod.sourceItem`) is not read as a host — the cyberdeck-in-the-head case of board 1 needs it.
- **Recharge:** `rechargeOnRest` runs inside `applyRest` (both short and full rest). `rechargeWithCell` consumes one Item whose `consumable.energyCell` is true (`consumeUse`) and fills the Reserva. `rechargeByAction` adds `actionAmount`, only outside a started combat the actor is in.
- **PEM:** `applyDispel(kind "tech")` on a character calls `empHitDevices` (step 6): each **equipped** placa loses Reserva by the ship formula (`empDrainPercent`: 5% x reach, 5-75%, shared with `applyEmpToShip`, of the placa's maximum; infinite is not drained) and rolls `curtoChanceOnEmp` (default 25%) for a short circuit.
- **Curto:** options `shortLeveMax` (60) and `shortGraveMax` (95): leve gives `off`, grave gives `damaged`, above is desastre = `damaged` + Elétrico (`lightning`) damage to the wearer `round(2d6 * reserveMax / 6)` **only if the host Item has `implant.enabled`** (card with the usual Aplicar). `off` ends with the end of the combat it started in (`offMode: "combat"`, read through `liveDevice`, cleaned on `deleteCombat`), or 3 rounds of world time outside combat (`offMode: "time"`, `CONFIG.time.roundTime` or 6 s per round, cleaned on `updateWorldTime`). The chat card carries flag `deviceShort`; the GM sees "Desfazer".
- **Repair:** `repairDevice` (GM direct) sets `normal`. Players go through relay `deviceRepair` (`requestDeviceRepair(engineer, target, hostItemId)`): the GM side rebuilds everything from the sheets, requires an `engineering` Skill on the engineer, and asks the GM for approval (DialogV2 confirm) when the placa belongs to someone else the requester does not own.

## Decisions the spec did not cover

- A technomagic placa short on Reserva spends the remainder and pays only the difference in Mana (not the whole Cost).
- The default placa is 2 slots and 50 Reserva.
- Host placas are **actor Items**. An implant installed in a body part leaves the inventory (it lives in `mod.sourceItem`), so a placa on an installed implant is not read yet: phase 2 must decide how to map it.
- Only equipped placas count for bonuses, PEM and the `off` rules; a placa in the backpack is inert.

## Still to do (phase 2)

Sheet section (Placas card, slots, Reserva bar, "Recarregar", "Consertar…"), drag a program onto a placa, Item sheet editor for `device`/`program`, Inventory panel, program `regen`, Active program upkeep from the Reserva, placas inside installed implants, Invasão lot (uses `program.invasion`).
