// Decisión de la Fed: se lee del comunicado oficial publicado el día de la reunión.

import { ErrorFuente, obtenerTexto } from '../red.ts';
import type { Observaciones } from './tipos.ts';

export function urlComunicadoFed(fecha: string): string {
  return `https://www.federalreserve.gov/newsevents/pressreleases/monetary${fecha.replaceAll('-', '')}a.htm`;
}

function aNumero(texto: string): number {
  // "3-3/4" → 3.75; "4" → 4.
  const [entero, fraccion] = texto.split('-');
  let valor = Number(entero);
  if (fraccion) {
    const [n, d] = fraccion.split('/').map(Number);
    valor += (n ?? 0) / (d ?? 1);
  }
  return valor;
}

/** Límite superior del rango objetivo, por ejemplo "…at 3-3/4 to 4 percent" → 4. */
export function limiteSuperiorFed(html: string): number | null {
  const texto = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&#8208;|&#8209;|&#8211;|[‐‑‒–]/g, '-')
    .replace(/\s+/g, ' ');
  const m = /target range for the federal funds rate[^.]{0,160}?\b(?:at|to)\s+(\d{1,2}(?:-\d\/\d)?)\s+to\s+(\d{1,2}(?:-\d\/\d)?)\s+percent/i.exec(texto);
  if (!m) return null;
  const superior = aNumero(m[2]!);
  return Number.isFinite(superior) && superior >= 0 && superior < 25 ? superior : null;
}

/** Para cada fecha de reunión, el límite superior si el comunicado ya está publicado. */
export async function consultarFed(fechas: string[]): Promise<Observaciones> {
  const obs: Observaciones = new Map();
  await Promise.all(
    fechas.map(async (fecha) => {
      let html: string;
      try {
        html = await obtenerTexto(urlComunicadoFed(fecha));
      } catch (e) {
        // Antes de las 14:00 ET la página no existe: no es un error, el dato aún no sale.
        if (e instanceof ErrorFuente && e.message === 'HTTP 404') return;
        throw e;
      }
      const valor = limiteSuperiorFed(html);
      if (valor === null) throw new ErrorFuente('Fed: no se encontró el rango objetivo en el comunicado');
      obs.set(fecha, valor);
    }),
  );
  return obs;
}
