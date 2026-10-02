// Background Function (hasta 15 minutos): busca con Claude el consenso del mercado de los eventos que le
// pasa la función programada a las 20:00 de la víspera. Solo acepta llamadas firmadas por el propio sitio.

import { almacenBlobs } from '../../src/almacen.ts';
import { cargarCalendario } from '../../src/archivos.ts';
import { leerConfiguracion } from '../../src/config.ts';
import { consensoVacio, firmaValida, registrarFuente, registrarIntento } from '../../src/consenso.ts';
import { consultarConsenso, MODELO_POR_OMISION } from '../../src/organismos/claude.ts';
import { ErrorFuente, sanitizar } from '../../src/red.ts';

const SIMULTANEAS = 2;

export default async (req: Request) => {
  const config = leerConfiguracion();
  const llave = config.llaves.anthropic;
  if (config.modoConsenso !== 'claude' || !llave) return;

  const cuerpo = await req.text();
  if (!firmaValida(cuerpo, req.headers.get('x-calendario-marca'), req.headers.get('x-calendario-firma'), llave, new Date())) {
    console.warn('[consenso] llamada sin firma válida; se ignora');
    return;
  }
  let ids: string[] = [];
  try {
    const leido = JSON.parse(cuerpo) as { ids?: unknown };
    ids = Array.isArray(leido.ids) ? leido.ids.filter((x): x is string => typeof x === 'string').slice(0, 30) : [];
  } catch {
    return;
  }
  const filas = cargarCalendario().filter((f) => ids.includes(f.id) && f.tipo !== 'evento');
  if (filas.length === 0) return;

  const modelo = process.env.CLAUDE_MODELO?.trim() || MODELO_POR_OMISION;
  const resultados: { id: string; valor?: number | null; fuente?: string; url?: string | null; error?: string; busquedas?: number }[] = [];
  const cola = [...filas];
  await Promise.all(
    Array.from({ length: SIMULTANEAS }, async () => {
      for (let fila = cola.shift(); fila; fila = cola.shift()) {
        try {
          const r = await consultarConsenso(fila, llave, modelo);
          resultados.push({ id: fila.id, valor: r.valor, fuente: r.fuente, url: r.url, busquedas: r.busquedas });
        } catch (e) {
          resultados.push({ id: fila.id, error: e instanceof ErrorFuente ? e.message : sanitizar((e as Error).message) });
        }
      }
    }),
  );

  // Se relee justo antes de escribir para no perder lo que otra ejecución haya guardado.
  const ahora = new Date();
  const almacen = almacenBlobs();
  const consenso = (await almacen.leerConsenso()) ?? consensoVacio();
  for (const r of resultados) {
    if (r.error !== undefined) registrarIntento(consenso, r.id, ahora, { error: r.error });
    else {
      const fuente = r.fuente ? `${r.fuente} (búsqueda de Claude)` : 'Consenso del mercado (búsqueda de Claude)';
      registrarIntento(consenso, r.id, ahora, { valor: r.valor ?? null, fuente, url: r.url ?? null });
    }
  }
  const errores = resultados.filter((r) => r.error !== undefined);
  registrarFuente(consenso, 'Anthropic', ahora, errores.length === resultados.length ? (errores[0]?.error ?? null) : null);
  await almacen.guardarConsenso(consenso);
  const busquedas = resultados.reduce((s, r) => s + (r.busquedas ?? 0), 0);
  console.log(`[consenso] ${resultados.length} eventos, ${errores.length} con error, ${busquedas} búsquedas web, modelo ${modelo}`);
};
