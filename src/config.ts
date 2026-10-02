// Configuración desde variables de entorno (Netlify: Project configuration → Environment variables).

export type ModoReal = 'oficial' | 'tradingeconomics';
export type ModoConsenso = 'tradingeconomics' | 'claude' | 'ninguna';

export interface Llaves {
  bls?: string;
  bea?: string;
  census?: string;
  fred?: string;
  inegi?: string;
  banxico?: string;
  tradingeconomics?: string;
  anthropic?: string;
}

export interface Configuracion {
  modoReal: ModoReal;
  modoConsenso: ModoConsenso;
  llaves: Llaves;
}

/** Nombre de la variable de entorno de cada llave. */
export const VARIABLES_DE_LLAVES: Record<keyof Llaves, string> = {
  bls: 'BLS_API_KEY',
  bea: 'BEA_API_KEY',
  census: 'CENSUS_API_KEY',
  fred: 'FRED_API_KEY',
  inegi: 'INEGI_TOKEN',
  banxico: 'BANXICO_TOKEN',
  tradingeconomics: 'TE_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
};

function texto(valor: string | undefined): string | undefined {
  const limpio = valor?.trim();
  return limpio ? limpio : undefined;
}

export function leerConfiguracion(env: Record<string, string | undefined> = process.env): Configuracion {
  const real = texto(env.FUENTE_REAL)?.toLowerCase();
  const consenso = texto(env.FUENTE_CONSENSO)?.toLowerCase();
  const llaves: Llaves = {};
  for (const [nombre, variable] of Object.entries(VARIABLES_DE_LLAVES) as [keyof Llaves, string][]) {
    const valor = texto(env[variable]);
    if (valor) llaves[nombre] = valor;
  }
  return {
    modoReal: real === 'tradingeconomics' ? 'tradingeconomics' : 'oficial',
    modoConsenso: consenso === 'tradingeconomics' || consenso === 'claude' ? consenso : 'ninguna',
    llaves,
  };
}
