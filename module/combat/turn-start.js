/**
 * Início de turno: tudo que roda quando chega a vez de um combatente (hook `updateCombat`).
 *
 * A ordem dos passos fica em `TURN_STEP_IDS` / `STOPPED_STEP_IDS` (turn-start-rules.js), congelada por
 * teste. Para pôr um passo novo: a id na posição certa da lista + uma entrada em `NORMAL_STEPS` (ou
 * `STOPPED_STEPS`) com `label` em pt-BR. Cada passo roda no próprio `try`: o erro de um vira aviso ao
 * Mestre e não impede os outros.
 *
 * Restrição do Reverter (time-rewind.js): o hook de lá tira uma foto SÍNCRONA do Ator no mesmo
 * `updateCombat`. Por isso nada que escreva em Ator pode rodar antes do primeiro `await` deste hook
 * (hoje, o `setFlag` no Combate), e este hook precisa ser registrado na avaliação do módulo de entrada.
 */
import { SYSTEM_ID } from "../core/config.js";
import { isDesignatedGm } from "../helpers/gm-relay.js";
import { reportError } from "../helpers/report.js";
import { combatScenes } from "../helpers/foundry-compat.js";
import { tickCombatRoundEffects } from "../skills/effects-apply.js";
import { tickActorUpkeepSkills, processPendingUpkeepRemoval } from "../skills/upkeep.js";
import { advanceZones, tickZonesForCombatant } from "../skills/zones.js";
import { tickStarshipPower } from "../starship/starship-power.js";
import { endMagicInsideFields } from "./antimagic.js";
import { advanceStructures, tickStructureContact } from "../structures/structures.js";
import { tickSkillTimers } from "../skills/preparation.js";
import { tickIncapacitation, isDead } from "./incapacitation.js";
import { tickContagion } from "./contagion.js";
import { advanceSpaceRegions } from "./space.js";
import { syncTokenEnvironment } from "../environment/environment.js";
import { tickRadiation, passRadiationTimeFor } from "../environment/radiation.js";
import { beginTimeTurn, endTimeTurn, previousActorOf, announceTimeTurn } from "./time-rate.js";
import { isTimeStopped, advanceTimeStops, freezeStoppedEffects, stoppedTurnNotice } from "./time-stop.js";
import { tickSurfacesForCombatant, advanceSurfaces } from "../environment/surfaces.js";
import { turnPosition, turnStartKind, runTurnSteps, TURN_STEP_IDS, STOPPED_STEP_IDS } from "./turn-start-rules.js";

const report = (label, err) => reportError(label, err, { gmOnly: true });

// Na V14 o Combate não tem Cena por padrão: as Cenas vêm dos Tokens dos combatentes.
// Zonas contam pelo turno de quem lançou (ver advanceZones); Estruturas, pela rodada.
async function advanceZonesAndStructures(ctx) {
  for (const scene of combatScenes(ctx.combat)) {
    await advanceZones(scene, { combat: ctx.combat, combatant: ctx.combatant, roundChanged: ctx.roundChanged });
    if (ctx.roundChanged) await advanceStructures(scene);
  }
  // Portais e Domínios (8f): contam como as Zonas, pelo turno de quem os abriu (as duas pontas de um Portal, em qualquer cena).
  await advanceSpaceRegions({ combat: ctx.combat, combatant: ctx.combatant, roundChanged: ctx.roundChanged });
}

// Superfícies (8.2): sem dono, contam pela virada da rodada.
async function advanceSceneSurfaces(ctx) {
  for (const scene of combatScenes(ctx.combat)) await advanceSurfaces(scene);
}

const notDead = ctx => !ctx.dead;

// Parado no tempo (8e.4): nada nele anda. Pula a cadeia toda do início do turno (Vida 0, Preparo, Recarga,
// periódicos, regeneração, manutenção, maldições, Radiação, Contágio, Zonas em cima dele); seguem só as coisas do
// MUNDO que contam por rodada (Zonas e Estruturas postas, superfícies) e o aviso na tela.
const STOPPED_STEPS = {
  stoppedTimeEnd: {
    label: "Falha ao pular o turno de quem está Parado no tempo (fim do turno anterior).",
    run: async ctx => {
      const finished = previousActorOf(ctx.combat);
      if (finished && !isTimeStopped(finished)) await endTimeTurn(ctx.combat, finished);
    }
  },
  stoppedZones: {
    label: "Falha ao pular o turno de quem está Parado no tempo (Zonas e Estruturas).",
    run: advanceZonesAndStructures
  },
  stoppedSurfaces: {
    label: "Falha ao pular o turno de quem está Parado no tempo (Superfícies).",
    when: ctx => ctx.roundChanged,
    run: advanceSceneSurfaces
  },
  stoppedNotice: {
    label: "Falha ao pular o turno de quem está Parado no tempo (aviso).",
    run: ctx => stoppedTurnNotice(ctx.actor)
  }
};

const NORMAL_STEPS = {
  // Manipulação do tempo (8e.2): quem acabou o turno gasta a reserva que sobrou nos estados; quem começa recebe a
  // dele. `steps` = quantas vezes os números por turno (Veneno, regeneração, custo das Ativas, Radiação, Vida 0)
  // passam neste turno: 1 normal, N Acelerado, 0 ou 1 Desacelerado. `notes` junta o que passou para o aviso.
  // Se falhar, ctx.timePlan/steps ficam no padrão (turno normal).
  timeRhythm: {
    label: "Falha ao começar o turno do tempo (reserva).",
    run: async ctx => {
      const finished = previousActorOf(ctx.combat);
      if (finished) await endTimeTurn(ctx.combat, finished);
      ctx.timePlan = await beginTimeTurn(ctx.combat, ctx.actor);
      ctx.steps = ctx.timePlan.steps;
    }
  },
  // Vida 0 (incapacitation.js): contador de morte do Caído e rodadas do Inconsciente — ANTES de
  // Zonas, ticks e regeneração, para quem sair do 0 neste turno não perder já uma rodada.
  incapacitation: {
    label: "Falha ao contar Caído/Inconsciente no início do turno.",
    run: ctx => tickIncapacitation(ctx.actor, { steps: ctx.steps })
  },
  // Recarga e Preparo (H3): logo depois do Vida 0 (quem caiu perde o preparo), antes de qualquer
  // regeneração ou manutenção — a parte do Custo do turno é a primeira coisa paga. Morto não.
  // `isDead` é lido na hora: o passo anterior pode ter mudado o estado.
  skillTimers: {
    label: "Falha ao andar recarga e preparo das Habilidades no início do turno.",
    when: ctx => !isDead(ctx.actor) && ctx.steps > 0,
    run: ctx => tickSkillTimers(ctx.actor)
  },
  // Morto: o turno dele não processa ticks, regeneração, Zona, manutenção nem Maldição. Seguem só
  // as Zonas que ELE lançou (contando, para sumirem no prazo) e a limpeza dos efeitos das
  // Habilidades Ativas que desligaram na morte — senão o buff que ele dava a um aliado ficaria.
  // Fotografado UMA vez aqui, depois de Vida 0 e Preparo, e vale para todos os passos seguintes.
  deadSnapshot: {
    label: "Falha ao conferir se o combatente está morto no início do turno.",
    run: ctx => { ctx.dead = isDead(ctx.actor); }
  },
  // Contágio (contagion.js): Condições com "espalha" passam para quem está no raio.
  contagion: {
    label: "Falha no Contágio no início do turno.",
    when: notDead,
    run: ctx => tickContagion(ctx.combatant)
  },
  // Ambiente (environment.js): confere os perigos da cena/área antes dos ticks da rodada.
  environment: {
    label: "Falha ao conferir o Ambiente no início do turno.",
    when: ctx => !!ctx.combatant.token,
    run: ctx => syncTokenEnvironment(ctx.combatant.token)
  },
  // Radiação (radiation.js): acumula/cai e causa o dano da rodada. Morto não.
  radiation: {
    label: "Falha na Radiação no início do turno.",
    when: ctx => !ctx.dead && ctx.combatant.token && ctx.steps > 0,
    run: ctx => tickRadiation(ctx.combatant.token)
  },
  radiationAccrued: {
    label: "Falha na Radiação acumulada do tempo acelerado no início do turno.",
    when: ctx => !ctx.dead && ctx.steps > 1,
    run: async ctx => {
      const rows = await passRadiationTimeFor([ctx.actor], ctx.steps - 1);
      for (const r of rows ?? []) ctx.timeNotes.push({ label: "Radiação", text: `irradiação ${r.before} → ${r.after} · −${r.damage} Vida` });
    }
  },
  // Muralha que queima: quem continua encostado nela (ou dentro) queima de novo.
  structureContact: {
    label: "Falha no contato com Estrutura no início do turno.",
    when: notDead,
    run: ctx => tickStructureContact(ctx.combatant)
  },
  // Campo de antimagia: quem começa o turno dentro dele perde o que é mágico.
  antimagic: {
    label: "Falha no campo de Antimagia no início do turno.",
    when: ctx => !ctx.dead && ctx.combatant.token,
    run: ctx => endMagicInsideFields(ctx.combatant.token)
  },
  zonesStructures: {
    label: "Falha ao processar Zonas e Estruturas no início do turno.",
    run: advanceZonesAndStructures
  },
  zoneCombatant: {
    label: "Falha ao processar a Zona do combatente no início do turno.",
    when: notDead,
    run: ctx => tickZonesForCombatant(ctx.combatant)
  },
  surfaces: {
    label: "Falha ao processar Superfícies no início do turno.",
    when: ctx => ctx.roundChanged,
    run: advanceSceneSurfaces
  },
  // Quem começa o turno em cima de uma Superfície sofre.
  surfaceCombatant: {
    label: "Falha ao processar a Superfície do combatente no início do turno.",
    when: notDead,
    run: ctx => tickSurfacesForCombatant(ctx.combatant)
  },
  periodicEffects: {
    label: "Falha ao ticar Efeitos Periódicos no início do turno.",
    when: notDead,
    run: ctx => tickCombatRoundEffects(ctx.actor, { steps: ctx.steps, notes: ctx.timeNotes })
  },
  // Regeneração por rodada (natural + passivos de Skill/Título/Item/Espécie) — antes da manutenção
  // das Habilidades Ativas, para uma regeneração alta poder bancar uma Ativa barata. Roda mesmo morto.
  regeneration: {
    label: "Falha na regeneração por rodada.",
    run: async ctx => {
      const { tickRegeneration } = await import("./regeneration.js");
      await tickRegeneration(ctx.actor, { steps: ctx.steps, notes: ctx.timeNotes });
    }
  },
  // Efeitos das Skills que a Mana em 0 desligou no turno anterior somem agora. Roda mesmo morto.
  upkeepRemoval: {
    label: "Falha ao remover efeitos de Habilidades desligadas por falta de Mana.",
    run: ctx => processPendingUpkeepRemoval(ctx.actor)
  },
  upkeepDrain: {
    label: "Falha ao drenar Energia de Habilidades Ativas no início do turno.",
    when: notDead,
    run: ctx => tickActorUpkeepSkills(ctx.actor, { steps: ctx.steps, notes: ctx.timeNotes })
  },
  // Maldições (prancha 6): cobram da Mana da vítima depois da regeneração e da manutenção.
  curses: {
    label: "Falha ao processar Maldições no início do turno.",
    when: notDead,
    run: async ctx => {
      const { tickCurses } = await import("../skills/curses.js");
      await tickCurses(ctx.actor, { steps: ctx.steps, notes: ctx.timeNotes });
    }
  },
  announce: {
    label: "Falha ao avisar o ritmo do tempo.",
    run: ctx => announceTimeTurn(ctx.actor, ctx.timePlan, ctx.timeNotes)
  },
  starshipPower: {
    label: "Falha ao ticar Energia/Sobrecarga de Módulos no início do turno.",
    when: ctx => ["starship", "vehicle"].includes(ctx.actor.type),
    run: ctx => tickStarshipPower(ctx.actor)
  }
};

/** Monta a lista de passos na ordem das ids; falta de id é erro de programação. */
function buildSteps(ids, table) {
  return ids.map(id => {
    const def = table[id];
    if (!def) throw new Error(`${SYSTEM_ID} | Passo de início de turno sem definição: ${id}`);
    return { id, ...def };
  });
}

const NORMAL_LIST = buildSteps(TURN_STEP_IDS, NORMAL_STEPS);
const STOPPED_LIST = buildSteps(STOPPED_STEP_IDS, STOPPED_STEPS);

// Tica Efeitos Periódicos, regeneração, manutenção etc. sempre que chega a vez de um combatente — só o
// dono desse turno tica, uma vez por turno próprio (não uma vez por rodada global). Só o Mestre DESIGNADO
// executa: com `isGM`, um segundo Mestre (ou um Assistente) conectado ticava tudo de novo — veneno,
// regeneração e manutenção em dobro. Vários passos não se protegem por dentro.
export async function onCombatTurnStart(combat, changed, options) {
  if (!isDesignatedGm()) return;
  if (changed.turn === undefined && changed.round === undefined) return;
  // "Turno anterior"/"Rodada anterior" do Foundry (direction −1): o turno já começou uma vez.
  // Tudo daqui é início de turno e rodaria DE NOVO — o Mestre que volta um turno por engano cobraria tudo duas vezes.
  // Voltar e avançar de novo cai num turno que já começou: só processa turno NOVO (rodada/turno
  // além do último já processado, guardado no próprio Combate pelo Mestre designado).
  // Edição à mão para trás (sem direction) só reinicia o contador. Ver `turnStartKind`.
  const position = turnPosition(combat.round, combat.turn);
  const kind = turnStartKind({ position, processed: combat.getFlag(SYSTEM_ID, "turnProcessed"), direction: options?.direction });
  if (kind === "back" || kind === "again") return;
  await combat.setFlag(SYSTEM_ID, "turnProcessed", position);
  if (kind === "reset") return;

  // O combatente deste turno, guardado já: o resto é assíncrono, e ler `combat.combatant` depois
  // de um await pegava o PRÓXIMO (Mestre avançando rápido) ou null (combate encerrado no meio).
  const combatant = combat.combatant;
  const actor = combatant?.actor;
  if (!actor) return;

  const ctx = {
    combat,
    changed,
    combatant,
    actor,
    roundChanged: changed.round !== undefined,
    timePlan: { kind: "normal", factor: 1, steps: 1 },
    steps: 1,
    timeNotes: [],
    dead: false
  };

  // Parar o tempo (8e.4): a cada virada de rodada os prazos de quem está Parado ficam congelados; e os Parar lançados por
  // quem começa o turno agora perdem 1 rodada (quem acaba o prazo sai do Parado, e o dano acumulado cai).
  try {
    if (ctx.roundChanged) await freezeStoppedEffects(combat);
    if (!isTimeStopped(actor)) await advanceTimeStops(combat, combatant, { roundChanged: ctx.roundChanged });
  } catch (err) {
    report("Falha ao contar o tempo parado.", err);
  }

  await runTurnSteps(isTimeStopped(actor) ? STOPPED_LIST : NORMAL_LIST, ctx, report);
}
