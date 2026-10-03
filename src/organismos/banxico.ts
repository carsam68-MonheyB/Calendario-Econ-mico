// Banxico: API del SIE (series) y anuncios de política monetaria.

import { ErrorFuente, obtener, obtenerJson, sanitizar } from '../red.ts';
import type { Observaciones } from './tipos.ts';

export const URL_SIE = 'https://www.banxico.org.mx/SieAPIRest/service/v1/series/';
export const URL_ANUNCIOS =
  'https://www.banxico.org.mx/publicaciones-y-prensa/anuncios-de-las-decisiones-de-politica-monetaria/anuncios-politica-monetaria-t.html';
export const SERIE_TASA_OBJETIVO = 'SF61745';

interface RespuestaSie {
  bmx?: { series?: { idSerie?: string; datos?: { fecha?: string; dato?: string }[] }[] };
  error?: { mensaje?: string; detalle?: string };
}

export type FrecuenciaSie = 'mes' | 'dia';

/** "01/08/2026" → "2026-08" (mensual) o "2026-08-01" (diaria). */
export function periodoSie(fecha: string | undefined, frecuencia: FrecuenciaSie): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(fecha?.trim() ?? '');
  if (!m) return null;
  return frecuencia === 'mes' ? `${m[3]}-${m[2]}` : `${m[3]}-${m[2]}-${m[1]}`;
}

export function leerSie(r: RespuestaSie, frecuencias: Record<string, FrecuenciaSie>): Map<string, Observaciones> {
  if (!r.bmx?.series) throw new ErrorFuente(sanitizar(`Banxico: ${r.error?.mensaje ?? 'respuesta inválida'}`));
  const resultado = new Map<string, Observaciones>();
  for (const serie of r.bmx.series) {
    if (!serie.idSerie) continue;
    const frecuencia = frecuencias[serie.idSerie] ?? 'mes';
    const obs: Observaciones = new Map();
    for (const d of serie.datos ?? []) {
      const periodo = periodoSie(d.fecha, frecuencia);
      const texto = d.dato?.replace(/,/g, '').trim();
      const valor = texto && texto !== 'N/E' ? Number(texto) : Number.NaN;
      if (periodo && Number.isFinite(valor)) obs.set(periodo, valor);
    }
    resultado.set(serie.idSerie, obs);
  }
  return resultado;
}

/** Datos de varias series entre dos fechas (AAAA-MM-DD). El token va en el encabezado Bmx-Token. */
export async function consultarSie(
  frecuencias: Record<string, FrecuenciaSie>,
  desde: string,
  hasta: string,
  token: string,
): Promise<Map<string, Observaciones>> {
  const ids = Object.keys(frecuencias).join(',');
  const r = await obtenerJson<RespuestaSie>(`${URL_SIE}${ids}/datos/${desde}/${hasta}`, {
    headers: { 'Bmx-Token': token, Accept: 'application/json' },
  });
  return leerSie(r, frecuencias);
}

export interface AnuncioBanxico {
  fecha: string;
  titulo: string;
  url: string | null;
}

const decodificarEntidades = (t: string) =>
  t.replace(/&nbsp;/g, ' ').replace(/&aacute;/g, 'á').replace(/&eacute;/g, 'é').replace(/&iacute;/g, 'í')
    .replace(/&oacute;/g, 'ó').replace(/&uacute;/g, 'ú').replace(/&amp;/g, '&');

/** Lista de anuncios: cada renglón trae la fecha (dd/mm/aa), el título y el enlace al PDF. */
export function leerAnuncios(html: string): AnuncioBanxico[] {
  const anuncios: AnuncioBanxico[] = [];
  const patron = /(\d{2})\/(\d{2})\/(\d{2})\b([\s\S]{0,1500}?)<a\s[^>]*href="([^"]+\.pdf)"/gi;
  for (const m of html.matchAll(patron)) {
    const titulo = decodificarEntidades(m[4]!.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (!/tasa objetivo|tasa de inter/i.test(titulo)) continue;
    anuncios.push({
      fecha: `20${m[3]}-${m[2]}-${m[1]}`,
      titulo,
      url: new URL(m[5]!, 'https://www.banxico.org.mx').toString(),
    });
  }
  return anuncios;
}

/**
 * Interpreta el título del anuncio. Si da el nivel ("…sin cambio en 6.50 por ciento") lo devuelve;
 * si da el movimiento ("…disminuye en 25 puntos base") lo aplica a la tasa vigente el día del anuncio.
 */
export function tasaDesdeTitulo(titulo: string, tasaVigente: number | null): number | null {
  const nivel = /\ben\s+(\d{1,2}(?:\.\d{1,2})?)\s*(?:por\s*ciento|%)/i.exec(titulo);
  if (nivel) return Number(nivel[1]);
  const movimiento = /\b(disminu|reduc|recort|baj|aument|increment|elev|sub)\w*\s+en\s+(\d{1,3})\s+puntos\s+base/i.exec(titulo);
  if (!movimiento || tasaVigente === null) return null;
  const pb = Number(movimiento[2]) / 100;
  const baja = /^(disminu|reduc|recort|baj)/i.test(movimiento[1]!);
  return Math.round((baja ? tasaVigente - pb : tasaVigente + pb) * 100) / 100;
}

export async function consultarAnuncios(): Promise<AnuncioBanxico[]> {
  // La página está en ISO-8859-1. Con "Accept: text/html" a secas el servidor responde 406;
  // con el Accept genérico de obtener() responde bien.
  const respuesta = await obtener(URL_ANUNCIOS);
  const html = new TextDecoder('windows-1252').decode(await respuesta.arrayBuffer());
  return leerAnuncios(html);
}
