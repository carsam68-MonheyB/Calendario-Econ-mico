// GET /api/datos y GET /api/estado. Solo lee: la página nunca escribe datos.

import type { Config } from '@netlify/functions';
import { createHash } from 'node:crypto';
import { almacenBlobs } from '../../src/almacen.ts';
import { cargarCalendario, cargarCorrecciones, horaActual } from '../../src/archivos.ts';
import { leerConfiguracion } from '../../src/config.ts';
import { tieneFuente } from '../../src/fuentes.ts';
import { construirEstado, construirVista } from '../../src/vista.ts';

const SIN_CACHE = { 'Cache-Control': 'no-store' };

export default async (req: Request) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response('Método no permitido', { status: 405, headers: { ...SIN_CACHE, Allow: 'GET, HEAD' } });
  }
  const ahora = horaActual();
  const config = leerConfiguracion();
  const almacen = almacenBlobs();
  const { correcciones, error: errorCorrecciones } = cargarCorrecciones();

  try {
    if (new URL(req.url).pathname === '/api/estado') {
      const estado = await almacen.leerEstado();
      return Response.json(construirEstado({ estado, config, errorCorrecciones, ahora }), { headers: SIN_CACHE });
    }

    const datos = await almacen.leerDatos();
    // La página manda If-None-Match: si nada cambió, se responde 304 sin cuerpo y se ahorra ancho de banda.
    const etag = `W/"${createHash('sha1')
      .update(JSON.stringify([datos?.actualizado ?? null, config.modoReal, config.modoConsenso, correcciones]))
      .update(JSON.stringify(cargarCalendario()))
      .digest('base64url')
      .slice(0, 20)}"`;
    if (req.headers.get('if-none-match') === etag) {
      return new Response(null, { status: 304, headers: { ...SIN_CACHE, ETag: etag } });
    }
    const vista = construirVista({
      calendario: cargarCalendario(),
      datos,
      correcciones,
      config,
      esConsultable: (fila) => tieneFuente(fila, config.modoReal),
      ahora,
    });
    return Response.json(vista, { headers: { ...SIN_CACHE, ETag: etag } });
  } catch (error) {
    console.error('[datos]', (error as Error).message);
    return Response.json({ error: 'No se pudieron leer los datos.' }, { status: 503, headers: SIN_CACHE });
  }
};

export const config: Config = {
  path: ['/api/datos', '/api/estado'],
};
