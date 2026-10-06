// Tipo de cambio intradía USD/MXN (precio de mercado) para la barra superior. Lo pide la página al abrirse
// y cada minuto y medio; la función responde desde un caché en Blobs y solo consulta al proveedor cuando
// el caché venció, así el número de visitantes no multiplica las llamadas.

import type { Almacen } from './almacen.ts';
import { esDesarrolloLocal } from './archivos.ts';
import { VARIABLES_DE_LLAVES, type Configuracion } from './config.ts';
import { ErrorFuente, obtenerJson, sanitizar } from './red.ts';

export const SIMBOLO = 'USD/MXN';
export const URL_TWELVEDATA = 'https://api.twelvedata.com/quote';
export const URL_FUENTE = 'https://twelvedata.com/';
/** Vigencia del caché con el mercado abierto. */
export const VIGENCIA_MS = 120_000;
/** Vigencia con el mercado cerrado (fin de semana): el precio no cambia. */
export const VIGENCIA_CERRADO_MS = 30 * 60_000;
/** Tras un error no se vuelve a intentar antes de este tiempo. */
export const ESPERA_TRAS_ERROR_MS = 60_000;

export interface Mercado {
  version: 1;
  valor: number | null;
  /** Hora en que se consultó el mercado (ISO, UTC). El proveedor fecha la cotización con su vela diaria, no con el momento. */
  hora: string | null;
  cierreAnterior: number | null;
  cambio: { absoluto: number; porcentaje: number } | null;
  abierto: boolean | null;
  fuente: string;
  url: string;
  obtenido: string | null;
  ultimoIntento: string | null;
  ultimoError: { fecha: string; mensaje: string } | null;
}

export const mercadoVacio = (): Mercado => ({
  version: 1,
  valor: null,
  hora: null,
  cierreAnterior: null,
  cambio: null,
  abierto: null,
  fuente: 'Twelve Data',
  url: URL_FUENTE,
  obtenido: null,
  ultimoIntento: null,
  ultimoError: null,
});

/** Campos que usamos de la respuesta de /quote de Twelve Data. */
export interface CotizacionTwelveData {
  symbol?: string;
  close?: string;
  previous_close?: string;
  timestamp?: number;
  datetime?: string;
  is_market_open?: boolean;
  status?: string;
  code?: number;
  message?: string;
}

export interface Cotizacion {
  valor: number;
  hora: string | null;
  cierreAnterior: number | null;
  cambio: { absoluto: number; porcentaje: number } | null;
  abierto: boolean | null;
}

export function leerCotizacion(r: CotizacionTwelveData): Cotizacion {
  if (r.status === 'error' || r.code !== undefined) throw new ErrorFuente(sanitizar(`Twelve Data: ${r.message ?? 'respuesta inválida'}`));
  const valor = Number(r.close);
  if (!Number.isFinite(valor) || valor <= 0) throw new ErrorFuente('Twelve Data: cotización inválida');
  const cierre = Number(r.previous_close);
  const cierreAnterior = Number.isFinite(cierre) && cierre > 0 ? cierre : null;
  const cambio = cierreAnterior
    ? { absoluto: Number((valor - cierreAnterior).toFixed(4)), porcentaje: Number((((valor - cierreAnterior) / cierreAnterior) * 100).toFixed(2)) }
    : null;
  const hora = typeof r.timestamp === 'number' && r.timestamp > 0 ? new Date(r.timestamp * 1000).toISOString() : null;
  return { valor, hora, cierreAnterior, cambio, abierto: typeof r.is_market_open === 'boolean' ? r.is_market_open : null };
}

/** La llave va en el encabezado Authorization, nunca en la URL (que puede quedar en bitácoras). */
export async function consultarTwelveData(llave: string, simbolo = SIMBOLO): Promise<Cotizacion> {
  const base = (esDesarrolloLocal() && process.env.MERCADO_URL) || URL_TWELVEDATA;
  const url = new URL(base);
  url.searchParams.set('symbol', simbolo);
  const r = await obtenerJson<CotizacionTwelveData>(url, { headers: { Authorization: `apikey ${llave}` } });
  return leerCotizacion(r);
}

export function mercadoVigente(m: Mercado, ahora: Date): boolean {
  if (!m.obtenido || m.valor === null) return false;
  const edad = ahora.getTime() - Date.parse(m.obtenido);
  return edad < (m.abierto === false ? VIGENCIA_CERRADO_MS : VIGENCIA_MS);
}

/** Devuelve el mercado para la página. Consulta al proveedor solo si el caché venció. Nunca lanza. */
export async function obtenerMercado(config: Configuracion, almacen: Almacen, ahora: Date): Promise<Mercado> {
  const guardado = (await almacen.leerMercado()) ?? mercadoVacio();
  if (mercadoVigente(guardado, ahora)) return guardado;
  if (guardado.ultimoError && guardado.ultimoIntento && ahora.getTime() - Date.parse(guardado.ultimoIntento) < ESPERA_TRAS_ERROR_MS) return guardado;
  const intento = ahora.toISOString();
  try {
    const llave = config.llaves.twelvedata;
    if (!llave) throw new ErrorFuente(`Falta la variable ${VARIABLES_DE_LLAVES.twelvedata}`);
    const c = await consultarTwelveData(llave);
    const nuevo: Mercado = {
      ...guardado,
      valor: c.valor,
      hora: intento,
      cierreAnterior: c.cierreAnterior,
      cambio: c.cambio,
      abierto: c.abierto,
      url: URL_FUENTE,
      obtenido: intento,
      ultimoIntento: intento,
      ultimoError: null,
    };
    await almacen.guardarMercado(nuevo);
    return nuevo;
  } catch (e) {
    const mensaje = e instanceof ErrorFuente ? e.message : sanitizar((e as Error).message);
    const nuevo: Mercado = { ...guardado, ultimoIntento: intento, ultimoError: { fecha: intento, mensaje } };
    await almacen.guardarMercado(nuevo);
    return nuevo;
  }
}

/** Respuesta de GET /api/tipo-cambio. */
export function respuestaMercado(m: Mercado) {
  return {
    disponible: m.valor !== null,
    simbolo: SIMBOLO,
    valor: m.valor,
    hora: m.hora,
    cierreAnterior: m.cierreAnterior,
    cambio: m.cambio,
    abierto: m.abierto,
    fuente: m.fuente,
    url: m.url,
    obtenido: m.obtenido,
    error: m.ultimoError?.mensaje ?? null,
  };
}
