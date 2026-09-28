/** `key` es el nombre del departamento en el catálogo de colegios; la primera ciudad es la capital. */
export const DEPARTMENTS = [
  {
    key: "LA PAZ",
    slug: "la-paz",
    name: "La Paz",
    cities: ["La Paz", "El Alto", "Viacha", "Caranavi", "Achacachi"],
  },
  {
    key: "COCHABAMBA",
    slug: "cochabamba",
    name: "Cochabamba",
    cities: ["Cochabamba", "Quillacollo", "Sacaba", "Tiquipaya", "Punata"],
  },
  {
    key: "SANTA CRUZ",
    slug: "santa-cruz",
    name: "Santa Cruz",
    cities: ["Santa Cruz", "Montero", "Warnes", "Camiri", "Yapacaní"],
  },
  {
    key: "ORURO",
    slug: "oruro",
    name: "Oruro",
    cities: ["Oruro", "Huanuni", "Challapata", "Caracollo"],
  },
  {
    key: "POTOSI",
    slug: "potosi",
    name: "Potosí",
    cities: ["Potosí", "Uyuni", "Villazón", "Tupiza", "Llallagua"],
  },
  {
    key: "CHUQUISACA",
    slug: "sucre",
    name: "Chuquisaca",
    cities: ["Sucre", "Monteagudo", "Camargo", "Padilla"],
  },
  {
    key: "TARIJA",
    slug: "tarija",
    name: "Tarija",
    cities: ["Tarija", "Yacuiba", "Bermejo", "Villamontes"],
  },
  {
    key: "BENI",
    slug: "beni",
    name: "Beni",
    cities: ["Trinidad", "Riberalta", "Guayaramerín", "San Borja"],
  },
  {
    key: "PANDO",
    slug: "pando",
    name: "Pando",
    cities: ["Cobija"],
  },
] as const;

export type Department = (typeof DEPARTMENTS)[number];
