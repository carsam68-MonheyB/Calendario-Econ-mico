// BEA API: tablas NIPA (PIB, PCE) y transacciones internacionales (cuenta corriente).

import { ErrorFuente, obtenerJson, sanitizar } from '../red.ts';
import type { Observaciones } from './tipos.ts';

export const URL_BEA = 'https://apps.bea.gov/api/data';

interface FilaBea {
  SeriesCode?: string;
  LineNumber?: string;
  Indicator?: string;
  AreaOrCountry?: string;
  TimePeriod?: string;
  DataValue?: string;
}
interface ErrorBea {
  APIErrorCode?: string;
  APIErrorDescription?: string;
}
interface ResultadosBea {
  Data?: FilaBea[];
  Notes?: { NoteRef?: string; NoteText?: string }[];
  Error?: ErrorBea;
}
interface RespuestaBea {
  BEAAPI?: { Results?: ResultadosBea | ResultadosBea[]; Error?: ErrorBea };
}

const MESES_EN: Record<string, string> = {
  january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
  july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
};

/** "2026Q2" → "2026-T2"; "2026M08" → "2026-08". */
export function periodoBea(texto: string | undefined): string | null {
  const t = texto?.trim() ?? '';
  const trimestre = /^(\d{4})Q([1-4])$/.exec(t);
  if (trimestre) return `${trimestre[1]}-T${trimestre[2]}`;
  const mes = /^(\d{4})M(0[1-9]|1[0-2])$/.exec(t);
  if (mes) return `${mes[1]}-${mes[2]}`;
  return null;
}

/** Fecha de la última revisión de la tabla según sus notas ("LastRevised: November 25, 2026"). */
export function fechaDeRevision(notas: ResultadosBea['Notes']): string | null {
  for (const nota of notas ?? []) {
    const m = /Last\s*Revised(?:\s+on)?:?\s*([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/i.exec(nota.NoteText ?? '');
    const mes = m ? MESES_EN[m[1]!.toLowerCase()] : undefined;
    if (m && mes) return `${m[3]}-${mes}-${m[2]!.padStart(2, '0')}`;
  }
  return null;
}

function resultados(r: RespuestaBea): ResultadosBea {
  const crudo = r.BEAAPI?.Results;
  const res = Array.isArray(crudo) ? crudo[0] : crudo;
  const error = res?.Error ?? r.BEAAPI?.Error;
  if (error) throw new ErrorFuente(sanitizar(`BEA: ${error.APIErrorDescription ?? `error ${error.APIErrorCode ?? ''}`}`));
  if (!res) throw new ErrorFuente('BEA: respuesta inválida');
  return res;
}

function numero(texto: string | undefined): number | null {
  const limpio = texto?.replace(/,/g, '').trim();
  if (!limpio || !/^-?\d/.test(limpio)) return null;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

/** Lee una tabla NIPA. Cada serie queda como "<tabla>:<SeriesCode>". */
export function leerNipa(tabla: string, r: RespuestaBea): { series: Map<string, Observaciones>; revisado: string | null } {
  const res = resultados(r);
  const series = new Map<string, Observaciones>();
  for (const fila of res.Data ?? []) {
    const periodo = periodoBea(fila.TimePeriod);
    const valor = numero(fila.DataValue);
    if (!periodo || valor === null || !fila.SeriesCode) continue;
    const clave = `${tabla}:${fila.SeriesCode}`;
    if (!series.has(clave)) series.set(clave, new Map());
    series.get(clave)!.set(periodo, valor);
  }
  return { series, revisado: fechaDeRevision(res.Notes) };
}

/** Lee transacciones internacionales. Cada indicador queda como "ITA:<Indicator>" en millones de dólares. */
export function leerIta(r: RespuestaBea): Map<string, Observaciones> {
  const res = resultados(r);
  const series = new Map<string, Observaciones>();
  for (const fila of res.Data ?? []) {
    const periodo = periodoBea(fila.TimePeriod);
    const valor = numero(fila.DataValue);
    if (!periodo || valor === null || !fila.Indicator) continue;
    if (fila.AreaOrCountry && fila.AreaOrCountry !== 'AllCountries') continue;
    const clave = `ITA:${fila.Indicator}`;
    if (!series.has(clave)) series.set(clave, new Map());
    series.get(clave)!.set(periodo, valor);
  }
  return series;
}

export async function consultarNipa(tabla: string, frecuencia: 'Q' | 'M', anios: number[], llave: string) {
  const url = new URL(URL_BEA);
  url.search = new URLSearchParams({
    UserID: llave,
    method: 'GetData',
    DataSetName: 'NIPA',
    TableName: tabla,
    Frequency: frecuencia,
    Year: anios.join(','),
    ResultFormat: 'JSON',
  }).toString();
  return leerNipa(tabla, await obtenerJson<RespuestaBea>(url));
}

export async function consultarIta(indicadores: string[], anios: number[], llave: string) {
  const url = new URL(URL_BEA);
  url.search = new URLSearchParams({
    UserID: llave,
    method: 'GetData',
    DataSetName: 'ITA',
    Indicator: indicadores.join(','),
    AreaOrCountry: 'AllCountries',
    Frequency: 'QSA',
    Year: anios.join(','),
    ResultFormat: 'JSON',
  }).toString();
  return leerIta(await obtenerJson<RespuestaBea>(url));
}
