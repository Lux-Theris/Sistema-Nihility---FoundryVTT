/**
 * Ponto de montagem da API pública exposta em `game.nihility.ai` (macros, módulos externos).
 * Não implementa mais nada diretamente — a lógica real mora nos módulos focados que a Fase 4
 * do refactor extraiu daqui: compendium.js (Compêndios de World), skill-snapshot.js (snapshot
 * de Skill em Sub-Skill, compartilhado), skill-economy.js (Habilidades concedidas/Fusão/
 * Evolução/Pontos de Habilidade), currency.js (conversão/transferência de Moeda),
 * voice-of-the-world.js (canal de anúncio privado) e ai-generation.js (tudo que fala com o
 * provedor de IA). Antes de 2026-08, tudo isso vivia junto neste arquivo (~1200 linhas) — o
 * resto do sistema importa cada função direto do módulo focado correspondente, não mais daqui.
 */
import { ensureSystemCompendiums, registerItemInCompendium } from "./compendium.js";
import {
  createGrantedSkill,
  removeGrantedSkill,
  fuseSkills,
  evolveSkill,
  breakSkillPoints,
  mergeSkillPoints,
  requestSkillCreation,
  approveSkillCreationRequest,
  rejectSkillCreationRequest
} from "./skill-economy.js";
import { convertActorCurrency, transferCurrency } from "./currency.js";
import { announceVoiceOfTheWorld, announceLevelUp } from "./voice-of-the-world.js";
import {
  requestAISpecialSkill,
  ingestExternalSkillJSON,
  editDocumentWithAI,
  generateFreeform,
  generateSkillFromAI,
  generateActorFromAI,
  generateVesselFromAI,
  generateNoteFromAI,
  getAIGeneratedFolder
} from "./ai-generation.js";

export const AIHelper = {
  ensureSystemCompendiums,
  registerItemInCompendium,
  createGrantedSkill,
  removeGrantedSkill,
  fuseSkills,
  evolveSkill,
  requestAISpecialSkill,
  ingestExternalSkillJSON,
  editDocumentWithAI,
  announceVoiceOfTheWorld,
  announceLevelUp,
  generateFreeform,
  generateSkillFromAI,
  generateActorFromAI,
  generateVesselFromAI,
  generateNoteFromAI,
  getAIGeneratedFolder,
  breakSkillPoints,
  mergeSkillPoints,
  requestSkillCreation,
  approveSkillCreationRequest,
  rejectSkillCreationRequest,
  convertActorCurrency,
  transferCurrency
};
