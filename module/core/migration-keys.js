/**
 * Chaves das migrações únicas, na ordem em que rodam. Puro de propósito (sem imports): o teste
 * congela esta lista, porque trocar uma chave faz a migração rodar de novo em todo mundo.
 * Migração nova entra no FIM, aqui e em `MIGRATIONS` (`core/migrations.js`).
 */
export const MIGRATION_KEYS = [
  "tierCommonToNormal",
  "elementalDamageToMagicTag",
  "speciesStableKeys",
  "physicalSubtypes",
  "incapacitationConditions",
  "radiationElement",
  "techConditions",
  "systemEffectIcons",
  "markCondition",
  "senseConditions",
  "sleepingCondition",
  "reactionsDefaults",
  "surfaceDefaults",
  "duelDefaults",
  "luckDefaults"
];
