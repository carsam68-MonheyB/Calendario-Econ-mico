// BLS Public Data API v2: una sola llamada POST con todas las series que tocan.

import { ErrorFuente, obtenerJson, sanitizar } from '../red.ts';
import type { Observaciones } from './tipos.ts';

export const URL_BLS = 'https://api.bls.gov/publicAPI/v2/timeseries/data/';

interface DatoBls {
  year: string;
  period: string;
  value: string;
  calculations?: { pct_changes?: Record<string, string> };
}
interface RespuestaBls {
  status?: string;
  message?: string[];
  Results?: { series?: { seriesID: string; data?: DatoBls[] }[] };
}

/** "M09" → "2026-09"; "Q03" → "2026-T3". Los promedios anuales (M13) se ignoran. */
export function periodoBls(anio: string, periodo: string): string | null {
  const mes = /^M(0[1-9]|1[0-2])$/.exec(periodo);
  if (mes) return `${anio}-${mes[1]}`;
  const trimestre = /^Q0?([1-4])$/.exec(periodo);
  if (trimestre) return `${anio}-T${trimestre[1]}`;
  return null;
}

function numero(texto: string | undefined): number | null {
  const limpio = texto?.replace(/,/g, '').trim();
  if (!limpio || limpio === '-') return null;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

/**
 * Devuelve, por serie, sus observaciones. Además agrega "<serie>#12m" con el cambio a 12 meses
 * que calcula el propio BLS, útil si falta el índice del año anterior.
 */
export function leerRespuestaBls(r: RespuestaBls): Map<string, Observaciones> {
  if (r.status !== 'REQUEST_SUCCEEDED') {
    throw new ErrorFuente(sanitizar(`BLS: ${(r.message ?? []).join(' ') || r.status || 'respuesta inválida'}`));
  }
  const resultado = new Map<string, Observaciones>();
  for (const serie of r.Results?.series ?? []) {
    const valores: Observaciones = new Map();
    const anuales: Observaciones = new Map();
    for (const d of serie.data ?? []) {
      const clave = periodoBls(d.year, d.period);
      if (!clave) continue;
      const v = numero(d.value);
      if (v !== null) valores.set(clave, v);
      const doce = numero(d.calculations?.pct_changes?.['12']);
      if (doce !== null) anuales.set(clave, doce);
    }
    resultado.set(serie.seriesID, valores);
    resultado.set(`${serie.seriesID}#12m`, anuales);
  }
  return resultado;
}

export async function consultarBls(series: string[], anioInicio: number, anioFin: number, llave: string): Promise<Map<string, Observaciones>> {
  const cuerpo = {
    seriesid: series,
    startyear: String(anioInicio),
    endyear: String(anioFin),
    calculations: true,
    registrationkey: llave,
  };
  const respuesta = await obtenerJson<RespuestaBls>(URL_BLS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
  return leerRespuestaBls(respuesta);
}
