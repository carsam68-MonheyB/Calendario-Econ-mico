// GET /api/tipo-cambio: precio de mercado USD/MXN al momento, desde el caché en Blobs.

import type { Config } from '@netlify/functions';
import { almacenBlobs } from '../../src/almacen.ts';
import { horaActual } from '../../src/archivos.ts';
import { leerConfiguracion } from '../../src/config.ts';
import { obtenerMercado, respuestaMercado } from '../../src/mercado.ts';

const ENCABEZADOS = {
  'Cache-Control': 'no-store',
  // La CDN de Netlify sirve la misma respuesta a todos durante un minuto: una invocación por minuto, no una por visitante.
  'Netlify-CDN-Cache-Control': 'public, max-age=60, durable',
};

export default async (req: Request) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response('Método no permitido', { status: 405, headers: { ...ENCABEZADOS, Allow: 'GET, HEAD' } });
  }
  try {
    const mercado = await obtenerMercado(leerConfiguracion(), almacenBlobs(), horaActual());
    return Response.json(respuestaMercado(mercado), { headers: ENCABEZADOS });
  } catch (error) {
    console.error('[tipo-cambio]', (error as Error).message);
    return Response.json({ disponible: false, error: 'No se pudo leer el tipo de cambio.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
};

export const config: Config = {
  path: '/api/tipo-cambio',
};
