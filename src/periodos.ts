// Periodo de referencia de cada evento y su comparación con la fecha de observación de las fuentes.

import type { FilaCalendario } from './calendario.ts';
import { indicadorDe } from './indicadores.ts';

export type Periodo =
  | { tipo: 'mes'; anio: number; mes: number }
  | { tipo: 'trimestre'; anio: number; trimestre: number }
  | { tipo: 'quincena'; anio: number; mes: number; quincena: 1 | 2 }
  | { tipo: 'dia'; fecha: string };

const MESES: Record<string, number> = {
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, sept: 9, oct: 10, nov: 11, dic: 12,
};

const dos = (n: number) => String(n).padStart(2, '0');

/** Llave de texto del periodo: "2026-09", "2026-T3", "2026-10-Q1" o "2026-10-28". */
export function clavePeriodo(p: Periodo): string {
  switch (p.tipo) {
    case 'mes':
      return `${p.anio}-${dos(p.mes)}`;
    case 'trimestre':
      return `${p.anio}-T${p.trimestre}`;
    case 'quincena':
      return `${p.anio}-${dos(p.mes)}-Q${p.quincena}`;
    case 'dia':
      return p.fecha;
  }
}

/** El mismo periodo un año antes (para variaciones anuales). */
export function anioAnterior(p: Periodo): Periodo {
  if (p.tipo === 'dia') return { tipo: 'dia', fecha: `${Number(p.fecha.slice(0, 4)) - 1}${p.fecha.slice(4)}` };
  return { ...p, anio: p.anio - 1 };
}

/** El periodo inmediato anterior (mes, trimestre o quincena). */
export function periodoAnterior(p: Periodo): Periodo {
  switch (p.tipo) {
    case 'mes':
      return p.mes === 1 ? { tipo: 'mes', anio: p.anio - 1, mes: 12 } : { tipo: 'mes', anio: p.anio, mes: p.mes - 1 };
    case 'trimestre':
      return p.trimestre === 1
        ? { tipo: 'trimestre', anio: p.anio - 1, trimestre: 4 }
        : { tipo: 'trimestre', anio: p.anio, trimestre: p.trimestre - 1 };
    case 'quincena':
      if (p.quincena === 2) return { ...p, quincena: 1 };
      return p.mes === 1
        ? { tipo: 'quincena', anio: p.anio - 1, mes: 12, quincena: 2 }
        : { tipo: 'quincena', anio: p.anio, mes: p.mes - 1, quincena: 2 };
    case 'dia':
      throw new Error('Un periodo diario no tiene periodo anterior.');
  }
}

/**
 * Periodo de referencia de un evento. El año se deduce de la fecha de publicación:
 * es el periodo más reciente con ese nombre que termina antes de publicarse.
 */
export function periodoDeEvento(fila: Pick<FilaCalendario, 'fecha' | 'periodo' | 'tipo' | 'pais' | 'indicador'>): Periodo | null {
  if (fila.tipo === 'evento') return null;
  if (fila.tipo === 'tasa') return { tipo: 'dia', fecha: fila.fecha };

  const anioEvento = Number(fila.fecha.slice(0, 4));
  const mesEvento = Number(fila.fecha.slice(5, 7));
  const texto = fila.periodo.trim().toLowerCase();

  const trimestre = /^([1-4])t$/.exec(texto);
  if (trimestre) {
    const t = Number(trimestre[1]);
    const trimestreEvento = Math.ceil(mesEvento / 3);
    return { tipo: 'trimestre', anio: t < trimestreEvento ? anioEvento : anioEvento - 1, trimestre: t };
  }

  const mes = MESES[texto];
  if (mes === undefined) return null;
  const anio = mes <= mesEvento ? anioEvento : anioEvento - 1;
  if (indicadorDe(fila).clave.endsWith('-1q')) return { tipo: 'quincena', anio, mes, quincena: 1 };
  return { tipo: 'mes', anio, mes };
}
