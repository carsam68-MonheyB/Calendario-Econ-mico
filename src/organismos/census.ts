// Census API, indicadores económicos (EITS): ventas minoristas (marts) y comercio exterior (ftd).

import { ErrorFuente, obtener } from '../red.ts';
import type { Observaciones } from './tipos.ts';

export const URL_CENSUS = 'https://api.census.gov/data/timeseries/eits/';

export interface SerieCensus {
  conjunto: 'marts' | 'ftd';
  categoria: string;
  tipoDato: string;
  ajustada: boolean;
}

export const claveCensus = (s: SerieCensus) => `${s.conjunto}:${s.categoria}:${s.tipoDato}:${s.ajustada ? 'sa' : 'nsa'}`;

/** La respuesta es una tabla: la primera fila trae los nombres de las columnas. */
export function leerEits(tabla: unknown): Observaciones {
  if (!Array.isArray(tabla) || !Array.isArray(tabla[0])) throw new ErrorFuente('Census: respuesta inválida');
  const [encabezado, ...filas] = tabla as string[][];
  const iValor = encabezado!.indexOf('cell_value');
  const iTiempo = encabezado!.indexOf('time');
  if (iValor < 0 || iTiempo < 0) throw new ErrorFuente('Census: faltan columnas en la respuesta');
  const obs: Observaciones = new Map();
  for (const fila of filas) {
    const periodo = /^\d{4}-\d{2}$/.test(fila[iTiempo] ?? '') ? fila[iTiempo]! : null;
    const texto = fila[iValor]?.replace(/,/g, '').trim();
    const valor = texto ? Number(texto) : Number.NaN;
    if (periodo && Number.isFinite(valor) && !obs.has(periodo)) obs.set(periodo, valor);
  }
  return obs;
}

export async function consultarEits(serie: SerieCensus, desde: string, llave: string): Promise<Observaciones> {
  const url = new URL(`${URL_CENSUS}${serie.conjunto}`);
  url.search = new URLSearchParams({
    get: 'cell_value,time_slot_id',
    category_code: serie.categoria,
    data_type_code: serie.tipoDato,
    seasonally_adj: serie.ajustada ? 'yes' : 'no',
    time: `from ${desde}`,
    key: llave,
  }).toString();
  // Sin llave válida Census redirige a una página HTML; se detecta antes de seguirla.
  const respuesta = await obtener(url, { redirect: 'manual' });
  if (respuesta.status >= 300 && respuesta.status < 400) {
    await respuesta.body?.cancel().catch(() => {});
    throw new ErrorFuente('Census: la llave falta o no es válida');
  }
  if (respuesta.status === 204) return new Map();
  let tabla: unknown;
  try {
    tabla = await respuesta.json();
  } catch {
    throw new ErrorFuente('Census: respuesta que no es JSON');
  }
  return leerEits(tabla);
}
