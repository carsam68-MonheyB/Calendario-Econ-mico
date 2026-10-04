import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { idEvento, leerCalendario, parsearCsv } from '../src/calendario.ts';
import { indicadorDe } from '../src/indicadores.ts';

const csv = readFileSync(new URL('../data/calendario.csv', import.meta.url), 'utf8');

test('el calendario tiene las 91 filas y todas son válidas', () => {
  const filas = leerCalendario(csv);
  assert.equal(filas.length, 91);
  const porTipo = Object.groupBy(filas, (f) => f.tipo);
  assert.equal(porTipo.pct?.length, 51);
  assert.equal(porTipo.nivel?.length, 24);
  assert.equal(porTipo.tasa?.length, 4);
  assert.equal(porTipo.evento?.length, 12);
});

test('solo las tres primeras filas traen esperado y real', () => {
  const filas = leerCalendario(csv);
  const conValores = filas.filter((f) => f.esperado !== null || f.real !== null);
  assert.deepEqual(
    conValores.map((f) => [f.indicador, f.periodo, f.esperado, f.real]),
    [
      ['Empleo privado ADP', 'sep', 68, 90],
      ['Nómina no agrícola', 'sep', 89, 29],
      ['Tasa de desempleo', 'sep', 4.1, 4.2],
    ],
  );
});

test('todos los indicadores del CSV están en el catálogo', () => {
  const desconocidos = leerCalendario(csv).filter((f) => !indicadorDe(f).conocido);
  assert.deepEqual(desconocidos.map((f) => f.indicador), []);
});

test('identificadores legibles y únicos', () => {
  assert.equal(idEvento('2026-10-08', 'MX', 'INPC general anual'), '2026-10-08-mx-inpc-general-anual');
  assert.equal(
    idEvento('2026-10-28', 'US', 'Decisión de la Fed (límite superior)'),
    '2026-10-28-us-decision-de-la-fed-limite-superior',
  );
  const filas = leerCalendario(csv);
  assert.equal(new Set(filas.map((f) => f.id)).size, filas.length);
});

test('el lector de CSV respeta comillas y saltos de línea de Windows', () => {
  assert.deepEqual(parsearCsv('a,b\r\n"x, y","dijo ""hola"""\r\n'), [
    ['a', 'b'],
    ['x, y', 'dijo "hola"'],
  ]);
});

test('errores claros en filas inválidas', () => {
  const encabezado = 'fecha,hora,pais,indicador,periodo,unidad,tipo,mejor,esperado,real\n';
  assert.throws(() => leerCalendario('fecha,pais\n'), /encabezado/);
  assert.throws(() => leerCalendario(`${encabezado}2026-13,06:00,MX,X,sep,%,pct,alto,,\n`), /Línea 2: fecha/);
  assert.throws(() => leerCalendario(`${encabezado}2026-10-01,6:00,MX,X,sep,%,pct,alto,,\n`), /hora/);
  assert.throws(() => leerCalendario(`${encabezado}2026-10-01,06:00,CA,X,sep,%,pct,alto,,\n`), /país/);
  assert.throws(() => leerCalendario(`${encabezado}2026-10-01,06:00,MX,X,sep,%,pct,alto,abc,\n`), /no es un número/);
  const repetida = '2026-10-01,06:00,MX,X,sep,%,pct,alto,,\n';
  assert.throws(() => leerCalendario(encabezado + repetida + repetida), /repetido/);
});

test('la columna opcional "anterior" se lee y se valida', () => {
  const base = 'fecha,hora,pais,indicador,periodo,unidad,tipo,mejor,esperado,real';
  const filas = leerCalendario(`${base},anterior
2026-10-05,08:00,US,ISM servicios,sep,índice,nivel,alto,52,,51.9
2026-10-08,06:00,MX,INPC general anual,sep,% a/a,pct,bajo,,,
`);
  assert.equal(filas[0]?.anterior, 51.9);
  assert.equal(filas[1]?.anterior, null);
  assert.equal(leerCalendario(`${base}\n2026-10-08,06:00,MX,INPC general anual,sep,% a/a,pct,bajo,,\n`)[0]?.anterior, null);
  assert.throws(() => leerCalendario(`${base},otra\n`), /encabezado/);
  assert.throws(() => leerCalendario(`${base},anterior\n2026-10-05,08:00,US,ISM servicios,sep,índice,nivel,alto,52,,abc\n`), /no es un número/);
  assert.throws(() => leerCalendario(`${base},anterior\n2026-10-05,08:00,US,ISM servicios,sep,índice,nivel,alto,52,\n`), /columnas/);
});
