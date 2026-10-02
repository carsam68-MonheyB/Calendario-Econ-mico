// Elige el consultor del dato real según FUENTE_REAL.

import type { Consultor, ValorObtenido } from './actualizador.ts';
import type { Configuracion } from './config.ts';
import { crearConsultorOficial } from './consultor.ts';
import { buscarEventoTe, consultarCalendarioTe, urlTe, valorTe } from './organismos/te.ts';
import { ErrorFuente, sanitizar } from './red.ts';

const TE = 'Trading Economics';

/** Modo tradingeconomics: el dato real es el campo "Actual" del calendario de TE. */
export function crearConsultorTe(config: Configuracion): Consultor {
  return async ({ aConsultar }) => {
    const llave = config.llaves.tradingeconomics;
    if (!llave) return { valores: [], intentos: { [TE]: { ok: false, error: 'Falta la variable TE_API_KEY' } } };
    try {
      const fechas = aConsultar.map((e) => e.fecha).sort();
      const eventos = await consultarCalendarioTe(fechas[0]!, fechas.at(-1)!, llave);
      const valores: ValorObtenido[] = [];
      for (const e of aConsultar) {
        const te = buscarEventoTe(e, eventos);
        const valor = te ? valorTe(te.Actual, te.Unit, e.unidad) : null;
        if (te && valor !== null) valores.push({ id: e.id, valor, fuente: TE, url: urlTe(te) });
      }
      return { valores, intentos: { [TE]: { ok: true } } };
    } catch (e) {
      return { valores: [], intentos: { [TE]: { ok: false, error: e instanceof ErrorFuente ? e.message : sanitizar((e as Error).message) } } };
    }
  };
}

export function crearConsultor(config: Configuracion): Consultor {
  return config.modoReal === 'tradingeconomics' ? crearConsultorTe(config) : crearConsultorOficial(config);
}
