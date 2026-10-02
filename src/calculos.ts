// Cálculos del dato real y de la variación contra lo esperado.

import type { Mejor, Tipo } from './calendario.ts';

/** Redondeo al estilo de los boletines: la mitad se aleja de cero. */
export function redondear(valor: number, decimales: number): number {
  if (!Number.isFinite(valor)) return valor;
  const factor = 10 ** decimales;
  const escalado = Math.abs(valor) * factor;
  // Corrige errores binarios como 1.005 * 100 = 100.49999999999999.
  const redondeado = Math.round(Number(escalado.toPrecision(15)));
  const resultado = (Math.sign(valor) * redondeado) / factor;
  return Object.is(resultado, -0) ? 0 : resultado;
}

/** Variación porcentual de un índice contra su base: (actual / base − 1) × 100. */
export function variacionPorcentual(actual: number, base: number): number {
  return (actual / base - 1) * 100;
}

export type Direccion = 'arriba' | 'abajo' | 'igual';
export type Tono = 'favorable' | 'desfavorable' | 'neutral' | 'en-linea';

export interface Variacion {
  /** (Real − Esperado) / |Esperado| × 100, con 1 decimal. */
  pct: number;
  direccion: Direccion;
  tono: Tono;
  /** Real − Esperado en puntos porcentuales (pct) o en puntos base (tasa). */
  diferencia: number | null;
  unidadDiferencia: 'pp' | 'pb' | null;
}

/**
 * Variación del dato real contra lo esperado. Devuelve null si falta alguno de los dos,
 * si lo esperado es 0 o si el evento no lleva valores.
 */
export function calcularVariacion(
  tipo: Tipo,
  mejor: Mejor,
  decimales: number,
  real: number | null,
  esperado: number | null,
): Variacion | null {
  if (tipo === 'evento' || real === null || esperado === null || esperado === 0) return null;

  const r = redondear(real, decimales);
  const e = redondear(esperado, decimales);
  const direccion: Direccion = r > e ? 'arriba' : r < e ? 'abajo' : 'igual';

  let tono: Tono;
  if (direccion === 'igual') tono = 'en-linea';
  else if (mejor === 'neutral') tono = 'neutral';
  else tono = (direccion === 'arriba') === (mejor === 'alto') ? 'favorable' : 'desfavorable';

  let diferencia: number | null = null;
  let unidadDiferencia: Variacion['unidadDiferencia'] = null;
  if (tipo === 'pct') {
    diferencia = redondear(r - e, 2);
    unidadDiferencia = 'pp';
  } else if (tipo === 'tasa') {
    diferencia = redondear((r - e) * 100, 0);
    unidadDiferencia = 'pb';
  }

  return { pct: redondear(((r - e) / Math.abs(e)) * 100, 1), direccion, tono, diferencia, unidadDiferencia };
}
