// Mapeo indicador → fuente y serie, y el cálculo que convierte la serie en el dato del boletín.

import type { FilaCalendario } from './calendario.ts';
import { variacionPorcentual } from './calculos.ts';
import type { ModoReal } from './config.ts';
import { indicadorDe } from './indicadores.ts';
import type { SerieCensus } from './organismos/census.ts';
import type { FrecuenciaFred } from './organismos/fred.ts';
import type { Observaciones } from './organismos/tipos.ts';
import { anioAnterior, clavePeriodo, periodoAnterior, type Periodo } from './periodos.ts';

export type Organismo = 'BLS' | 'BEA' | 'Census' | 'Fed' | 'FRED' | 'INEGI' | 'Banxico';

export type Serie =
  | { organismo: 'BLS'; id: string }
  | { organismo: 'BEA'; tabla: string; codigo: string; frecuencia: 'Q' | 'M' }
  | { organismo: 'BEA'; ita: string }
  | ({ organismo: 'Census' } & SerieCensus)
  | { organismo: 'Fed' }
  | { organismo: 'FRED'; id: string; frecuencia: FrecuenciaFred }
  | { organismo: 'INEGI'; id: string }
  | { organismo: 'Banxico'; id: string; frecuencia: 'mes' | 'dia' }
  | { organismo: 'Banxico'; anuncio: true };

export type Calculo =
  /** El valor del periodo tal cual (tasas, saldos, variaciones ya publicadas). */
  | { tipo: 'valor' }
  /** Nivel del periodo menos el del periodo anterior (nómina no agrícola). */
  | { tipo: 'cambio' }
  /** (índice del periodo / índice del mismo periodo del año anterior − 1) × 100. */
  | { tipo: 'anual' }
  /** (valor del periodo / valor del periodo anterior − 1) × 100. */
  | { tipo: 'periodo' }
  /** Cambio de unidades, por ejemplo de millones a miles de millones. */
  | { tipo: 'escala'; factor: number };

export interface Receta {
  serie: Serie;
  calculo: Calculo;
}

export interface Mapeo {
  /** Recetas de la fuente primaria; se usa la primera que dé un valor. */
  primaria: Receta[];
  /** FRED: solo si la fuente primaria no respondió. */
  respaldo?: Receta[];
  /** Cómo obtener el último dato vigente antes del evento, si no es el periodo anterior de la serie primaria. */
  anterior?: Receta[];
  /** Página pública para "Ver fuente". */
  url: string;
}

const bls = (id: string, calculo: Calculo = { tipo: 'valor' }): Receta => ({ serie: { organismo: 'BLS', id }, calculo });
const fred = (id: string, frecuencia: FrecuenciaFred, calculo: Calculo = { tipo: 'valor' }): Receta => ({
  serie: { organismo: 'FRED', id, frecuencia },
  calculo,
});
const inegi = (id: string, calculo: Calculo = { tipo: 'valor' }): Receta => ({ serie: { organismo: 'INEGI', id }, calculo });
const ANUAL: Calculo = { tipo: 'anual' };
const A_MILES_DE_MILLONES: Calculo = { tipo: 'escala', factor: 0.001 };
const URL_INEGI = 'https://www.inegi.org.mx/app/saladeprensa/';

/** Modo oficial. Cada serie se verificó contra el último boletín publicado (ver README). */
export const MAPEO_OFICIAL: Record<string, Mapeo> = {
  'us.nomina': {
    primaria: [bls('CES0000000001', { tipo: 'cambio' })],
    respaldo: [fred('PAYEMS', 'mes', { tipo: 'cambio' })],
    url: 'https://www.bls.gov/news.release/empsit.nr0.htm',
  },
  'us.desempleo': {
    primaria: [bls('LNS14000000')],
    respaldo: [fred('UNRATE', 'mes')],
    url: 'https://www.bls.gov/news.release/empsit.nr0.htm',
  },
  'us.cpi': {
    primaria: [bls('CUUR0000SA0', ANUAL), bls('CUUR0000SA0#12m')],
    respaldo: [fred('CPIAUCNS', 'mes', ANUAL)],
    url: 'https://www.bls.gov/news.release/cpi.nr0.htm',
  },
  'us.cpi-subyacente': {
    primaria: [bls('CUUR0000SA0L1E', ANUAL), bls('CUUR0000SA0L1E#12m')],
    respaldo: [fred('CPILFENS', 'mes', ANUAL)],
    url: 'https://www.bls.gov/news.release/cpi.nr0.htm',
  },
  'us.ppi': {
    primaria: [bls('WPUFD4', ANUAL), bls('WPUFD4#12m')],
    url: 'https://www.bls.gov/news.release/ppi.nr0.htm',
  },
  'us.jolts': {
    // BLS lo publica en miles; el calendario lo muestra en millones.
    primaria: [bls('JTS000000000000000JOL', A_MILES_DE_MILLONES)],
    respaldo: [fred('JTSJOL', 'mes', A_MILES_DE_MILLONES)],
    url: 'https://www.bls.gov/news.release/jolts.nr0.htm',
  },
  'us.eci': {
    primaria: [bls('CIS1010000000000Q')],
    respaldo: [fred('ECIALLCIV', 'trimestre', { tipo: 'periodo' })],
    url: 'https://www.bls.gov/news.release/eci.nr0.htm',
  },
  'us.pib': {
    primaria: [{ serie: { organismo: 'BEA', tabla: 'T10101', codigo: 'A191RL', frecuencia: 'Q' }, calculo: { tipo: 'valor' } }],
    respaldo: [fred('A191RL1Q225SBEA', 'trimestre')],
    url: 'https://www.bea.gov/data/gdp/gross-domestic-product',
  },
  'us.pce-subyacente': {
    // BEA solo publica el índice desestacionalizado; su variación anual se calcula sobre ese índice.
    primaria: [{ serie: { organismo: 'BEA', tabla: 'T20804', codigo: 'DPCCRG', frecuencia: 'M' }, calculo: ANUAL }],
    respaldo: [fred('PCEPILFE', 'mes', ANUAL)],
    url: 'https://www.bea.gov/data/personal-consumption-expenditures-price-index-excluding-food-and-energy',
  },
  'us.balanza': {
    primaria: [{ serie: { organismo: 'Census', conjunto: 'ftd', categoria: 'BOPGS', tipoDato: 'BAL', ajustada: true }, calculo: A_MILES_DE_MILLONES }],
    respaldo: [fred('BOPGSTB', 'mes', A_MILES_DE_MILLONES)],
    url: 'https://www.census.gov/foreign-trade/current/index.html',
  },
  'us.cuenta-corriente': {
    primaria: [{ serie: { organismo: 'BEA', ita: 'BalCurrAcct' }, calculo: A_MILES_DE_MILLONES }],
    respaldo: [fred('IEABC', 'trimestre', A_MILES_DE_MILLONES)],
    url: 'https://www.bea.gov/data/intl-trade-investment/international-transactions',
  },
  'us.ventas-minoristas': {
    primaria: [{ serie: { organismo: 'Census', conjunto: 'marts', categoria: '44X72', tipoDato: 'MPCSM', ajustada: true }, calculo: { tipo: 'valor' } }],
    respaldo: [fred('RSAFS', 'mes', { tipo: 'periodo' })],
    url: 'https://www.census.gov/retail/index.html',
  },
  'us.fed': {
    primaria: [{ serie: { organismo: 'Fed' }, calculo: { tipo: 'valor' } }],
    // La tasa vigente antes de la reunión: última observación de FRED anterior a la fecha.
    anterior: [fred('DFEDTARU', 'dia')],
    url: 'https://www.federalreserve.gov/newsevents/pressreleases.htm',
  },

  // INEGI (BIE-BISE). Variaciones anuales sobre la serie original; la serie anual de INEGI queda de respaldo.
  'mx.inpc': { primaria: [inegi('910392', ANUAL), inegi('910406')], url: URL_INEGI },
  'mx.inpc-subyacente': { primaria: [inegi('910393', ANUAL), inegi('910407')], url: URL_INEGI },
  'mx.inpc-1q': { primaria: [inegi('910420', ANUAL), inegi('910438')], url: URL_INEGI },
  'mx.inpc-subyacente-1q': { primaria: [inegi('910421', ANUAL), inegi('910439')], url: URL_INEGI },
  'mx.igae': { primaria: [inegi('737121', ANUAL), inegi('737145')], url: URL_INEGI },
  'mx.actividad-industrial': { primaria: [inegi('736407', ANUAL), inegi('736526')], url: URL_INEGI },
  // La estimación oportuna solo existe como variación.
  'mx.pib-oportuno': { primaria: [inegi('798947')], url: URL_INEGI },
  'mx.pib': { primaria: [inegi('735879', ANUAL), inegi('735904')], url: URL_INEGI },
  'mx.consumo': { primaria: [inegi('740933', ANUAL), inegi('740946')], url: URL_INEGI },
  'mx.ventas-minoristas': { primaria: [inegi('718506', ANUAL), inegi('718507')], url: URL_INEGI },
  'mx.desempleo': { primaria: [inegi('444603')], url: URL_INEGI },
  'mx.balanza': { primaria: [inegi('897')], url: URL_INEGI },
  // El boletín de confianza del consumidor encabeza con la serie desestacionalizada.
  'mx.confianza': { primaria: [inegi('454186')], url: URL_INEGI },

  'mx.remesas': {
    primaria: [{ serie: { organismo: 'Banxico', id: 'SE27803', frecuencia: 'mes' }, calculo: { tipo: 'valor' } }],
    url: 'https://www.banxico.org.mx/publicaciones-y-prensa/remesas/remesas-balanza-pagos-banco.html',
  },
  'mx.banxico': {
    primaria: [{ serie: { organismo: 'Banxico', anuncio: true }, calculo: { tipo: 'valor' } }],
    anterior: [{ serie: { organismo: 'Banxico', id: 'SF61745', frecuencia: 'dia' }, calculo: { tipo: 'valor' } }],
    url: 'https://www.banxico.org.mx/publicaciones-y-prensa/anuncios-de-las-decisiones-de-politica-monetaria/anuncios-politica-monetaria-t.html',
  },
};

/** Indicadores con fuente oficial automática. ISM, IMEF y ADP solo llegan por Trading Economics. */
export const CLAVES_OFICIALES = new Set(Object.keys(MAPEO_OFICIAL));

/** Si el evento puede recibir su dato real automáticamente con el modo elegido. */
export function tieneFuente(fila: Pick<FilaCalendario, 'pais' | 'indicador' | 'tipo'>, modo: ModoReal): boolean {
  if (fila.tipo === 'evento') return false;
  const { clave, conocido } = indicadorDe(fila);
  if (!conocido) return false;
  return modo === 'tradingeconomics' ? true : CLAVES_OFICIALES.has(clave);
}

/** Llave con la que cada organismo devuelve la serie. */
export function claveSerie(serie: Serie): string {
  switch (serie.organismo) {
    case 'BLS':
    case 'FRED':
    case 'INEGI':
      return serie.id;
    case 'BEA':
      return 'ita' in serie ? `ITA:${serie.ita}` : `${serie.tabla}:${serie.codigo}`;
    case 'Census':
      return `${serie.conjunto}:${serie.categoria}:${serie.tipoDato}:${serie.ajustada ? 'sa' : 'nsa'}`;
    case 'Fed':
      return 'FED';
    case 'Banxico':
      return 'anuncio' in serie ? 'BANXICO:ANUNCIO' : serie.id;
  }
}

/**
 * Último dato publicado antes del evento: el del periodo anterior de la serie. Para las decisiones de tasa
 * (periodo diario), la última observación anterior a la fecha de la reunión.
 */
export function calcularAnterior(obs: Observaciones | undefined, calculo: Calculo, periodo: Periodo): number | null {
  if (!obs) return null;
  if (periodo.tipo === 'dia') {
    const previa = [...obs.keys()].filter((k) => k < periodo.fecha).sort().at(-1);
    return previa === undefined ? null : calcular(obs, calculo, { tipo: 'dia', fecha: previa });
  }
  return calcular(obs, calculo, periodoAnterior(periodo));
}

/**
 * Valor del boletín para el periodo pedido. Si la serie todavía no trae ese periodo
 * (por ejemplo, la API sigue mostrando el mes anterior) devuelve null: hay que seguir esperando.
 */
export function calcular(obs: Observaciones | undefined, calculo: Calculo, periodo: Periodo): number | null {
  if (!obs) return null;
  const actual = obs.get(clavePeriodo(periodo));
  if (actual === undefined) return null;
  switch (calculo.tipo) {
    case 'valor':
      return actual;
    case 'escala':
      return actual * calculo.factor;
    case 'cambio': {
      const previo = obs.get(clavePeriodo(periodoAnterior(periodo)));
      return previo === undefined ? null : actual - previo;
    }
    case 'anual': {
      const base = obs.get(clavePeriodo(anioAnterior(periodo)));
      return base === undefined || base === 0 ? null : variacionPorcentual(actual, base);
    }
    case 'periodo': {
      const previo = obs.get(clavePeriodo(periodoAnterior(periodo)));
      return previo === undefined || previo === 0 ? null : variacionPorcentual(actual, previo);
    }
  }
}
