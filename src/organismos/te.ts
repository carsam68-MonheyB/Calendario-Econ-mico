// Trading Economics: calendario de México y Estados Unidos (modo de pago).
// El dato real es el campo "Actual" y el consenso es "Forecast" (TE lo llama así; no es su pronóstico propio,
// que va en "TEForecast" y nunca se usa).
//
// Mapeo de cada fila del CSV a su evento de TE: país, fecha de publicación, nombre del evento y periodo.
// Los nombres de TE no se han podido comprobar sin una llave de pago; si alguno no coincide, el evento
// queda sin dato y /api/estado lo informa.

import type { FilaCalendario } from '../calendario.ts';
import { indicadorDe } from '../indicadores.ts';
import { ErrorFuente, obtenerJson } from '../red.ts';
import { fechaCdmx } from '../tiempo.ts';

export const URL_TE = 'https://api.tradingeconomics.com/calendar/country/mexico,united%20states/';

export interface EventoTe {
  CalendarId?: string;
  Date?: string;
  Country?: string;
  Event?: string;
  Reference?: string;
  Actual?: string;
  Forecast?: string;
  Unit?: string;
  URL?: string;
}

/** Nombres de evento en Trading Economics por indicador (en minúsculas). */
export const NOMBRES_TE: Record<string, string[]> = {
  'us.adp': ['adp employment change'],
  'us.nomina': ['non farm payrolls'],
  'us.desempleo': ['unemployment rate'],
  'us.ism-servicios': ['ism services pmi', 'ism non-manufacturing pmi'],
  'us.ism-manufacturero': ['ism manufacturing pmi'],
  'us.balanza': ['balance of trade'],
  'us.cpi': ['inflation rate yoy'],
  'us.cpi-subyacente': ['core inflation rate yoy'],
  'us.ppi': ['ppi yoy'],
  'us.ventas-minoristas': ['retail sales mom'],
  'us.fed': ['fed interest rate decision'],
  'us.pib': ['gdp growth rate qoq adv', 'gdp growth rate qoq 2nd est', 'gdp growth rate qoq final', 'gdp growth rate qoq 3rd est'],
  'us.pce-subyacente': ['core pce price index yoy'],
  'us.eci': ['employment cost index qoq'],
  'us.jolts': ['jolts job openings'],
  'us.cuenta-corriente': ['current account'],
  'mx.consumo': ['private consumption yoy', 'private spending yoy'],
  'mx.confianza': ['consumer confidence'],
  'mx.inpc': ['inflation rate yoy'],
  'mx.inpc-subyacente': ['core inflation rate yoy'],
  'mx.inpc-1q': ['mid-month inflation rate yoy'],
  'mx.inpc-subyacente-1q': ['mid-month core inflation rate yoy'],
  'mx.actividad-industrial': ['industrial production yoy'],
  'mx.ventas-minoristas': ['retail sales yoy'],
  'mx.desempleo': ['unemployment rate'],
  'mx.igae': ['economic activity yoy'],
  'mx.balanza': ['balance of trade'],
  'mx.banxico': ['interest rate decision'],
  'mx.pib-oportuno': ['gdp growth rate yoy flash', 'gdp annual growth rate flash', 'gdp growth rate yoy prel'],
  'mx.pib': ['gdp annual growth rate', 'gdp growth rate yoy final', 'gdp growth rate yoy'],
  'mx.imef': ['imef manufacturing pmi'],
  'mx.remesas': ['remittances', 'workers remittances'],
};

const PAISES_TE: Record<FilaCalendario['pais'], string> = { MX: 'mexico', US: 'united states' };
const MESES_TE: Record<string, string> = {
  ene: 'jan', feb: 'feb', mar: 'mar', abr: 'apr', may: 'may', jun: 'jun', jul: 'jul', ago: 'aug', sep: 'sep', oct: 'oct', nov: 'nov', dic: 'dec',
};

const normalizar = (t: string | undefined) => (t ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Fecha de TE (UTC sin zona) → fecha del centro de México. */
function fechaTe(fecha: string | undefined): string | null {
  if (!fecha) return null;
  const instante = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(fecha) ? fecha : `${fecha}Z`);
  return Number.isNaN(instante.getTime()) ? null : fechaCdmx(instante);
}

/** ¿El periodo de TE ("Sep", "Q3", "Oct/1") corresponde al del CSV ("sep", "3T", "oct")? Si no se puede leer, no descarta. */
function mismoPeriodo(referencia: string | undefined, periodo: string): boolean {
  const ref = normalizar(referencia);
  const per = normalizar(periodo);
  if (!ref || !per) return true;
  const trimestre = /^([1-4])t$/.exec(per);
  if (trimestre) return ref.startsWith(`q${trimestre[1]}`);
  const mes = MESES_TE[per];
  return mes ? ref.startsWith(mes) : true;
}

export function buscarEventoTe(
  fila: Pick<FilaCalendario, 'fecha' | 'pais' | 'periodo' | 'indicador' | 'tipo'>,
  eventos: EventoTe[],
): EventoTe | null {
  const meta = indicadorDe(fila);
  let nombres = NOMBRES_TE[meta.clave] ?? [];
  if (meta.clave === 'us.pib' && meta.estimacion) {
    const pista = { 1: 'adv', 2: '2nd', 3: 'final' }[meta.estimacion];
    nombres = nombres.filter((n) => n.includes(pista) || (meta.estimacion === 3 && n.includes('3rd')));
  }
  const candidatos = eventos.filter(
    (e) =>
      normalizar(e.Country) === PAISES_TE[fila.pais] &&
      fechaTe(e.Date) === fila.fecha &&
      nombres.includes(normalizar(e.Event)) &&
      mismoPeriodo(e.Reference, fila.periodo),
  );
  return candidatos[0] ?? null;
}

const MULTIPLICADORES: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };

/** Convierte un valor de TE ("150K", "-78.3B", "3.1%", "USD -1.2B") a la unidad del calendario. */
export function valorTe(texto: string | undefined, unidadTe: string | undefined, unidad: string): number | null {
  const limpio = (texto ?? '').replace(/,/g, '').trim();
  const m = /(-?\d+(?:\.\d+)?)\s*([KMBT])?/i.exec(limpio);
  if (!limpio || !m) return null;
  const numero = Number(m[1]);
  if (!Number.isFinite(numero)) return null;
  const sufijo = m[2]?.toUpperCase();
  const porUnidad = /thousand/i.test(unidadTe ?? '') ? 1e3 : /million/i.test(unidadTe ?? '') ? 1e6 : /billion/i.test(unidadTe ?? '') ? 1e9 : 1;
  const absoluto = numero * (sufijo ? (MULTIPLICADORES[sufijo] ?? 1) : porUnidad);
  switch (unidad) {
    case 'miles':
      return absoluto / 1e3;
    case 'millones':
    case 'mdd':
      return absoluto / 1e6;
    case 'mmd USD':
      return absoluto / 1e9;
    default:
      return numero;
  }
}

export function urlTe(evento: EventoTe): string {
  return evento.URL && evento.URL.startsWith('/') ? `https://tradingeconomics.com${evento.URL}` : 'https://tradingeconomics.com/calendar';
}

export async function consultarCalendarioTe(desde: string, hasta: string, llave: string): Promise<EventoTe[]> {
  const url = new URL(`${URL_TE}${desde}/${hasta}`);
  url.search = new URLSearchParams({ c: llave, f: 'json' }).toString();
  const eventos = await obtenerJson<EventoTe[]>(url);
  if (!Array.isArray(eventos)) throw new ErrorFuente('Trading Economics: respuesta inválida');
  return eventos;
}
