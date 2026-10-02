// Lectura de data/calendario.csv y data/correcciones.json, que viajan dentro del paquete de cada función
// (netlify.toml → included_files).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { leerCalendario, type FilaCalendario } from './calendario.ts';
import { leerCorrecciones, type Correccion } from './correcciones.ts';

/** Solo en `netlify dev`: permite probar con otro calendario u otra hora. */
export const esDesarrolloLocal = () => process.env.NETLIFY_DEV === 'true';

function ruta(relativa: string): string {
  const candidatos = [
    join(process.cwd(), relativa),
    process.env.LAMBDA_TASK_ROOT ? join(process.env.LAMBDA_TASK_ROOT, relativa) : '',
    fileURLToPath(new URL(`../${relativa}`, import.meta.url)),
  ];
  const encontrada = candidatos.find((c) => c && existsSync(c));
  if (!encontrada) throw new Error(`No se encontró ${relativa}.`);
  return encontrada;
}

let calendario: FilaCalendario[] | null = null;
let correcciones: { correcciones: Correccion[]; error: string | null } | null = null;

export function cargarCalendario(): FilaCalendario[] {
  if (!calendario) {
    const alterno = esDesarrolloLocal() ? process.env.CALENDARIO_CSV : undefined;
    calendario = leerCalendario(readFileSync(alterno ?? ruta('data/calendario.csv'), 'utf8'));
  }
  return calendario;
}

export function cargarCorrecciones(): { correcciones: Correccion[]; error: string | null } {
  if (!correcciones) {
    try {
      correcciones = leerCorrecciones(readFileSync(ruta('data/correcciones.json'), 'utf8'));
    } catch (e) {
      correcciones = { correcciones: [], error: (e as Error).message };
    }
  }
  return correcciones;
}

/** Hora de la corrida. En `netlify dev` se puede fijar con PRUEBA_AHORA (ISO, UTC). */
export function horaActual(): Date {
  const prueba = esDesarrolloLocal() ? process.env.PRUEBA_AHORA : undefined;
  return prueba ? new Date(prueba) : new Date();
}
