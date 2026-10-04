// Cuándo consultar cada evento y en qué estado se muestra.

import type { FilaCalendario } from './calendario.ts';
import { finDelDiaCdmx, horaCdmx, instanteCdmx, MINUTO, sumarDias } from './tiempo.ts';

/** Minutos de consulta cada minuto desde la hora de publicación. */
export const MINUTOS_CADA_MINUTO = 45;
/** Días después de la publicación en que se sigue reintentando un dato retrasado. */
export const DIAS_DE_REINTENTO = 30;

export type Fase = 'antes' | 'cada-minuto' | 'cada-15' | 'cada-hora' | 'cada-6-horas' | 'fin';

export interface Ventanas {
  /** Hora de publicación, o 6:00 si el evento no tiene hora. */
  inicio: Date;
  /** Fin de la consulta cada minuto (solo eventos con hora). */
  finCadaMinuto: Date | null;
  /** Desde aquí el evento está "Retrasado": 23:59 con hora, 20:00 sin hora. */
  finEspera: Date;
  /** Fin de los reintentos cada hora (el día siguiente). */
  finCadaHora: Date;
  /** Fin de todos los reintentos. */
  fin: Date;
}

type FilaConHorario = Pick<FilaCalendario, 'fecha' | 'hora'>;

export function ventanas(fila: FilaConHorario): Ventanas {
  const finCadaHora = finDelDiaCdmx(sumarDias(fila.fecha, 1));
  const fin = finDelDiaCdmx(sumarDias(fila.fecha, DIAS_DE_REINTENTO));
  if (fila.hora) {
    const inicio = instanteCdmx(fila.fecha, fila.hora);
    return {
      inicio,
      finCadaMinuto: new Date(inicio.getTime() + MINUTOS_CADA_MINUTO * MINUTO),
      finEspera: finDelDiaCdmx(fila.fecha),
      finCadaHora,
      fin,
    };
  }
  return {
    inicio: instanteCdmx(fila.fecha, '06:00'),
    finCadaMinuto: null,
    // La consulta de las 20:00 todavía cuenta como parte del día.
    finEspera: new Date(instanteCdmx(fila.fecha, '20:00').getTime() + MINUTO),
    finCadaHora,
    fin,
  };
}

export function faseConsulta(fila: FilaConHorario, ahora: Date): Fase {
  const v = ventanas(fila);
  const t = ahora.getTime();
  if (t < v.inicio.getTime()) return 'antes';
  if (v.finCadaMinuto && t < v.finCadaMinuto.getTime()) return 'cada-minuto';
  if (t < v.finEspera.getTime()) return 'cada-15';
  if (t < v.finCadaHora.getTime()) return 'cada-hora';
  if (t < v.fin.getTime()) return 'cada-6-horas';
  return 'fin';
}

/** Si en la corrida programada para el minuto `ahora` toca consultar este evento. */
export function tocaConsultar(fila: FilaConHorario, ahora: Date): boolean {
  const minuto = ahora.getUTCMinutes();
  switch (faseConsulta(fila, ahora)) {
    case 'cada-minuto':
      return true;
    case 'cada-15':
      return minuto % 15 === 0;
    case 'cada-hora':
      return minuto === 0;
    case 'cada-6-horas':
      return minuto === 0 && horaCdmx(ahora) % 6 === 0;
    default:
      return false;
  }
}

/** Horas del centro en que se completa el dato anterior de los eventos de los próximos días (minuto 0). */
export const HORAS_DE_ANTERIORES = [5, 20, 21, 22];

export function tocaRevisarAnteriores(ahora: Date): boolean {
  return ahora.getUTCMinutes() === 0 && HORAS_DE_ANTERIORES.includes(horaCdmx(ahora));
}

export type EstadoVisible = 'pendiente' | 'esperando' | 'publicado' | 'retrasado' | 'sin-fuente';

/** Momento desde el que un evento sin valores (minutas, informes) se considera publicado. */
export function publicadoDesde(fila: FilaConHorario): Date {
  return fila.hora ? instanteCdmx(fila.fecha, fila.hora) : finDelDiaCdmx(fila.fecha);
}

/**
 * Estado que ve el usuario. `consultable` indica si el evento tiene una fuente automática
 * en la configuración actual (por ejemplo, ISM no la tiene en modo oficial).
 */
export function estadoVisible(
  fila: Pick<FilaCalendario, 'fecha' | 'hora' | 'tipo'>,
  tieneReal: boolean,
  consultable: boolean,
  ahora: Date,
): EstadoVisible {
  if (tieneReal) return 'publicado';
  const t = ahora.getTime();
  if (fila.tipo === 'evento') return t < publicadoDesde(fila).getTime() ? 'pendiente' : 'publicado';
  const v = ventanas(fila);
  if (t < v.inicio.getTime()) return 'pendiente';
  if (!consultable) return 'sin-fuente';
  return t < v.finEspera.getTime() ? 'esperando' : 'retrasado';
}
