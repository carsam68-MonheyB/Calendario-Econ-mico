import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anioAnterior, clavePeriodo, periodoAnterior, periodoDeEvento } from '../src/periodos.ts';
import type { FilaCalendario } from '../src/calendario.ts';

function fila(fecha: string, indicador: string, periodo: string, tipo: FilaCalendario['tipo'] = 'pct', pais: 'MX' | 'US' = 'MX') {
  return { fecha, indicador, periodo, tipo, pais };
}

const clave = (f: ReturnType<typeof fila>) => {
  const p = periodoDeEvento(f);
  return p ? clavePeriodo(p) : null;
};

test('meses: el año sale de la fecha de publicación', () => {
  assert.equal(clave(fila('2026-10-02', 'Nómina no agrícola', 'sep', 'nivel', 'US')), '2026-09');
  assert.equal(clave(fila('2026-10-05', 'Consumo privado', 'jul')), '2026-07');
  assert.equal(clave(fila('2027-01-12', 'CPI general anual', 'dic', 'pct', 'US')), '2026-12');
});

test('trimestres', () => {
  assert.equal(clave(fila('2026-10-29', 'PIB (avance)', '3T', 'pct', 'US')), '2026-T3');
  assert.equal(clave(fila('2026-12-23', 'PIB (final)', '3T', 'pct', 'US')), '2026-T3');
  assert.equal(clave(fila('2027-01-29', 'PIB (avance)', '4T', 'pct', 'US')), '2026-T4');
});

test('primera quincena del INPC', () => {
  assert.equal(clave(fila('2026-10-22', 'INPC general anual 1a quincena', 'oct')), '2026-10-Q1');
  assert.equal(clave(fila('2026-12-23', 'INPC subyacente anual 1a quincena', 'dic')), '2026-12-Q1');
});

test('decisiones de tasa: el periodo es el día del anuncio', () => {
  assert.equal(clave(fila('2026-10-28', 'Decisión de la Fed (límite superior)', 'oct', 'tasa', 'US')), '2026-10-28');
});

test('eventos sin valores y periodos no reconocidos no tienen periodo', () => {
  assert.equal(clave(fila('2026-10-07', 'Minutas del FOMC', 'reunión 15-16 sep', 'evento', 'US')), null);
  assert.equal(clave(fila('2026-11-26', 'Informe trimestral de Banxico', 'jul-sep', 'evento')), null);
});

test('periodo anterior y mismo periodo del año anterior', () => {
  assert.equal(clavePeriodo(periodoAnterior({ tipo: 'mes', anio: 2026, mes: 1 })), '2025-12');
  assert.equal(clavePeriodo(periodoAnterior({ tipo: 'trimestre', anio: 2026, trimestre: 1 })), '2025-T4');
  assert.equal(clavePeriodo(periodoAnterior({ tipo: 'quincena', anio: 2026, mes: 1, quincena: 1 })), '2025-12-Q2');
  assert.equal(clavePeriodo(periodoAnterior({ tipo: 'quincena', anio: 2026, mes: 10, quincena: 2 })), '2026-10-Q1');
  assert.equal(clavePeriodo(anioAnterior({ tipo: 'quincena', anio: 2026, mes: 10, quincena: 1 })), '2025-10-Q1');
});
