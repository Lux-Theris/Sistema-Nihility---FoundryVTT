/**
 * Avisos no editor de Skill (backlog L8; canvas "Editor de Skill Assistido", prancha 1): o
 * Validar Mundo para UMA Skill, na hora. Puro e testado (test/skill-assist.test.mjs) — os
 * catálogos e o "é uma fórmula válida?" chegam em `ctx`.
 *
 * Nunca impede de salvar: cada aviso diz o que provavelmente não era a intenção.
 * `level`: "hard" (não faz nada / não se aplica) ou "soft" (confira).
 * `tab`: "general" | "mechanic" — onde o campo mora na ficha. `effect`: índice do card, ou null.
 */
import { NIHILITY } from "../core/config/constants.js";
import { complexityVerdict } from "./skill-complexity-rules.js";
import { combinedIssues } from "./combined-rules.js";
import { rerollLint } from "./reroll-rules.js";
import { mechAreaSize } from "../combat/area-size-rules.js";
import { drainLint } from "./drain-rules.js";
import { strikesLint } from "./strikes-rules.js";

/** Alvos em que "Periódico" funciona (o mesmo do editor). */
export const PERIODIC_TARGETS = ["hp", "energy", "shipCasco", "shipHull"];

/** Alvos que agem na hora e não ficam "para sempre" sem duração. */
const INSTANT_TARGETS = ["heal", "restoreEnergy", "shield", "antimagic", "emp", "mark", "dispelMagic", "purify", "revive", "push", "space", "shipShieldRestore", "shipCasco", "shipHull", "shipDamageReduction"];

/** Alvos em que o valor não importa (liga/desliga, troca de elemento, Antimagia pelo nível). */
const VALUELESS_TARGETS = ["weaponElement", "bodyElement", "weaponMagic", "weaponAbsolute", "unarmedType", "antimagic", "emp", "mark", "dispelMagic", "purify", "magicDampen", "luck", "timeRate", "space", "flight", "burrow", "createSurface", "senseTremor", "senseInvisible", "senseTrue", "senseAll"];

const groupTargets = actor => new Set(NIHILITY.EFFECT_TARGET_GROUPS.filter(g => g.actor === actor).flatMap(g => g.targets));

/**
 * @param {object} mech - a Skill (ou Sub-Skill) no formato do schema
 * @param {object} [ctx]
 * @param {Set<string>|string[]} [ctx.conditions] - ids do catálogo de Condições
 * @param {Set<string>|string[]} [ctx.elements] - ids dos Tipos de Dano
 * @param {Set<string>|string[]} [ctx.traits] - ids do catálogo de Traços (para o "Só se…")
 * @param {Set<string>|string[]} [ctx.weaponTypes] - ids do catálogo de Tipos de arma
 * @param {Set<string>|string[]} [ctx.structures] - ids do catálogo de Estruturas
 * @param {"character"|"ship"|null} [ctx.actorType] - quem tem a Skill (null = sem ficha)
 * @param {number|null} [ctx.energyMax] - Mana/Bateria máxima de quem tem a Skill
 * @param {(formula: string) => boolean} [ctx.validFormula]
 * @param {string} [ctx.energyLabel]
 * @param {{extra?:number, normal?:number, unique?:number}} [ctx.complexityCaps] - tetos de complexidade por Tier (sem ele, sem aviso)
 * @param {(uuid: string) => boolean} [ctx.formTemplateOk] - o molde da forma existe e está marcado
 * @returns {Array<{code: string, level: "hard"|"soft", tab: string, effect: number|null, text: string}>}
 */
export function lintSkill(mech, ctx = {}) {
  const out = [];
  const m = mech ?? {};
  const has = (list, id) => (list instanceof Set ? list.has(id) : Array.isArray(list) ? list.includes(id) : true);
  const energy = ctx.energyLabel || "Mana";
  const push = (code, level, tab, text, effect = null) => out.push({ code, level, tab, effect, text });
  const effects = Array.isArray(m.effects) ? m.effects : [];
  const effectType = m.effectType ?? "none";
  const structure = effectType === "structure" || m.targetType === "structure";
  const usesTarget = effectType === "damage" || effectType === "temporary";
  const isArea = usesTarget && (m.targetType === "emission" || m.targetType === "zone");
  const active = Boolean(m.hasUpkeep);

  // --- Custo e ativação (aba Geral)
  if (!active && Number(m.upkeepCost) > 0) push("upkeepNotActive", "hard", "general", `Custo por rodada (${m.upkeepCost}) só vale em Habilidade Ativa: esta não é, então ele nunca é cobrado.`);
  // Recarga e Preparo (H3): negativo não faz sentido; Preparo numa Ativa vale conferir.
  if (Number(m.cooldown) < 0) push("cooldownNegative", "hard", "general", "Recarga negativa: vale como zero (sem recarga).");
  if (Number(m.prepTurns) < 0) push("prepNegative", "hard", "general", "Preparo negativo: vale como zero (pronta na hora).");
  if (active && Number(m.prepTurns) > 0) push("prepActive", "soft", "general", `Habilidade Ativa com Preparo de ${m.prepTurns} rodada(s): só liga depois de pronta, e o Custo por rodada começa então. Confira se é isso mesmo.`);
  if (active && !(Number(m.upkeepCost) > 0)) push("activeFree", "soft", "general", "Habilidade Ativa sem Custo por rodada: fica ligada de graça para sempre.");
  if (ctx.energyMax != null && Number(m.cost) > 0 && Number(m.cost) > Number(ctx.energyMax)) {
    push("costOverPool", "hard", "general", `Custa ${m.cost} e quem tem a Skill só tem ${ctx.energyMax} de ${energy} máxima: nunca dá para usar.`);
  }

  // --- "Só se…" da Skill inteira e "ao acertar" (8c.1): a Condição ou o Traço escolhido sumiu → a Skill nunca sai / nunca pega.
  const skillOnly = m.onlyIf;
  if (skillOnly?.kind === "otherCondition" || skillOnly?.kind === "otherConditionMine" || skillOnly?.kind === "selfCondition") {
    if (!skillOnly.value) push("skillOnlyIfEmpty", "hard", "general", `"Só se…" da Skill sem Condição escolhida — ela nunca pode ser usada.`);
    else if (ctx.conditions && !has(ctx.conditions, skillOnly.value)) push("skillOnlyIfUnknown", "hard", "general", `O "Só se…" da Skill usa a Condição "${skillOnly.value}", que não existe mais no catálogo — ela nunca pode ser usada.`);
  }
  if (skillOnly?.kind === "otherTrait") {
    if (!skillOnly.value) push("skillOnlyIfEmpty", "hard", "general", `"Só se…" da Skill sem Traço escolhido — ela nunca pode ser usada.`);
    else if (ctx.traits && !has(ctx.traits, skillOnly.value)) push("skillOnlyIfUnknown", "hard", "general", `O "Só se…" da Skill usa o Traço "${skillOnly.value}", que não existe mais no catálogo — ela nunca pode ser usada.`);
  }
  if (m.onHit?.conditionId) {
    if (ctx.conditions && !has(ctx.conditions, m.onHit.conditionId)) push("onHitUnknown", "hard", "general", `"Ao acertar" usa a Condição "${m.onHit.conditionId}", que não existe mais no catálogo — não põe nada.`);
    if ((m.onHit.when === "on" || m.onHit.when === "off") && !active) push("onHitWhenNotActive", "soft", "general", `"Ao acertar" só ligada/só desligada numa Skill que não é Ativa: o estado não conta, ela vale sempre.`);
  }
  // Complexidade por Tier (8c.1): só avisa.
  if (ctx.complexityCaps && m.tier) {
    const verdict = complexityVerdict(m, m.tier, ctx.complexityCaps);
    if (verdict.over) push("complexity", "soft", "general", `Complexa demais para ${NIHILITY.SKILL_TIER_LABELS[m.tier] ?? m.tier}: ${verdict.score} de ${verdict.cap}. Dá para salvar assim; o Mestre decide.`);
  }

  // --- Alcance (H4): só avisos "confira"; nada trava.
  if (ctx.skillRange !== false) {
    if (Number(m.range) > 0 && m.targetType === "self") push("rangeSelf", "soft", "mechanic", `Alcance de ${m.range} m numa Skill "Si mesmo": o alcance não faz diferença, ela sempre cai em quem usa.`);
    if (usesTarget && isArea && m.areaOrigin === "caster" && Number(m.range) > 0) push("rangeCasterOrigin", "soft", "mechanic", `Alcance de ${m.range} m com a forma presa em quem lança: o alcance só vale pela Marca (a forma sai do Token de quem lança, ou do Marcado).`);
  }

  // --- Maestria de arma (H6): uma Maestria é passiva; mecânica de uso numa Maestria nunca roda.
  if (m.weaponMastery) {
    if (usesTarget || structure || active || Number(m.cost) > 0) push("masteryMechanic", "soft", "general", "Maestria de arma é passiva: dano, efeitos, Custo e ativação desta Skill nunca são usados (ela só dá o bônus de dano com as armas do tipo). Era isso?");
    if (ctx.weaponTypes && !has(ctx.weaponTypes, m.weaponMastery)) push("unknownWeaponType", "hard", "general", `Maestria de um tipo de arma ("${m.weaponMastery}") que não existe mais no catálogo: não vale para nenhuma arma.`);
  }

  // Golpe de arma (H6): só vale numa Skill de dano.
  if (m.weaponStrike && effectType !== "damage") push("strikeNotDamage", "soft", "mechanic", "Golpe de arma numa Skill que não é de dano: o tipo de arma só vale quando a Skill causa dano. Era isso?");

  // Combinada (8c.2) e o duelo: sem Sub-Skills não faz nada; "desliga se o alvo cair" e a regra de intruso só valem ligada.
  for (const issue of combinedIssues(m)) push(issue.code, issue.level, "mechanic", issue.text);
  if (!active && (m.endsWhenTargetFalls || m.intruderRule)) push("duelNotActive", "soft", "mechanic", "\"Desliga se o alvo cair\" e a regra de quem entra na Estrutura só valem numa Habilidade Ativa: esta não é, então nada disso acontece.");
  effects.forEach((e, i) => {
    if (e?.target === "luck") {
      if (!Object.values(e.luckScopes ?? {}).some(Boolean)) push("luckNoScope", "hard", "mechanic", "Sorte sem nenhum escopo marcado (atributos, dano, chances): não faz nada.", i);
      else if (!(Number(e.amount) || 0)) push("luckZero", "hard", "mechanic", "Sorte de 0%: não faz nada.", i);
    }
    if (e?.target === "timeRate") {
      const factor = Number(e.timeFactor ?? 2);
      const areaLike = ["emission", "zone"].includes(m.targetType);
      if (e.timeRewind) {
        if (active) push("timeRewindActive", "hard", "mechanic", "Reverter numa Skill Ativa: reverter age uma vez, na hora; a Skill ligada não repetiria nada. Use uma Skill de uso comum.", i);
        else if (!(Number(e.durationRounds) > 0)) push("timeRewindNoRounds", "hard", "mechanic", "Reverter sem rodadas: ponha quantas rodadas voltam (o teto é das Regras desta mesa).", i);
        if (m.targetType === "emission") push("timeRewindArea", "soft", "mechanic", "Reverter em área desfaz todo mundo que estiver dentro, cada um pelo próprio histórico; vínculos (Nomeação, Pacto) custam energia a mais por cada um. Era isso?", i);
        if (m.targetType === "zone") push("timeRewindZone", "hard", "mechanic", "Reverter numa Zona: a Zona repetiria a reversão todo turno. Use uma Emissão (área na hora) ou um alvo.", i);
      } else if (e.timeStop && areaLike && !["notCaster", "enemies", "othersExceptTarget"].includes(m.areaAffects ?? "all")) {
        push("timeStopArea", "soft", "mechanic", "Parar o tempo em área que inclui quem lança: quem lança também ficaria Parado. Escolha \"Todos menos quem lança\" em \"Quem a área atinge\".", i);
      } else if (m.targetType === "zone") {
        push("timeZoneNote", "soft", "mechanic", "Ritmo/Parar numa Zona (câmara temporária): vale para quem começa o turno dentro, por 1 rodada renovada a cada turno, e só em combate; fora dele use uma Região de ritmo (câmara do tempo). Era isso?", i);
      }
      if (e.timeRewind) {
        // Reverter não tem fator nem "para sempre": o resto dos avisos de tempo não se aplica.
      } else if (!e.timeStop && !(Math.abs(factor - 1) > 1e-6)) push("timeRateOne", "hard", "mechanic", "Ritmo do tempo com fator 1: não muda nada.", i);
      else if (e.timeStop && !active && !(Number(e.durationRounds) > 0)) push("timeStopForever", "hard", "mechanic", "Parar o tempo sem duração numa Skill que não é Ativa: o alvo ficaria Parado para sempre. Ponha as rodadas (de quem lança) ou faça a Skill Ativa.", i);
      else if (!e.timeStop && !active && !(Number(e.durationRounds) > 0)) push("timeRateForever", "soft", "mechanic", "Ritmo do tempo sem duração numa Skill que não é Ativa: fica no alvo para sempre (até alguém tirar). Era isso?", i);
      if (m.targetType === "self" && ctx.actorType === "ship") push("timeRateShip", "hard", "mechanic", "Ritmo do tempo numa Nave: o tempo é de quem vive, o efeito não se aplica.", i);
    }
    if (e?.target === "space") {
      const mode = e.spaceMode ?? "jump";
      if (!["jump", "swap", "portal", "pocket", "domain"].includes(mode)) push("spaceModeLater", "hard", "mechanic", "Este modo de Espaço não existe: o uso é recusado.", i);
      if (["emission", "zone"].includes(m.targetType) && mode !== "pocket") push("spaceArea", "hard", "mechanic", "Espaço (Saltar, Trocar, Portal, Domínio) vale para si mesmo ou um alvo, não para área nem Zona.", i);
      if (mode === "swap" && m.targetType === "self") push("spaceSwapSelf", "hard", "mechanic", "Trocar numa Skill \"Si mesmo\": falta o alvo para trocar de lugar. Use \"Alvo único\".", i);
      if (["jump", "swap", "portal"].includes(mode) && !(Number(m.range) > 0) && ctx.skillRange !== false) push("spaceNoRange", "soft", "mechanic", mode === "swap" ? "Trocar sem alcance: troca com qualquer Token do mapa. Ponha o alcance da Skill (ficha, Avançado)." : mode === "portal" ? "Portal sem alcance: as pontas abrem em qualquer ponto do mapa. Ponha o alcance da Skill (ficha, Avançado)." : "Saltar sem alcance: salta para qualquer ponto do mapa. Ponha o alcance da Skill (ficha, Avançado).", i);
      if (active && ["jump", "swap"].includes(mode)) push("spaceActive", "soft", "mechanic", "Espaço numa Habilidade Ativa: o teleporte acontece só ao ligar (desligar não repete).", i);
      if (ctx.actorType === "ship") push("spaceShip", "hard", "mechanic", "Espaço numa Nave: Nave e Veículo não são teleportados (o salto FTL é do Módulo).", i);
      // Portal e Domínio (8f, lotes 3 e 5): precisam de prazo; Bolso, de nível e de espaços.
      if (["portal", "domain"].includes(mode) && !active && !(Number(e.durationRounds) > 0)) push("spaceNoDuration", "soft", "mechanic", `${mode === "portal" ? "Portal" : "Domínio"} sem duração numa Skill que não é Ativa: fica aberto até o Mestre fechar. Ponha as rodadas ou faça a Skill Ativa.`, i);
      if (mode === "portal" && e.spaceOtherScene && m.targetType !== "self") push("spaceOtherSceneTarget", "soft", "mechanic", "Portal para outra cena: a Skill não precisa de alvo, use \"Si mesmo\".", i);
      if (mode === "domain" && !(Number(e.spaceRadius) > 0)) push("spaceNoRadius", "soft", "mechanic", "Domínio sem raio: vale o padrão de 10 m. Ponha o raio no efeito.", i);
      if (mode === "domain" && Number(e.spaceTimeRate ?? 1) !== 1 && ctx.timeEnabled === false) push("spaceTimeOff", "soft", "mechanic", "Ritmo próprio do Domínio com o bloco de Manipulação do tempo desligado: o Domínio prende, mas o tempo lá dentro não muda.", i);
      if (mode === "pocket" && !(Number(m.level) >= 1)) push("spacePocketNoLevel", "hard", "mechanic", "Bolso sem nível: os espaços crescem pelo nível da Skill.", i);
      if (mode === "pocket" && Number(e.pocketBase ?? 5) <= 0 && Number(e.pocketPerLevel ?? 5) <= 0) push("spacePocketEmpty", "hard", "mechanic", "Bolso sem espaços: ponha espaços no nível 1 ou por nível.", i);
    }
    if (e?.target === "magicDampen" && Number(e.chance ?? 100) <= 0) push("magicDampenNever", "hard", "mechanic", "Magia enfraquecida com chance 0%: nunca pega.", i);
  });

  // --- Golpes N e a corrente (1.123.0)
  if (usesTarget) for (const w of strikesLint(m)) push(w.code, w.level, "mechanic", w.text);

  // --- Mecânica
  if (usesTarget && isArea && !(mechAreaSize(m) > 0)) push("areaZero", "hard", "mechanic", `${m.targetType === "zone" ? "Zona" : "Área"} com distância 0: ninguém fica dentro.`);
  if (usesTarget && m.targetType === "zone" && !active && !(Number(m.zoneRounds) > 0)) push("zoneRounds", "hard", "mechanic", "Zona sem rodadas: some antes de bater em alguém.");

  if (effectType === "damage") {
    const formula = String(m.damageFormula ?? "").trim();
    if (!formula) push("noFormula", "hard", "mechanic", "Mecânica Dano sem Fórmula de Dano: usar não rola nada.");
    else if (ctx.validFormula && !ctx.validFormula(formula)) push("badFormula", "hard", "mechanic", `Fórmula "${formula}" não é uma rolagem válida: o uso vai falhar.`);
    if (m.isAbsoluteDamage && m.isMagicDamage) push("absoluteMagic", "soft", "mechanic", "Dano Absoluto com Dano Mágico: o Absoluto já ignora a Defesa Mágica, então o Mágico não muda nada (só a Antimagia).");
    for (const id of m.damageElements ?? []) {
      if (ctx.elements && !has(ctx.elements, id)) push("unknownElement", "hard", "mechanic", `Elemento "${id}" não existe mais no catálogo de Tipos de Dano.`);
    }
  }

  if (structure) {
    if (!m.structureId) push("noStructure", "hard", "mechanic", "Mecânica Estrutura sem Estrutura escolhida: usar não ergue nada.");
    else if (ctx.structures && !has(ctx.structures, m.structureId)) push("unknownStructure", "hard", "mechanic", `Estrutura "${m.structureId}" não existe mais no catálogo.`);
    if ((Number(m.structureRegen) > 0 || Number(m.structureRegenCost) > 0) && !active) push("structureRegenNotActive", "hard", "mechanic", "Regeneração da Estrutura só vale em Habilidade Ativa.");
    // "Segue quem lançou" (1.118.0): uma aura que anda sem Habilidade Ativa não tem manutenção — fica até acabar o prazo ou cair.
    if (m.structureFollows && !active) push("structureFollowsNotActive", "soft", "mechanic", "\"Segue quem lançou\" sem Habilidade Ativa: a aura anda com quem a ergueu mas ninguém a mantém. Costuma ser uma Skill Ativa, com manutenção por rodada.");
  }

  // Análise e Predação (7b): uso na hora, sempre num alvo único.
  // Zona que escurece o mapa (1.120.0): sem as luzes do Foundry ou sem Zona, o campo não faz nada.
  if (m.zoneDarkens && m.targetType !== "zone") push("zoneDarkensNoZone", "soft", "mechanic", "\"Escurece o mapa\" só vale numa Zona: o Tipo de Alvo não é Zona e o campo não faz nada.");
  // Predação "Só formas": não rola Skills; a Skill guarda as formas (Sub-Skills de Forma Ativas).
  if (effectType === "predation" && m.predationTakes === "forms" && m.hasUpkeep) push("predationFormsActive", "hard", "mechanic", "Predação \"Só formas\" é de uso na hora: as formas guardadas são as Sub-Skills Ativas, a Skill em si não pode ser Ativa.");

  if (effectType === "analysis" || effectType === "predation") {
    const name = effectType === "analysis" ? "Análise" : "Predação";
    if (active) push("analysisPredationActive", "hard", "mechanic", `Mecânica ${name} é de uso na hora: numa Habilidade Ativa ela liga e desliga em vez de agir.`);
    if (m.targetType && m.targetType !== "targeted") push("analysisPredationTarget", "soft", "mechanic", `Mecânica ${name} sempre pede um alvo único: o Tipo de Alvo "${m.targetType}" é ignorado.`);
  }

  // Rerrolar (8d.2): usada no chat, sem alvo; avisos do próprio módulo de regras.
  if (effectType === "reroll") for (const w of rerollLint(m)) out.push(w);

  if (effectType === "form") {
    if (!active) push("formNotActive", "hard", "mechanic", "Mecânica Forma só vale em Habilidade Ativa: sem manutenção a forma nunca desliga e a Skill não liga.");
    if (!m.formActorUuid) push("noFormActor", "hard", "mechanic", "Mecânica Forma sem ficha da forma: arraste a ficha-molde para o campo.");
    else if (typeof ctx.formTemplateOk === "function" && !ctx.formTemplateOk(m.formActorUuid)) push("missingFormTemplate", "hard", "mechanic", "A ficha da forma sumiu ou não está marcada como molde de forma.");
  }

  if (effectType === "temporary") {
    if (!effects.length) push("noEffects", "hard", "mechanic", "Mecânica Efeito sem nenhum Efeito: usar não faz nada.");
    const shipOnly = groupTargets("ship");
    const characterOnly = groupTargets("character");
    effects.forEach((e, i) => {
      const n = `Efeito ${i + 1}`;
      const target = e?.target ?? "";
      if (e?.periodic && !PERIODIC_TARGETS.includes(target)) push("periodicTarget", "hard", "mechanic", `${n}: Periódico só funciona em Vida ou ${energy} (ou Casco/Integridade de Nave). Este vira um efeito comum.`, i);
      if ((Number(e?.shieldRegen) > 0 || Number(e?.shieldCap) > 0) && target === "shield" && !active) push("sustainedNotActive", "hard", "mechanic", `${n}: Escudo mantido (regeneração/teto) só vale em Habilidade Ativa.`, i);
      // Empurrar/Puxar (J1): os metros são o efeito; sem eles nada se move.
      if (target === "push" && !(Number(e?.amount) > 0)) push("pushZero", "hard", "mechanic", `${n}: Empurrar/Puxar com 0 metros — não move ninguém.`, i);
      if (target === "push" && Number(e?.amount) > 0 && m.targetType === "self") push("pushSelf", "soft", "mechanic", `${n}: Empurrar/Puxar numa Skill "Si mesmo" — quem usa é a origem, então ninguém se move.`, i);
      if (!Number(e?.amount) && !e?.conditionId && !VALUELESS_TARGETS.includes(target) && target !== "push") push("zeroEffect", "hard", "mechanic", `${n}: valor 0 e sem Condição — não muda nada.`, i);
      // Peças de magia (1.123.0).
      for (const w of drainLint(e)) push(w.code, w.level, "mechanic", `${n}: ${w.text}`, i);
      if (target === "reflect" && Number(e?.amount) > 100) push("reflectOver", "soft", "mechanic", `${n}: Refletir acima de 100% vale 100%.`, i);
      if (target === "revive" && ["emission", "zone"].includes(m.targetType)) push("reviveArea", "hard", "mechanic", `${n}: Reviver numa área nunca alcança o morto (área nunca atinge os mortos): use "Alvo único".`, i);
      if (target === "revive" && m.targetType === "self") push("reviveSelf", "soft", "mechanic", `${n}: Reviver em "Si mesmo": quem está morto não usa Skill.`, i);
      if (target === "scry" && m.targetType === "self") push("scrySelf", "hard", "mechanic", `${n}: Ver pela Marca precisa de um alvo (o Marcado): use "Alvo único".`, i);
      if (target === "scry" && ["emission", "zone"].includes(m.targetType)) push("scryArea", "hard", "mechanic", `${n}: Ver pela Marca vale para um alvo, não para área.`, i);
      if (target === "scry" && !active && !(Number(e?.durationRounds) > 0)) push("scryForever", "soft", "mechanic", `${n}: Ver pela Marca sem duração numa Skill que não é Ativa: a visão fica aberta até a Marca sumir. Era isso?`, i);
      if (target === "purify" && e?.conditionId && ctx.conditions && !has(ctx.conditions, e.conditionId)) push("purifyUnknown", "hard", "mechanic", `${n}: a Condição "${e.conditionId}" que Purificar tiraria não existe mais no catálogo.`, i);
      if (target === "dispelMagic" && e?.dispelScope === "condition" && !e?.conditionId) push("dispelNoCondition", "hard", "mechanic", `${n}: Dissipar "só uma Condição" sem Condição escolhida: não desfaz nada.`, i);
      if (e?.conditionId && ctx.conditions && !has(ctx.conditions, e.conditionId)) push("unknownCondition", "hard", "mechanic", `${n}: a Condição "${e.conditionId}" não existe mais no catálogo.`, i);
      for (const id of e?.damageElements ?? []) {
        if (ctx.elements && !has(ctx.elements, id)) push("unknownElement", "hard", "mechanic", `${n}: elemento "${id}" não existe mais no catálogo.`, i);
      }
      // "Só se…" (8.1a): a Condição ou o Traço escolhido sumiu do catálogo → o efeito nunca pega.
      const only = e?.onlyIf;
      if (only?.kind === "otherCondition" || only?.kind === "otherConditionMine" || only?.kind === "selfCondition") {
        if (!only.value) push("onlyIfEmpty", "hard", "mechanic", `${n}: "Só se…" sem Condição escolhida — o efeito nunca pega.`, i);
        else if (ctx.conditions && !has(ctx.conditions, only.value)) push("onlyIfUnknown", "hard", "mechanic", `${n}: o "Só se…" usa a Condição "${only.value}", que não existe mais no catálogo — o efeito nunca pega.`, i);
      }
      if (only?.kind === "otherTrait") {
        if (!only.value) push("onlyIfEmpty", "hard", "mechanic", `${n}: "Só se…" sem Traço escolhido — o efeito nunca pega.`, i);
        else if (ctx.traits && !has(ctx.traits, only.value)) push("onlyIfUnknown", "hard", "mechanic", `${n}: o "Só se…" usa o Traço "${only.value}", que não existe mais no catálogo — o efeito nunca pega.`, i);
      }
      if (target === "unarmedType" && !e?.weaponTypeId) push("unarmedTypeMissing", "hard", "mechanic", `${n}: "Desarmado vira tipo" sem escolher o tipo — não faz nada.`, i);
      if (target === "unarmedType" && e?.weaponTypeId && ctx.weaponTypes && !has(ctx.weaponTypes, e.weaponTypeId)) push("unknownWeaponType", "hard", "mechanic", `${n}: o tipo de arma "${e.weaponTypeId}" não existe mais no catálogo.`, i);
      // Cria superfície (8.2): o elemento tem de deixar algo no chão e o raio (o dele ou o do efeito) não pode ser 0.
      if (target === "createSurface") {
        if (!e?.elementId) push("surfaceNoElement", "hard", "mechanic", `${n}: "Cria superfície" sem elemento escolhido — não cria nada.`, i);
        else if (ctx.elements && !has(ctx.elements, e.elementId)) push("unknownElement", "hard", "mechanic", `${n}: elemento "${e.elementId}" não existe mais no catálogo.`, i);
        else if (ctx.surfaces) {
          const def = ctx.surfaces[e.elementId];
          if (!def?.enabled) push("surfaceNotLeft", "hard", "mechanic", `${n}: esse elemento não deixa nada no chão — ligue "Deixa no chão" no cartão dele (Tipos de Dano).`, i);
          else if (!(Number(e?.amount) > 0) && !(Number(def.radius) > 0)) push("surfaceRadiusZero", "hard", "mechanic", `${n}: raio 0 — a superfície não tem tamanho.`, i);
        }
      }
      if (["weaponElement", "bodyElement"].includes(target) && e?.elementId && ctx.elements && !has(ctx.elements, e.elementId)) push("unknownElement", "hard", "mechanic", `${n}: elemento "${e.elementId}" não existe mais no catálogo.`, i);
      // Um tripulante pode mirar a Nave com efeito de Nave; só "Si mesmo" é certeza de que não pega.
      if (m.targetType === "self" && ctx.actorType === "character" && shipOnly.has(target)) push("shipOnSelf", "hard", "mechanic", `${n}: efeito de Nave numa Skill "Si mesmo" de Personagem — cai no próprio personagem e não faz nada.`, i);
      if (m.targetType === "self" && ctx.actorType === "ship" && characterOnly.has(target)) push("characterOnSelf", "hard", "mechanic", `${n}: efeito de Personagem numa Skill "Si mesmo" de Nave — não se aplica a uma Nave.`, i);
      const lasting = !e?.periodic && !INSTANT_TARGETS.includes(target) && !(Number(e?.durationRounds) > 0);
      if (lasting && !active && (Number(e?.amount) || e?.conditionId)) push("forever", "soft", "mechanic", `${n}: sem duração numa Skill que não é Ativa — fica no alvo para sempre (até alguém tirar). Era isso?`, i);
    });
  }
  return out;
}

/** Contagem por aba e lista por card (para o número na aba e a linha embaixo do card). */
export function lintIndex(items) {
  const byTab = {};
  const byEffect = {};
  for (const item of items ?? []) {
    byTab[item.tab] = (byTab[item.tab] ?? 0) + 1;
    if (item.effect != null) (byEffect[item.effect] ??= []).push(item);
  }
  return { byTab, byEffect };
}
