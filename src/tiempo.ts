// Conversión entre la hora del centro de México (UTC−6, sin horario de verano) y UTC.

const DESFASE_HORAS = 6;
export const MINUTO = 60_000;
export const HORA = 60 * MINUTO;
export const DIA = 24 * HORA;

function partes(texto: string, separador: string, cuantas: number): number[] {
  const numeros = texto.split(separador).map(Number);
  if (numeros.length !== cuantas || numeros.some((n) => !Number.isInteger(n))) {
    throw new Error(`Formato inválido: ${texto}`);
  }
  return numeros;
}

/** Instante (UTC) que corresponde a una fecha y hora del centro de México. */
export function instanteCdmx(fecha: string, hora = '00:00'): Date {
  const [a = 0, m = 1, d = 1] = partes(fecha, '-', 3);
  const [h = 0, min = 0] = partes(hora, ':', 2);
  return new Date(Date.UTC(a, m - 1, d, h + DESFASE_HORAS, min));
}

/** Fecha (AAAA-MM-DD) en el centro de México para un instante. */
export function fechaCdmx(instante: Date): string {
  return new Date(instante.getTime() - DESFASE_HORAS * HORA).toISOString().slice(0, 10);
}

/** Hora (0-23) en el centro de México para un instante. */
export function horaCdmx(instante: Date): number {
  return new Date(instante.getTime() - DESFASE_HORAS * HORA).getUTCHours();
}

export function sumarDias(fecha: string, dias: number): string {
  const [a = 0, m = 1, d = 1] = partes(fecha, '-', 3);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

/** Primer instante del día siguiente en el centro de México: el día termina justo antes. */
export function finDelDiaCdmx(fecha: string): Date {
  return instanteCdmx(sumarDias(fecha, 1));
}
