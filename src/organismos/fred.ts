// FRED (Banco de la Reserva Federal de St. Louis): solo como respaldo cuando falla la fuente primaria.

import { ErrorFuente, obtener, sanitizar } from '../red.ts';
import type { Observaciones } from './tipos.ts';

export const URL_FRED = 'https://api.stlouisfed.org/fred/series/observations';

export type FrecuenciaFred = 'mes' | 'trimestre' | 'dia';

/** "2026-09-01" → "2026-09" (mensual), "2026-07-01" → "2026-T3" (trimestral) o la fecha tal cual (diaria). */
export function periodoFred(fecha: string, frecuencia: FrecuenciaFred): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  if (!m) return null;
  if (frecuencia === 'dia') return fecha;
  if (frecuencia === 'mes') return `${m[1]}-${m[2]}`;
  return `${m[1]}-T${Math.floor((Number(m[2]) - 1) / 3) + 1}`;
}

export function leerFred(r: { observations?: { date: string; value: string }[] }, frecuencia: FrecuenciaFred): Observaciones {
  if (!Array.isArray(r.observations)) throw new ErrorFuente('FRED: respuesta inválida');
  const obs: Observaciones = new Map();
  for (const o of r.observations) {
    const periodo = periodoFred(o.date, frecuencia);
    const valor = o.value === '.' ? Number.NaN : Number(o.value);
    if (periodo && Number.isFinite(valor)) obs.set(periodo, valor);
  }
  return obs;
}

export async function consultarFred(serie: string, frecuencia: FrecuenciaFred, desde: string, llave: string): Promise<Observaciones> {
  const url = new URL(URL_FRED);
  url.search = new URLSearchParams({ series_id: serie, api_key: llave, file_type: 'json', observation_start: desde }).toString();
  const respuesta = await obtener(url).catch((e: Error) => {
    throw new ErrorFuente(sanitizar(`FRED ${serie}: ${e.message}`));
  });
  return leerFred((await respuesta.json()) as { observations?: { date: string; value: string }[] }, frecuencia);
}
