/**
 * Tipos de arma de fábrica (H6, Maestria): grupos e subtipos num catálogo plano `{id, label, parent}`,
 * como os elementos de dano ("Subtipo de"). Só dados — não importa nada (constants.js os importa na
 * carga, um ciclo aqui seria erro de TDZ). Os ids são estrutura: a Maestria, a arma e o ataque
 * desarmado os guardam; renomear o rótulo é livre, trocar o id solta quem já o usa.
 *
 * `unarmed` é o tipo do ataque desarmado: o sistema o conhece pelo id, então ele não deve sumir do
 * catálogo (se sumir, o desarmado continua valendo, só sem nome bonito nem Maestria possível).
 */
export const UNARMED_WEAPON_TYPE = "unarmed";

export const DEFAULT_WEAPON_TYPES = [
  { id: "blades", label: "Lâminas", parent: "" },
  { id: "swords", label: "Espadas", parent: "blades" },
  { id: "daggers", label: "Adagas", parent: "blades" },
  { id: "axes", label: "Machados", parent: "blades" },

  { id: "blunt", label: "Contundentes", parent: "" },
  { id: "maces", label: "Maças", parent: "blunt" },
  { id: "hammers", label: "Martelos", parent: "blunt" },
  { id: "staves", label: "Bastões", parent: "blunt" },

  { id: "polearms", label: "Hastes", parent: "" },
  { id: "spears", label: "Lanças", parent: "polearms" },
  { id: "halberds", label: "Alabardas", parent: "polearms" },

  { id: "ranged", label: "Arcos e Bestas", parent: "" },
  { id: "bows", label: "Arcos", parent: "ranged" },
  { id: "crossbows", label: "Bestas", parent: "ranged" },

  { id: "firearms", label: "Armas de Fogo", parent: "" },
  { id: "pistols", label: "Pistolas", parent: "firearms" },
  { id: "rifles", label: "Fuzis", parent: "firearms" },
  { id: "shotguns", label: "Escopetas", parent: "firearms" },
  { id: "heavy", label: "Pesadas", parent: "firearms" },

  { id: "energy", label: "Energia", parent: "" },
  { id: "energyPistols", label: "Pistolas de energia", parent: "energy" },
  { id: "energyRifles", label: "Fuzis de energia", parent: "energy" },
  { id: "energyBlades", label: "Lâminas de energia", parent: "energy" },

  { id: "arcane", label: "Arcanas", parent: "" },
  { id: "arcaneStaves", label: "Cajados", parent: "arcane" },
  { id: "wands", label: "Varinhas", parent: "arcane" },
  { id: "orbs", label: "Orbes", parent: "arcane" },

  { id: "unarmed", label: "Desarmado", parent: "" },
  { id: "fists", label: "Punhos", parent: "unarmed" },
  { id: "natural", label: "Natural (garras, mordida)", parent: "unarmed" }
];
