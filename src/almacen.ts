// Acceso a Netlify Blobs. Las funciones leen y escriben solo a través de esta interfaz.
// Cada llave tiene un solo escritor: "datos", "estado" y "fix" la función programada; "consenso" quien busca el esperado.

import { getStore } from '@netlify/blobs';
import type { DatosConsenso } from './consenso.ts';
import type { Fix } from './fix.ts';
import type { Datos, EstadoServicio } from './modelo.ts';

export interface Almacen {
  leerDatos(): Promise<Datos | null>;
  guardarDatos(datos: Datos): Promise<void>;
  leerEstado(): Promise<EstadoServicio | null>;
  guardarEstado(estado: EstadoServicio): Promise<void>;
  leerConsenso(): Promise<DatosConsenso | null>;
  guardarConsenso(consenso: DatosConsenso): Promise<void>;
  leerFix(): Promise<Fix | null>;
  guardarFix(fix: Fix): Promise<void>;
}

export const STORE = 'calendario';

export function almacenBlobs(): Almacen {
  // Lectura fuerte: la página debe ver el dato en cuanto la función lo guarda.
  const store = getStore({ name: STORE, consistency: 'strong' });
  const leer = async <T>(llave: string) => ((await store.get(llave, { type: 'json' })) as T | null) ?? null;
  return {
    leerDatos: () => leer<Datos>('datos'),
    guardarDatos: async (datos) => {
      await store.setJSON('datos', datos);
    },
    leerEstado: () => leer<EstadoServicio>('estado'),
    guardarEstado: async (estado) => {
      await store.setJSON('estado', estado);
    },
    leerConsenso: () => leer<DatosConsenso>('consenso'),
    guardarConsenso: async (consenso) => {
      await store.setJSON('consenso', consenso);
    },
    leerFix: () => leer<Fix>('fix'),
    guardarFix: async (fix) => {
      await store.setJSON('fix', fix);
    },
  };
}

/** Almacén en memoria para pruebas. Cuenta las lecturas y escrituras. */
export function almacenMemoria(inicial: { datos?: Datos; estado?: EstadoServicio; consenso?: DatosConsenso; fix?: Fix } = {}) {
  const copia = <T>(x: T | undefined | null): T | null => (x ? structuredClone(x) : null);
  let datos = copia(inicial.datos);
  let estado = copia(inicial.estado);
  let consenso = copia(inicial.consenso);
  let fix = copia(inicial.fix);
  const conteo = { lecturas: 0, escriturasDatos: 0, escriturasEstado: 0, escriturasConsenso: 0, escriturasFix: 0 };
  const almacen: Almacen = {
    leerDatos: async () => (conteo.lecturas++, copia(datos)),
    guardarDatos: async (d) => {
      conteo.escriturasDatos++;
      datos = structuredClone(d);
    },
    leerEstado: async () => (conteo.lecturas++, copia(estado)),
    guardarEstado: async (e) => {
      conteo.escriturasEstado++;
      estado = structuredClone(e);
    },
    leerConsenso: async () => (conteo.lecturas++, copia(consenso)),
    guardarConsenso: async (c) => {
      conteo.escriturasConsenso++;
      consenso = structuredClone(c);
    },
    leerFix: async () => (conteo.lecturas++, copia(fix)),
    guardarFix: async (f) => {
      conteo.escriturasFix++;
      fix = structuredClone(f);
    },
  };
  return { almacen, conteo, actual: () => ({ datos, estado, consenso, fix }) };
}
