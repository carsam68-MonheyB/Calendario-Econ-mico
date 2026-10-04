// Elige el consultor del dato real según FUENTE_REAL.

import type { Consultor, ValorObtenido } from './actualizador.ts';
import type { Configuracion } from './config.ts';
import { crearConsultorOficial } from './consultor.ts';
import { buscarEventoTe, consultarCalendarioTe, urlTe, valorTe } from './organismos/te.ts';
import { ErrorFuente, sanitizar } from './red.ts';

const TE = 'Trading Economics';

/** Modo tradingeconomics: el dato real es el campo "Actual" del calendario de TE y el anterior, "Previous". */
export function crearConsultorTe(config: Configuracion): Consultor {
  return async ({ aConsultar, paraAnterior }) => {
    const llave = config.llaves.tradingeconomics;
    const sinDatos = (error?: string) => ({ valores: [], anteriores: [], intentos: { [TE]: error ? { ok: false, error } : { ok: true } } });
    if (!llave) return sinDatos('Falta la variable TE_API_KEY');
    try {
      const todos = [...aConsultar, ...paraAnterior];
      const fechas = todos.map((e) => e.fecha).sort();
      const eventos = await consultarCalendarioTe(fechas[0]!, fechas.at(-1)!, llave);
      const valores: ValorObtenido[] = [];
      const anteriores: ValorObtenido[] = [];
      for (const e of todos) {
        const te = buscarEventoTe(e, eventos);
        if (!te) continue;
        const anterior = valorTe(te.Previous, te.Unit, e.unidad);
        if (anterior !== null) anteriores.push({ id: e.id, valor: anterior, fuente: TE, url: urlTe(te) });
        if (!aConsultar.includes(e)) continue;
        const valor = valorTe(te.Actual, te.Unit, e.unidad);
        if (valor !== null) valores.push({ id: e.id, valor, fuente: TE, url: urlTe(te) });
      }
      return { valores, anteriores, intentos: { [TE]: { ok: true } } };
    } catch (e) {
      return sinDatos(e instanceof ErrorFuente ? e.message : sanitizar((e as Error).message));
    }
  };
}

export function crearConsultor(config: Configuracion): Consultor {
  return config.modoReal === 'tradingeconomics' ? crearConsultorTe(config) : crearConsultorOficial(config);
}
