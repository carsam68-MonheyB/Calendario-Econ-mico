// Catálogo de indicadores: clave interna, decimales del boletín oficial y etiqueta de alto impacto.

import type { FilaCalendario } from './calendario.ts';

export interface Indicador {
  clave: string;
  decimales: number;
  altoImpacto: boolean;
  /** Solo PIB de EUA: 1 = avance, 2 = segunda estimación, 3 = estimación final. */
  estimacion?: 1 | 2 | 3;
}

const CATALOGO: Record<string, Indicador> = {
  'US|Empleo privado ADP': { clave: 'us.adp', decimales: 0, altoImpacto: false },
  'US|Nómina no agrícola': { clave: 'us.nomina', decimales: 0, altoImpacto: true },
  'US|Tasa de desempleo': { clave: 'us.desempleo', decimales: 1, altoImpacto: true },
  'US|ISM servicios': { clave: 'us.ism-servicios', decimales: 1, altoImpacto: false },
  'US|ISM manufacturero': { clave: 'us.ism-manufacturero', decimales: 1, altoImpacto: false },
  'US|Balanza comercial': { clave: 'us.balanza', decimales: 1, altoImpacto: false },
  'US|Minutas del FOMC': { clave: 'us.minutas-fomc', decimales: 0, altoImpacto: false },
  'US|CPI general anual': { clave: 'us.cpi', decimales: 1, altoImpacto: true },
  'US|CPI subyacente anual': { clave: 'us.cpi-subyacente', decimales: 1, altoImpacto: true },
  'US|PPI demanda final anual': { clave: 'us.ppi', decimales: 1, altoImpacto: false },
  'US|Ventas minoristas': { clave: 'us.ventas-minoristas', decimales: 1, altoImpacto: false },
  'US|Decisión de la Fed (límite superior)': { clave: 'us.fed', decimales: 2, altoImpacto: true },
  'US|Decisión de la Fed (límite superior) y proyecciones': { clave: 'us.fed', decimales: 2, altoImpacto: true },
  'US|PIB (avance)': { clave: 'us.pib', decimales: 1, altoImpacto: true, estimacion: 1 },
  'US|PIB (2a estimación)': { clave: 'us.pib', decimales: 1, altoImpacto: true, estimacion: 2 },
  'US|PIB (final)': { clave: 'us.pib', decimales: 1, altoImpacto: true, estimacion: 3 },
  'US|PCE subyacente anual': { clave: 'us.pce-subyacente', decimales: 1, altoImpacto: true },
  'US|Índice de costo del empleo (ECI)': { clave: 'us.eci', decimales: 1, altoImpacto: false },
  'US|Elecciones intermedias': { clave: 'us.elecciones', decimales: 0, altoImpacto: false },
  'US|Vacantes JOLTS': { clave: 'us.jolts', decimales: 2, altoImpacto: false },
  'US|Libro Beige': { clave: 'us.libro-beige', decimales: 0, altoImpacto: false },
  'US|Cuenta corriente': { clave: 'us.cuenta-corriente', decimales: 1, altoImpacto: false },

  'MX|Consumo privado': { clave: 'mx.consumo', decimales: 1, altoImpacto: false },
  'MX|Confianza del consumidor': { clave: 'mx.confianza', decimales: 1, altoImpacto: false },
  'MX|INPC general anual': { clave: 'mx.inpc', decimales: 2, altoImpacto: true },
  'MX|INPC subyacente anual': { clave: 'mx.inpc-subyacente', decimales: 2, altoImpacto: true },
  'MX|INPC general anual 1a quincena': { clave: 'mx.inpc-1q', decimales: 2, altoImpacto: true },
  'MX|INPC subyacente anual 1a quincena': { clave: 'mx.inpc-subyacente-1q', decimales: 2, altoImpacto: true },
  'MX|Minuta de Banxico': { clave: 'mx.minuta-banxico', decimales: 0, altoImpacto: false },
  'MX|Actividad industrial': { clave: 'mx.actividad-industrial', decimales: 1, altoImpacto: false },
  'MX|Ventas minoristas': { clave: 'mx.ventas-minoristas', decimales: 1, altoImpacto: false },
  'MX|Tasa de desempleo': { clave: 'mx.desempleo', decimales: 1, altoImpacto: false },
  'MX|IGAE': { clave: 'mx.igae', decimales: 1, altoImpacto: false },
  'MX|Balanza comercial': { clave: 'mx.balanza', decimales: 0, altoImpacto: false },
  'MX|Decisión de Banxico (tasa objetivo)': { clave: 'mx.banxico', decimales: 2, altoImpacto: true },
  'MX|PIB oportuno': { clave: 'mx.pib-oportuno', decimales: 1, altoImpacto: true },
  'MX|Finanzas públicas': { clave: 'mx.finanzas-publicas', decimales: 0, altoImpacto: false },
  'MX|IMEF manufacturero': { clave: 'mx.imef', decimales: 1, altoImpacto: false },
  'MX|Remesas': { clave: 'mx.remesas', decimales: 0, altoImpacto: false },
  'MX|PIB (cifra completa)': { clave: 'mx.pib', decimales: 1, altoImpacto: true },
  'MX|Informe trimestral de Banxico': { clave: 'mx.informe-banxico', decimales: 0, altoImpacto: false },
  'MX|Oferta y utilización': { clave: 'mx.oferta-utilizacion', decimales: 0, altoImpacto: false },
};

const DECIMALES_POR_TIPO: Record<FilaCalendario['tipo'], number> = { nivel: 1, pct: 1, tasa: 2, evento: 0 };

/** Devuelve los metadatos del indicador. Un nombre nuevo en el CSV recibe valores por omisión y no tiene fuente automática. */
export function indicadorDe(fila: Pick<FilaCalendario, 'pais' | 'indicador' | 'tipo'>): Indicador & { conocido: boolean } {
  const encontrado = CATALOGO[`${fila.pais}|${fila.indicador}`];
  if (encontrado) return { ...encontrado, conocido: true };
  return { clave: '', decimales: DECIMALES_POR_TIPO[fila.tipo], altoImpacto: false, conocido: false };
}
