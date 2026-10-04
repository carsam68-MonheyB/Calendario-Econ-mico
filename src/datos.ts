// Combina el calendario del CSV con lo guardado en Blobs.

import type { FilaCalendario } from './calendario.ts';
import type { Datos, EventoGuardado, ValorConFuente } from './modelo.ts';
import { estadoVisible, ventanas } from './programacion.ts';

export const FUENTE_DATASET = 'Dataset';

/**
 * Los valores del CSV son semillas: se usan si no hay nada guardado o si lo guardado también
 * vino del CSV. Un valor obtenido de una fuente o capturado a mano nunca se reemplaza aquí.
 */
function elegir(guardado: ValorConFuente | null, delCsv: number | null, capturado: Date): ValorConFuente | null {
  if (guardado && guardado.fuente !== FUENTE_DATASET) return guardado;
  if (delCsv === null) return null;
  if (guardado && guardado.valor === delCsv) return guardado;
  return { valor: delCsv, fuente: FUENTE_DATASET, url: null, obtenido: capturado.toISOString() };
}

/**
 * La primera vez carga el CSV completo. Después, el CSV manda en los campos fijos (fecha, hora,
 * indicador…) y Blobs en los valores obtenidos. Las filas que ya no están en el CSV se quitan.
 */
export function sincronizar(calendario: FilaCalendario[], guardados: Datos | null, ahora: Date): Datos {
  const previos = new Map((guardados?.eventos ?? []).map((e) => [e.id, e]));
  const eventos = calendario.map((fila): EventoGuardado => {
    const previo = previos.get(fila.id);
    const { esperado, real, anterior, ...fijos } = fila;
    // Un valor capturado en el CSV se fecha a la hora de publicación del evento, no a la de lectura.
    const capturado = ventanas(fila).inicio;
    return {
      ...fijos,
      esperado: elegir(previo?.esperado ?? null, esperado, capturado),
      real: elegir(previo?.real ?? null, real, capturado),
      anterior: elegir(previo?.anterior ?? null, anterior, capturado),
      revision: previo?.revision ?? null,
      estado: previo?.estado ?? 'pendiente',
      actualizado: previo?.actualizado ?? null,
    };
  });
  return { version: 1, actualizado: guardados?.actualizado ?? ahora.toISOString(), eventos };
}

/** Recalcula el estado guardado de cada evento a la hora de la corrida. */
export function actualizarEstados(datos: Datos, esConsultable: (e: EventoGuardado) => boolean, ahora: Date): void {
  for (const e of datos.eventos) e.estado = estadoVisible(e, e.real !== null, esConsultable(e), ahora);
}

/** Huella para saber si algo cambió y evitar escrituras innecesarias. */
export function huella(datos: Datos | null): string {
  return datos ? JSON.stringify(datos.eventos) : '';
}
