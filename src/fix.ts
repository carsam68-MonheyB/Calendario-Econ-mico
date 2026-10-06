// Tipo de cambio FIX de Banxico (pesos por dólar). Se consulta una vez al día y la página lo muestra
// en la barra superior. Es la tasa de referencia oficial, no un precio de compra o venta.

import type { Almacen } from './almacen.ts';
import { VARIABLES_DE_LLAVES, type Configuracion } from './config.ts';
import { consultarSie } from './organismos/banxico.ts';
import { ErrorFuente, sanitizar } from './red.ts';
import { fechaCdmx, horaCdmx, sumarDias } from './tiempo.ts';

export const SERIE_FIX = 'SF43718';
export const URL_FIX = 'https://www.banxico.org.mx/tipcamb/main.do?page=tip&idioma=sp';
/** Horas del centro en que se busca el FIX del día: Banxico lo determina a las 12:00. */
export const HORAS_FIX = { desde: 12, hasta: 20 };

export interface DatoFix {
  fecha: string;
  valor: number;
}

export interface Fix {
  version: 1;
  /** FIX más reciente publicado. */
  actual: DatoFix | null;
  /** FIX del día hábil anterior, para mostrar el cambio. */
  anterior: DatoFix | null;
  fuente: 'Banxico';
  url: string;
  obtenido: string | null;
  ultimoError: { fecha: string; mensaje: string } | null;
}

export const fixVacio = (): Fix => ({ version: 1, actual: null, anterior: null, fuente: 'Banxico', url: URL_FIX, obtenido: null, ultimoError: null });

function diaHabilCdmx(fecha: string): boolean {
  const dia = new Date(`${fecha}T00:00:00Z`).getUTCDay();
  return dia >= 1 && dia <= 5;
}

/**
 * Sin FIX guardado se intenta en cuanto se pueda (cada 15 minutos). Con el de un día anterior, en días
 * hábiles de 12:00 a 20:00 del centro cada 30 minutos, hasta que llegue el de hoy.
 */
export function tocaRevisarFix(fix: Fix | null, ahora: Date): boolean {
  const minuto = ahora.getUTCMinutes();
  if (!fix?.actual) return minuto % 15 === 0;
  const hoy = fechaCdmx(ahora);
  if (fix.actual.fecha >= hoy || !diaHabilCdmx(hoy)) return false;
  const hora = horaCdmx(ahora);
  return hora >= HORAS_FIX.desde && hora <= HORAS_FIX.hasta && minuto % 30 === 0;
}

export type ResultadoFix = 'omitido' | 'sin cambio' | 'actualizado' | 'error';

/** Consulta la serie diaria del SIE y guarda el FIX solo si cambió (o si cambió el estado de error). */
export async function revisarFix(config: Configuracion, almacen: Almacen, ahora: Date): Promise<ResultadoFix> {
  // Las dos reglas de tocaRevisarFix caen en múltiplos de 15: así no se lee Blobs cada minuto.
  if (ahora.getUTCMinutes() % 15 !== 0) return 'omitido';
  const fix = (await almacen.leerFix()) ?? fixVacio();
  if (!tocaRevisarFix(fix, ahora)) return 'omitido';
  try {
    const token = config.llaves.banxico;
    if (!token) throw new ErrorFuente(`Falta la variable ${VARIABLES_DE_LLAVES.banxico}`);
    const hoy = fechaCdmx(ahora);
    const series = await consultarSie({ [SERIE_FIX]: 'dia' }, sumarDias(hoy, -10), hoy, token);
    const obs = [...(series.get(SERIE_FIX) ?? new Map<string, number>())].sort(([a], [b]) => (a < b ? -1 : 1));
    const ultimo = obs.at(-1);
    if (!ultimo) throw new ErrorFuente('Banxico: la serie del FIX no trae datos');
    const actual: DatoFix = { fecha: ultimo[0], valor: ultimo[1] };
    const penultimo = obs.at(-2);
    const anterior: DatoFix | null = penultimo ? { fecha: penultimo[0], valor: penultimo[1] } : fix.anterior;
    const cambio = fix.actual?.fecha !== actual.fecha || fix.actual.valor !== actual.valor;
    if (!cambio && !fix.ultimoError) return 'sin cambio';
    await almacen.guardarFix({ ...fix, actual, anterior, url: URL_FIX, obtenido: ahora.toISOString(), ultimoError: null });
    return cambio ? 'actualizado' : 'sin cambio';
  } catch (e) {
    const mensaje = e instanceof ErrorFuente ? e.message : sanitizar((e as Error).message);
    if (fix.ultimoError?.mensaje !== mensaje) await almacen.guardarFix({ ...fix, ultimoError: { fecha: ahora.toISOString(), mensaje } });
    return 'error';
  }
}
