// Correcciones manuales de respaldo: data/correcciones.json.
//
// Formato: una lista de objetos con fecha, pais e indicador tal como aparecen en el CSV,
// más "real" y/o "esperado". Un valor null borra el dato. Ejemplo:
// [{ "fecha": "2026-10-08", "pais": "MX", "indicador": "INPC general anual", "real": 3.76 }]

import { idEvento } from './calendario.ts';
import type { EventoGuardado, ValorConFuente } from './modelo.ts';

export interface Correccion {
  id: string;
  real?: number | null;
  esperado?: number | null;
}

export const FUENTE_MANUAL = 'Manual';

function valorCorregido(valor: unknown, campo: string, posicion: number): number | null | undefined {
  if (valor === undefined) return undefined;
  if (valor === null) return null;
  if (typeof valor !== 'number' || !Number.isFinite(valor)) {
    throw new Error(`Corrección ${posicion}: "${campo}" debe ser un número o null.`);
  }
  return valor;
}

/** Lee el archivo. Si tiene errores, no aplica ninguna corrección y devuelve el motivo. */
export function leerCorrecciones(textoJson: string): { correcciones: Correccion[]; error: string | null } {
  try {
    const lista: unknown = JSON.parse(textoJson);
    if (!Array.isArray(lista)) throw new Error('El archivo debe contener una lista.');
    const correcciones = lista.map((item, i): Correccion => {
      const posicion = i + 1;
      const c = item as Record<string, unknown>;
      if (typeof c.fecha !== 'string' || typeof c.pais !== 'string' || typeof c.indicador !== 'string') {
        throw new Error(`Corrección ${posicion}: faltan fecha, pais o indicador.`);
      }
      const real = valorCorregido(c.real, 'real', posicion);
      const esperado = valorCorregido(c.esperado, 'esperado', posicion);
      if (real === undefined && esperado === undefined) {
        throw new Error(`Corrección ${posicion}: no trae "real" ni "esperado".`);
      }
      return {
        id: idEvento(c.fecha.trim(), c.pais.trim().toUpperCase(), c.indicador.trim()),
        ...(real !== undefined && { real }),
        ...(esperado !== undefined && { esperado }),
      };
    });
    return { correcciones, error: null };
  } catch (e) {
    return { correcciones: [], error: `data/correcciones.json: ${(e as Error).message}` };
  }
}

function mismoValor(actual: ValorConFuente | null, nuevo: number | null): boolean {
  if (nuevo === null) return actual === null;
  return actual !== null && actual.fuente === FUENTE_MANUAL && actual.valor === nuevo;
}

/** Aplica las correcciones sobre los eventos. Devuelve los id que cambiaron. */
export function aplicarCorrecciones(eventos: EventoGuardado[], correcciones: Correccion[], ahora: Date): string[] {
  const porId = new Map(eventos.map((e) => [e.id, e]));
  const cambiados = new Set<string>();
  for (const c of correcciones) {
    const evento = porId.get(c.id);
    if (!evento) continue;
    for (const campo of ['real', 'esperado'] as const) {
      const nuevo = c[campo];
      if (nuevo === undefined || mismoValor(evento[campo], nuevo)) continue;
      evento[campo] = nuevo === null ? null : { valor: nuevo, fuente: FUENTE_MANUAL, url: null, obtenido: ahora.toISOString() };
      if (campo === 'real') evento.revision = null;
      evento.actualizado = ahora.toISOString();
      cambiados.add(evento.id);
    }
  }
  return [...cambiados];
}
