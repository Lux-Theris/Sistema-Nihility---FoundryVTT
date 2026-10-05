/**
 * Namespace central de configuração do sistema — ponto de entrada.
 *
 * Até a 1.67 era um arquivo só de ~4.000 linhas. Dividido em core/config/ por assunto, sem mudar
 * nenhuma função nem dado (conferido comparando a lista de exportações, com hash do código de cada
 * uma, antes e depois). Todo o sistema continua importando DAQUI; os arquivos da pasta são a
 * organização interna:
 *  - constants.js   SYSTEM_ID e MEU_SISTEMA (catálogos e tabelas padrão)
 *  - catalogs.js    leitores dos catálogos do Mestre (setting > padrão) e rótulos
 *  - features.js    blocos liga/desliga, presets de campanha, migrações, debugLog
 *  - progression.js XP, nível de Skill, escala de dano, Vida/Mana, pontos
 *  - actors.js      utilitários de Ator (uuid, Token, elementos, Traços…)
 *  - rules.js       regras puras testadas
 *  - settings.js    registerSystemSettings
 */
export * from "./config/constants.js";
export * from "./config/catalogs.js";
export * from "./config/features.js";
export * from "./config/progression.js";
export * from "./config/actors.js";
export * from "./config/rules.js";
export * from "./config/settings.js";
