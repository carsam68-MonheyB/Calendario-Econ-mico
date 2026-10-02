// Elige el consultor según FUENTE_REAL.

import type { Consultor } from './actualizador.ts';
import type { Configuracion } from './config.ts';
import { crearConsultorOficial } from './consultor.ts';

export function crearConsultor(config: Configuracion): Consultor {
  if (config.modoReal === 'tradingeconomics') {
    // Se conecta en la siguiente etapa. Mientras, se informa en /api/estado y no se inventa nada.
    return async () => ({
      valores: [],
      intentos: { 'Trading Economics': { ok: false, error: 'El modo tradingeconomics todavía no está disponible' } },
    });
  }
  return crearConsultorOficial(config);
}
