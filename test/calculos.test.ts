import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularVariacion, redondear, variacionPorcentual } from '../src/calculos.ts';

test('nómina de septiembre: esperado 89, real 29 da −67.4%', () => {
  const v = calcularVariacion('nivel', 'alto', 0, 29, 89);
  assert.deepEqual(v, { pct: -67.4, direccion: 'abajo', tono: 'desfavorable', diferencia: null, unidadDiferencia: null });
});

test('desempleo de septiembre: +2.4% y +0.10 pp, desfavorable porque lo mejor es bajo', () => {
  const v = calcularVariacion('pct', 'bajo', 1, 4.2, 4.1);
  assert.deepEqual(v, { pct: 2.4, direccion: 'arriba', tono: 'desfavorable', diferencia: 0.1, unidadDiferencia: 'pp' });
});

test('ADP de septiembre: real arriba de lo esperado es favorable', () => {
  const v = calcularVariacion('nivel', 'alto', 0, 90, 68);
  assert.equal(v?.pct, 32.4);
  assert.equal(v?.tono, 'favorable');
  assert.equal(v?.direccion, 'arriba');
});

test('tasa: la diferencia va en puntos base y el tono es neutral', () => {
  const v = calcularVariacion('tasa', 'neutral', 2, 3.75, 3.5);
  assert.deepEqual(v, { pct: 7.1, direccion: 'arriba', tono: 'neutral', diferencia: 25, unidadDiferencia: 'pb' });
  assert.equal(calcularVariacion('tasa', 'neutral', 2, 3.5, 3.75)?.diferencia, -25);
});

test('esperado negativo: el signo sale correcto con |Esperado|', () => {
  // Déficit menor al esperado: −70 contra −80 es una mejora.
  const v = calcularVariacion('nivel', 'alto', 1, -70, -80);
  assert.equal(v?.pct, 12.5);
  assert.equal(v?.direccion, 'arriba');
  assert.equal(v?.tono, 'favorable');
});

test('dato igual a lo esperado: en línea', () => {
  const v = calcularVariacion('pct', 'bajo', 1, 3.0, 3.0);
  assert.deepEqual(v, { pct: 0, direccion: 'igual', tono: 'en-linea', diferencia: 0, unidadDiferencia: 'pp' });
  // Se compara con los decimales del boletín.
  assert.equal(calcularVariacion('pct', 'alto', 1, 2.04, 2.0)?.tono, 'en-linea');
});

test('sin esperado, sin real, esperado 0 o evento: no hay variación', () => {
  assert.equal(calcularVariacion('pct', 'bajo', 1, null, 3), null);
  assert.equal(calcularVariacion('pct', 'bajo', 1, 3, null), null);
  assert.equal(calcularVariacion('nivel', 'alto', 0, 5, 0), null);
  assert.equal(calcularVariacion('evento', 'neutral', 0, 1, 1), null);
});

test('INPC con 2 decimales: diferencia en pp', () => {
  const v = calcularVariacion('pct', 'bajo', 2, 3.76, 3.8);
  assert.equal(v?.diferencia, -0.04);
  assert.equal(v?.pct, -1.1);
  assert.equal(v?.tono, 'favorable');
});

test('redondeo: la mitad se aleja de cero y no hay −0', () => {
  assert.equal(redondear(2.45, 1), 2.5);
  assert.equal(redondear(-2.45, 1), -2.5);
  assert.equal(redondear(1.005, 2), 1.01);
  assert.equal(redondear(0.1 + 0.2, 2), 0.3);
  assert.ok(Object.is(redondear(-0.04, 1), 0));
  assert.ok(Number.isNaN(redondear(Number.NaN, 1)));
});

test('variación porcentual de un índice', () => {
  assert.equal(redondear(variacionPorcentual(324.368, 314.796), 1), 3.0);
});
