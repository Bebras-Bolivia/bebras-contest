import assert from "node:assert/strict";
import { test } from "node:test";
import { parseJsonValue } from "./json";
import { DEPARTMENTS, placeLabel, titleCase, townName } from "./places";
import { cleanName, nameKey, normalizeHeader } from "./text";

test("los nombres del catálogo en mayúsculas se leen con mayúscula inicial", () => {
  assert.equal(titleCase("SAN IGNACIO DE VELASCO"), "San Ignacio de Velasco");
  assert.equal(titleCase("  UNIDAD EDUCATIVA  LA SALLE "), "Unidad Educativa la Salle");
  assert.equal(titleCase("DE LA PAZ"), "De la Paz");
  assert.equal(titleCase("ÑUFLO DE CHÁVEZ"), "Ñuflo de Chávez");
});

test("«CAPITAL (…)» del catálogo es la ciudad capital", () => {
  assert.equal(townName("CAPITAL (COCHABAMBA)"), "Cochabamba");
  assert.equal(townName(" capital ( LA PAZ ) "), "La Paz");
  assert.equal(townName("YACUIBA"), "Yacuiba");
});

test("el lugar junta ciudad y departamento sin repetir la capital", () => {
  assert.equal(placeLabel("TARIJA", "Yacuiba"), "Yacuiba, Tarija");
  assert.equal(placeLabel("POTOSI", "Potosi"), "Potosí");
  assert.equal(placeLabel("POTOSI", ""), "Potosí");
  assert.equal(placeLabel(null, "Riberalta"), "Riberalta");
  assert.equal(placeLabel("INVENTADO", "  "), null);
  assert.equal(placeLabel(undefined, ""), null);
});

test("Chuquisaca usa el castor de Sucre y están los nueve departamentos", () => {
  assert.equal(Object.keys(DEPARTMENTS).length, 9);
  assert.deepEqual(DEPARTMENTS.CHUQUISACA, {
    name: "Chuquisaca",
    slug: "sucre",
  });
});

test("dos nombres iguales salvo tildes, mayúsculas o espacios son el mismo estudiante", () => {
  assert.equal(
    nameKey("  José  Luis ", "MAMANI   quispe"),
    nameKey("jose luis", "Mamani Quispe"),
  );
  assert.notEqual(nameKey("Ana", "Pérez"), nameKey("Ana", "Peres"));
  assert.equal(cleanName("  Ana   María "), "Ana María");
  assert.equal(normalizeHeader(" Apellidos "), "apellidos");
  assert.equal(normalizeHeader(null), "");
  assert.equal(normalizeHeader("CÓDIGO"), "codigo");
});

test("el JSON mal formado o vacío cae en el valor por defecto", () => {
  assert.deepEqual(parseJsonValue('["a"]', []), ["a"]);
  assert.deepEqual(parseJsonValue("{roto", { ok: false }), { ok: false });
  assert.deepEqual(parseJsonValue(null, [1]), [1]);
  assert.deepEqual(parseJsonValue(undefined, {}), {});
});
