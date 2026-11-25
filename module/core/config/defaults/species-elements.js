/**
 * Linhagens por elemento do Dragoide e do Slime, e a Linhagem Slime Comum (1.121.0; quadros 11 e 12 do design).
 * Dados puros: não importa nada. Fora do catálogo principal (`species.js`) porque a migração `originElements` acrescenta
 * exatamente estas a um catálogo já salvo.
 *
 * Cada Linhagem: o corpo do elemento (`elements`) e a resistência dele (Dragoide 20, Slime 30). A fraqueza ao oposto vem
 * da tabela de afinidade (Trevas ↔ Luz, Sagrado ↔ Demoníaco, Terra › Raio › Vento › Terra): não há número a mais onde o
 * corpo já resolve. Fogo e Gelo, que a tabela não cobre, levam o número explícito (como as Linhagens antigas). Óleo não tem
 * Linhagem. Dragoide ganha um Sopro (3d6; o de Trevas é 2d6 + Zona de breu); Slime ganha um toque do elemento.
 */

const fx = (target, amount, rounds, extra = {}) => ({
  target,
  amount,
  durationRounds: rounds,
  conditionId: "",
  periodic: false,
  damageElements: [],
  ...extra
});

/** Elementos de fantasia do Dragoide que ainda não tinham Linhagem: [id, rótulo, nome do Sopro, formato, distância]. */
const FANTASY = [
  ["water", "da Água", "Sopro Aquático", "ray", 8],
  ["acid", "do Ácido", "Sopro Ácido", "cone", 6],
  ["earth", "da Terra", "Sopro de Pedra", "cone", 6],
  ["wind", "do Vento", "Sopro Ventoso", "cone", 6],
  ["light", "da Luz", "Sopro Radiante", "ray", 8],
  ["holy", "do Sagrado", "Sopro Sagrado", "cone", 6],
  ["demonic", "do Demoníaco", "Sopro Infernal", "cone", 6]
];

/** Os nove elementos de ficção científica: [id, rótulo]. Corpo do elemento + Traço Mecânico (fraco a PEM). */
const SCIFI = [
  ["kinetic", "Cinético"],
  ["phaser", "Phaser"],
  ["disruptor", "Disruptor"],
  ["plasma", "Plasma"],
  ["polaron", "Pólaron"],
  ["tetryon", "Táquion"],
  ["antiproton", "Antiprótons"],
  ["transphasic", "Transfásico"],
  ["radiation", "Radiação"]
];

const area = (shape, distance) => (shape === "ray"
  ? { targetType: "emission", areaShape: "ray", areaDistance: distance }
  : { targetType: "emission", areaShape: "cone", areaDistance: distance, areaAngle: 53 });

const breath = (key, name, element, shape, distance, magic = true, description = "") => ({
  key,
  name,
  description: description || `Exala o elemento da própria linhagem ${shape === "ray" ? "em linha reta" : "num cone à frente"}.`,
  level: 1,
  cost: 20,
  effectType: "damage",
  damageFormula: "3d6",
  damageElements: [element],
  isMagicDamage: magic,
  ...area(shape, distance)
});

const touch = (key, name, element, magic = true) => ({
  key,
  name,
  description: "Um toque da massa, carregado do elemento da Linhagem.",
  level: 1,
  cost: 10,
  range: 1.5,
  effectType: "damage",
  damageFormula: "2d6",
  damageElements: [element],
  isMagicDamage: magic,
  targetType: "targeted"
});

/** Sopro Ventoso: Combinada de dano em cone + empurrão (o efeito Empurrar de sempre). */
const windBreath = () => ({
  key: "sopro_ventoso",
  name: "Sopro Ventoso",
  description: "Exala uma rajada num cone à frente: fere e empurra quem está dentro.",
  level: 1,
  cost: 20,
  effectType: "none",
  targetType: "targeted",
  combined: true,
  subSkills: [
    { name: "Rajada", tier: "racial", effectType: "damage", damageFormula: "3d6", damageElements: ["wind"], isMagicDamage: true, ...area("cone", 6), areaOrigin: "caster" },
    { name: "Empurrão", tier: "racial", effectType: "temporary", ...area("cone", 6), areaOrigin: "caster", effects: [fx("push", 3, 0, { pushDirection: "push" })] }
  ]
});

/** Dragoide: uma Linhagem por elemento (Fogo, Gelo, Raio e Trevas já existem no catálogo ou vêm de `dragoideDarkLineage`). */
export function dragoideElementLineages() {
  const out = FANTASY.map(([element, suffix, name, shape, distance]) => ({
    id: element,
    label: `Linhagem ${suffix}`,
    description: "Escamas do elemento; o sopro é do mesmo elemento.",
    elements: [element],
    passives: { resistances: [{ target: element, amount: 20 }] },
    skills: [element === "wind" ? windBreath() : breath(`sopro_${element}`, name, element, shape, distance)],
    replaces: { skills: ["sopro_draconico"] }
  }));
  out.push(...SCIFI.map(([element, label]) => ({
    id: `sf_${element}`,
    label: `Linhagem ${label}`,
    description: `Um dragão de metal e energia: o corpo é de ${label}, e a tecnologia o deixa fraco a PEM.`,
    traits: ["mechanical"],
    elements: [element],
    passives: { resistances: [{ target: element, amount: 20 }] },
    skills: [breath(`sopro_${element}`, `Sopro de ${label}`, element, "cone", 6, false, `Exala ${label} num cone à frente, com o efeito do próprio elemento (contra Escudo, Casco, penetração).`)],
    replaces: { skills: ["sopro_draconico"] }
  })));
  return out;
}

/** Dragão de Trevas (quadro 12): o caçador da escuridão. Corpo Trevas + Trevas 20 (fraco a Luz pela tabela). */
export function dragoideDarkLineage() {
  const mod = target => ({ when: { kind: "selfDark", value: "", threshold: 50 }, then: { kind: "attributeFlat", target, value: 1 }, perEach: "", perLevels: 5, timesDarkness: true });
  return {
    id: "trevas",
    label: "Linhagem das Trevas",
    description: "O caçador que a luz não encontra: enxerga no escuro pela visão do Token e some na sombra que ele mesmo cria.",
    elements: ["dark"],
    passives: { resistances: [{ target: "dark", amount: 20 }] },
    skills: [
      {
        key: "escamas_de_breu",
        name: "Escamas de Breu",
        description: "No escuro, as escamas somem na sombra: +1 Furtividade e +1 Defesa a cada 5 níveis da Skill (níveis 1 a 9 contam 1 vez; 10 a 14, 2…), vezes a escuridão da cena onde ele está.",
        level: 1,
        cost: 0,
        conditionalModifiers: [mod("stealth"), mod("defense")]
      },
      {
        key: "sopro_de_breu",
        name: "Sopro de Breu",
        description: "Exala um cone de breu: fere com Trevas e deixa uma Zona que escurece o mapa por 2 rodadas, com chance de Cegueira para quem está dentro. Dentro dela o dragão conta como no escuro.",
        level: 1,
        cost: 20,
        effectType: "none",
        targetType: "targeted",
        combined: true,
        subSkills: [
          { name: "Sopro", tier: "racial", effectType: "damage", damageFormula: "2d6", damageElements: ["dark"], isMagicDamage: true, ...area("cone", 6), areaOrigin: "caster" },
          {
            name: "Zona de breu",
            tier: "racial",
            effectType: "temporary",
            targetType: "zone",
            areaShape: "cone",
            areaDistance: 6,
            areaAngle: 53,
            areaOrigin: "caster",
            zoneRounds: 2,
            zoneDarkens: true,
            effects: [fx("strength", 0, 1, { conditionId: "blindness", chance: 50 })]
          }
        ]
      },
      {
        key: "passo_de_sombra",
        name: "Passo de Sombra",
        description: "Salta curto de uma sombra para outra. Só funciona se ele estiver no escuro. Âncora e Interdição bloqueiam.",
        level: 1,
        cost: 10,
        unlockLevel: 10,
        range: 6,
        effectType: "temporary",
        targetType: "self",
        onlyIf: { kind: "selfDark", value: "", threshold: 50 },
        effects: [fx("space", 0, 0, { spaceMode: "jump" })]
      }
    ],
    replaces: { skills: ["sopro_draconico"] }
  };
}

/** Slime: uma Linhagem por elemento (resistência 30 ao próprio elemento, um toque do elemento). */
export function slimeElementLineages() {
  const fantasy = [
    ["fire", "do Fogo", "Toque Flamejante", "ice"],
    ["ice", "do Gelo", "Toque Gélido", "fire"],
    ["lightning", "do Raio", "Toque Elétrico", null],
    ["water", "da Água", "Toque Aquático", null],
    ["acid", "do Ácido", "Toque Ácido", null],
    ["earth", "da Terra", "Toque de Pedra", null],
    ["wind", "do Vento", "Toque Ventoso", null],
    ["dark", "das Trevas", "Toque Sombrio", null],
    ["light", "da Luz", "Toque Radiante", null],
    ["holy", "do Sagrado", "Toque Sagrado", null],
    ["demonic", "do Demoníaco", "Toque Infernal", null]
  ];
  const out = fantasy.map(([element, suffix, name, weakTo]) => ({
    id: element,
    label: `Slime ${suffix.replace(/^d[oa]s? /, "")}`,
    description: "Massa com o corpo do elemento: resiste a ele e dá um toque dele.",
    elements: [element],
    passives: { resistances: [{ target: element, amount: 30 }, ...(weakTo ? [{ target: weakTo, amount: -20 }] : [])] },
    skills: [touch(`toque_${element}`, name, element)]
  }));
  out.push(...SCIFI.map(([element, label]) => ({
    id: `sf_${element}`,
    label: `Slime ${label}`,
    description: `Massa de nanomáquinas com o corpo de ${label}: fraca a PEM.`,
    traits: ["mechanical"],
    elements: [element],
    passives: { resistances: [{ target: element, amount: 30 }] },
    skills: [touch(`toque_${element}`, `Toque de ${label}`, element, false)]
  })));
  return out;
}

/** Slime Comum: a Linhagem padrão do Slime; leva a fraqueza a Fogo (que saiu da Espécie). */
export const SLIME_COMMON_LINEAGE = {
  id: "comum",
  label: "Slime Comum",
  description: "A massa simples de sempre: fraca ao fogo.",
  passives: { resistances: [{ target: "fire", amount: -20 }] }
};

/** Os ids das Linhagens que a 1.121.0 acrescenta, por Espécie (a migração `originElements` os usa). */
export function newLineageIds() {
  return {
    dragoide: [...dragoideElementLineages().map(l => l.id), dragoideDarkLineage().id],
    slime: [SLIME_COMMON_LINEAGE.id, ...slimeElementLineages().map(l => l.id)]
  };
}
