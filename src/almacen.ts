// Acceso a Netlify Blobs. Las funciones leen y escriben solo a través de esta interfaz.

import { getStore } from '@netlify/blobs';
import type { Datos, EstadoServicio } from './modelo.ts';

export interface Almacen {
  leerDatos(): Promise<Datos | null>;
  guardarDatos(datos: Datos): Promise<void>;
  leerEstado(): Promise<EstadoServicio | null>;
  guardarEstado(estado: EstadoServicio): Promise<void>;
}

export const STORE = 'calendario';

export function almacenBlobs(): Almacen {
  // Lectura fuerte: la página debe ver el dato en cuanto la función lo guarda.
  const store = getStore({ name: STORE, consistency: 'strong' });
  return {
    leerDatos: async () => ((await store.get('datos', { type: 'json' })) as Datos | null) ?? null,
    guardarDatos: async (datos) => {
      await store.setJSON('datos', datos);
    },
    leerEstado: async () => ((await store.get('estado', { type: 'json' })) as EstadoServicio | null) ?? null,
    guardarEstado: async (estado) => {
      await store.setJSON('estado', estado);
    },
  };
}

/** Almacén en memoria para pruebas. Cuenta las escrituras. */
export function almacenMemoria(inicial: { datos?: Datos; estado?: EstadoServicio } = {}) {
  let datos = inicial.datos ? structuredClone(inicial.datos) : null;
  let estado = inicial.estado ? structuredClone(inicial.estado) : null;
  const conteo = { lecturas: 0, escriturasDatos: 0, escriturasEstado: 0 };
  const almacen: Almacen = {
    leerDatos: async () => {
      conteo.lecturas++;
      return datos ? structuredClone(datos) : null;
    },
    guardarDatos: async (d) => {
      conteo.escriturasDatos++;
      datos = structuredClone(d);
    },
    leerEstado: async () => {
      conteo.lecturas++;
      return estado ? structuredClone(estado) : null;
    },
    guardarEstado: async (e) => {
      conteo.escriturasEstado++;
      estado = structuredClone(e);
    },
  };
  return { almacen, conteo, actual: () => ({ datos, estado }) };
}
