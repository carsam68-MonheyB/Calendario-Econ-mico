// INEGI, API de Indicadores (Banco de Información Económica, fuente BIE-BISE).

import { ErrorFuente, obtenerJson, sanitizar } from '../red.ts';
import type { Observaciones } from './tipos.ts';

export const URL_INEGI = 'https://www.inegi.org.mx/app/api/indicadores/desarrolladores/jsonxml/INDICATOR/';
/** El constructor de consultas de INEGI admite hasta 10 indicadores por llamada. */
export const MAXIMO_POR_LLAMADA = 10;

interface SerieInegi {
  INDICADOR?: string;
  FREQ?: string;
  OBSERVATIONS?: { TIME_PERIOD?: string; OBS_VALUE?: string | null }[];
}
interface RespuestaInegi {
  Series?: SerieInegi[];
  ErrorInfo?: string;
  ErrorDetails?: string;
}

/**
 * TIME_PERIOD según la frecuencia: mensual "2026/08" → "2026-08"; trimestral "2026/02" → "2026-T2";
 * quincenal "2026/09/01" → "2026-09-Q1".
 */
export function periodoInegi(texto: string | undefined, frecuencia: string | undefined): string | null {
  const t = texto?.trim() ?? '';
  const quincena = /^(\d{4})\/(\d{2})\/0?([12])$/.exec(t);
  if (quincena) return `${quincena[1]}-${quincena[2]}-Q${quincena[3]}`;
  const m = /^(\d{4})\/(\d{2})$/.exec(t);
  if (!m) return null;
  if (frecuencia === '4') {
    const n = Number(m[2]);
    return n >= 1 && n <= 4 ? `${m[1]}-T${n}` : null;
  }
  return Number(m[2]) >= 1 && Number(m[2]) <= 12 ? `${m[1]}-${m[2]}` : null;
}

export function leerInegi(r: RespuestaInegi): Map<string, Observaciones> {
  if (!Array.isArray(r.Series)) throw new ErrorFuente(sanitizar(`INEGI: ${r.ErrorInfo ?? 'respuesta inválida'}`));
  const resultado = new Map<string, Observaciones>();
  for (const serie of r.Series) {
    if (!serie.INDICADOR) continue;
    const obs: Observaciones = new Map();
    for (const o of serie.OBSERVATIONS ?? []) {
      const periodo = periodoInegi(o.TIME_PERIOD, serie.FREQ);
      const texto = o.OBS_VALUE?.replace(/,/g, '').trim();
      const valor = texto ? Number(texto) : Number.NaN;
      if (periodo && Number.isFinite(valor)) obs.set(periodo, valor);
    }
    resultado.set(serie.INDICADOR, obs);
  }
  return resultado;
}

async function consultarGrupo(ids: string[], token: string): Promise<Map<string, Observaciones>> {
  const url = `${URL_INEGI}${ids.join(',')}/es/00/false/BIE-BISE/2.0/${encodeURIComponent(token)}?type=json`;
  return leerInegi(await obtenerJson<RespuestaInegi>(url));
}

/** Consulta los indicadores en grupos de hasta 10, en paralelo. */
export async function consultarInegi(ids: string[], token: string): Promise<Map<string, Observaciones>> {
  const grupos: string[][] = [];
  for (let i = 0; i < ids.length; i += MAXIMO_POR_LLAMADA) grupos.push(ids.slice(i, i + MAXIMO_POR_LLAMADA));
  const resultados = await Promise.all(grupos.map((g) => consultarGrupo(g, token)));
  return new Map(resultados.flatMap((m) => [...m]));
}
