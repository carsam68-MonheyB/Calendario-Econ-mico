// Esperado (consenso del mercado): datos guardados, cuándo pedirlo y cómo mezclarlo con el calendario.
// Lo escriben solo la Background Function (modo claude) o la función programada (modo tradingeconomics),
// en su propia llave de Blobs, para no pisar las escrituras de "datos".

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FilaCalendario } from './calendario.ts';
import type { EstadoFuente, EventoGuardado } from './modelo.ts';
import { horaCdmx, fechaCdmx, sumarDias, MINUTO } from './tiempo.ts';

export interface ConsensoEvento {
  valor: number | null;
  fuente: string;
  url: string | null;
  obtenido: string | null;
  intentos: number;
  ultimoIntento: string;
  error: string | null;
}

export interface DatosConsenso {
  version: 1;
  eventos: Record<string, ConsensoEvento>;
  /** Por fuente ("Anthropic", "Trading Economics"): último intento, éxito y error. */
  fuentes: Record<string, EstadoFuente>;
}

export const MAXIMO_INTENTOS = 3;
/** Horas del centro en que se revisa si falta pedir consensos: 20:00 la víspera, reintentos y última oportunidad a las 5:00. */
export const HORAS_DE_REVISION = [20, 21, 22, 5];

export const consensoVacio = (): DatosConsenso => ({ version: 1, eventos: {}, fuentes: {} });

/** Si en esta corrida toca revisar consensos pendientes (una vez por hora en las horas de revisión). */
export function tocaRevisarConsenso(ahora: Date): boolean {
  return ahora.getUTCMinutes() === 0 && HORAS_DE_REVISION.includes(horaCdmx(ahora));
}

/**
 * Eventos a los que hay que pedir el consenso: los de mañana (desde las 20:00 de hoy) y los de hoy que aún
 * no se publican. Se omiten los que ya tienen esperado, los eventos sin valores, los ya resueltos y los
 * que agotaron sus intentos. Un error se reintenta después de una hora.
 */
export function eventosSinConsenso(
  calendario: FilaCalendario[],
  consenso: DatosConsenso | null,
  ahora: Date,
  inicioDe: (fila: FilaCalendario) => Date,
): FilaCalendario[] {
  const hoy = fechaCdmx(ahora);
  const manana = sumarDias(hoy, 1);
  const vispera = horaCdmx(ahora) >= 20;
  return calendario.filter((f) => {
    if (f.tipo === 'evento' || f.esperado !== null) return false;
    const toca = (f.fecha === manana && vispera) || (f.fecha === hoy && inicioDe(f).getTime() > ahora.getTime());
    if (!toca) return false;
    const previo = consenso?.eventos[f.id];
    if (!previo) return true;
    if (previo.error === null) return false; // Resuelto, aunque sea sin consenso claro (valor null).
    if (previo.intentos >= MAXIMO_INTENTOS) return false;
    return ahora.getTime() - Date.parse(previo.ultimoIntento) >= 60 * MINUTO;
  });
}

/** El consenso solo llena un esperado vacío: lo capturado en el CSV o a mano manda. */
export function aplicarConsensos(eventos: EventoGuardado[], consenso: DatosConsenso | null): void {
  if (!consenso) return;
  for (const e of eventos) {
    const c = consenso.eventos[e.id];
    if (e.esperado === null && c && c.valor !== null && c.obtenido) {
      e.esperado = { valor: c.valor, fuente: c.fuente, url: c.url, obtenido: c.obtenido };
    }
  }
}

export function registrarIntento(
  consenso: DatosConsenso,
  id: string,
  ahora: Date,
  resultado: { valor: number | null; fuente: string; url: string | null } | { error: string },
): void {
  const previo = consenso.eventos[id];
  const intentos = (previo?.intentos ?? 0) + 1;
  consenso.eventos[id] =
    'error' in resultado
      ? { valor: null, fuente: '', url: null, obtenido: null, intentos, ultimoIntento: ahora.toISOString(), error: resultado.error }
      : { ...resultado, obtenido: ahora.toISOString(), intentos, ultimoIntento: ahora.toISOString(), error: null };
}

export function registrarFuente(consenso: DatosConsenso, nombre: string, ahora: Date, error: string | null): void {
  const previo = consenso.fuentes[nombre] ?? { ultimoIntento: null, ultimoExito: null, ultimoError: null };
  previo.ultimoIntento = ahora.toISOString();
  if (error === null) previo.ultimoExito = ahora.toISOString();
  else previo.ultimoError = { fecha: ahora.toISOString(), mensaje: error };
  consenso.fuentes[nombre] = previo;
}

/* Firma de la llamada interna a la Background Function, para que nadie más pueda gastar consultas. */

export function firmar(cuerpo: string, marca: string, secreto: string): string {
  return createHmac('sha256', secreto).update(`${marca}.${cuerpo}`).digest('hex');
}

export function firmaValida(cuerpo: string, marca: string | null, firma: string | null, secreto: string, ahora: Date): boolean {
  if (!marca || !firma || !/^[0-9a-f]{64}$/.test(firma)) return false;
  const instante = Number(marca);
  if (!Number.isFinite(instante) || Math.abs(ahora.getTime() - instante) > 10 * MINUTO) return false;
  return timingSafeEqual(Buffer.from(firmar(cuerpo, marca, secreto), 'hex'), Buffer.from(firma, 'hex'));
}
