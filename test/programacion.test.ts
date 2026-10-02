import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estadoVisible, faseConsulta, tocaConsultar } from '../src/programacion.ts';
import { instanteCdmx } from '../src/tiempo.ts';

const nomina = { fecha: '2026-10-02', hora: '06:30', tipo: 'nivel' as const };
const remesas = { fecha: '2026-11-03', hora: null, tipo: 'nivel' as const };
const utc = (iso: string) => new Date(iso);

test('las horas del dataset están en UTC−6', () => {
  assert.equal(instanteCdmx('2026-10-02', '06:30').toISOString(), '2026-10-02T12:30:00.000Z');
});

test('evento con hora: cada minuto 45 minutos, luego cada 15 hasta las 23:59', () => {
  assert.equal(faseConsulta(nomina, utc('2026-10-02T12:29:00Z')), 'antes');
  assert.equal(tocaConsultar(nomina, utc('2026-10-02T12:29:00Z')), false);
  assert.equal(tocaConsultar(nomina, utc('2026-10-02T12:30:00Z')), true);
  assert.equal(tocaConsultar(nomina, utc('2026-10-02T13:14:00Z')), true);
  assert.equal(faseConsulta(nomina, utc('2026-10-02T13:15:00Z')), 'cada-15');
  assert.equal(tocaConsultar(nomina, utc('2026-10-02T13:15:00Z')), true);
  assert.equal(tocaConsultar(nomina, utc('2026-10-02T13:16:00Z')), false);
  // 23:45 hora del centro todavía es el mismo día.
  assert.equal(tocaConsultar(nomina, utc('2026-10-03T05:45:00Z')), true);
});

test('retrasado: cada hora al día siguiente, luego cada 6 horas', () => {
  assert.equal(faseConsulta(nomina, utc('2026-10-03T06:00:00Z')), 'cada-hora');
  assert.equal(tocaConsultar(nomina, utc('2026-10-03T06:00:00Z')), true);
  assert.equal(tocaConsultar(nomina, utc('2026-10-03T06:15:00Z')), false);
  assert.equal(faseConsulta(nomina, utc('2026-10-04T06:00:00Z')), 'cada-6-horas');
  assert.equal(tocaConsultar(nomina, utc('2026-10-04T06:00:00Z')), true); // 0:00 del centro
  assert.equal(tocaConsultar(nomina, utc('2026-10-04T07:00:00Z')), false); // 1:00 del centro
  assert.equal(tocaConsultar(nomina, utc('2026-10-04T12:00:00Z')), true); // 6:00 del centro
  assert.equal(faseConsulta(nomina, utc('2026-11-02T06:00:00Z')), 'fin');
});

test('evento sin hora: cada 15 minutos de 6:00 a 20:00', () => {
  assert.equal(faseConsulta(remesas, utc('2026-11-03T11:59:00Z')), 'antes');
  assert.equal(tocaConsultar(remesas, utc('2026-11-03T12:00:00Z')), true);
  assert.equal(tocaConsultar(remesas, utc('2026-11-03T12:01:00Z')), false);
  assert.equal(tocaConsultar(remesas, utc('2026-11-04T02:00:00Z')), true); // 20:00 del centro
  assert.equal(faseConsulta(remesas, utc('2026-11-04T02:01:00Z')), 'cada-hora');
  assert.equal(tocaConsultar(remesas, utc('2026-11-04T03:00:00Z')), true);
});

test('estado visible', () => {
  const antes = utc('2026-10-02T12:00:00Z');
  const durante = utc('2026-10-02T12:40:00Z');
  const despues = utc('2026-10-03T07:00:00Z');
  assert.equal(estadoVisible(nomina, false, true, antes), 'pendiente');
  assert.equal(estadoVisible(nomina, false, true, durante), 'esperando');
  assert.equal(estadoVisible(nomina, false, true, despues), 'retrasado');
  assert.equal(estadoVisible(nomina, true, true, durante), 'publicado');
  assert.equal(estadoVisible(nomina, false, false, antes), 'pendiente');
  assert.equal(estadoVisible(nomina, false, false, durante), 'sin-fuente');
});

test('estado visible de eventos sin valores', () => {
  const minutas = { fecha: '2026-10-07', hora: '12:00', tipo: 'evento' as const };
  assert.equal(estadoVisible(minutas, false, false, utc('2026-10-07T17:59:00Z')), 'pendiente');
  assert.equal(estadoVisible(minutas, false, false, utc('2026-10-07T18:00:00Z')), 'publicado');
  const minutaBanxico = { fecha: '2026-10-08', hora: null, tipo: 'evento' as const };
  assert.equal(estadoVisible(minutaBanxico, false, false, utc('2026-10-08T20:00:00Z')), 'pendiente');
  assert.equal(estadoVisible(minutaBanxico, false, false, utc('2026-10-09T06:00:00Z')), 'publicado');
});
