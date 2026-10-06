import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { almacenMemoria } from '../src/almacen.ts';
import { leerConfiguracion } from '../src/config.ts';
import { leerCotizacion, mercadoVacio, mercadoVigente, obtenerMercado, respuestaMercado, type Mercado } from '../src/mercado.ts';

const utc = (iso: string) => new Date(iso);

test('lee la cotización de Twelve Data y calcula el cambio contra el cierre anterior', () => {
  const c = leerCotizacion({ symbol: 'USD/MXN', close: '18.21500', previous_close: '18.13500', timestamp: 1791300000, is_market_open: true });
  assert.equal(c.valor, 18.215);
  assert.equal(c.cierreAnterior, 18.135);
  assert.deepEqual(c.cambio, { absoluto: 0.08, porcentaje: 0.44 });
  assert.equal(c.hora, '2026-10-06T15:20:00.000Z');
  assert.equal(c.abierto, true);
  assert.throws(() => leerCotizacion({ status: 'error', code: 401, message: 'Invalid API key: abc' }), /Twelve Data: Invalid API key/);
  assert.throws(() => leerCotizacion({ close: 'N/A' }), /cotización inválida/);
});

test('el caché vale 2 minutos con el mercado abierto y 30 con el mercado cerrado', () => {
  const abierto: Mercado = { ...mercadoVacio(), valor: 18.2, abierto: true, obtenido: '2026-10-06T19:00:00.000Z' };
  assert.equal(mercadoVigente(abierto, utc('2026-10-06T19:01:59Z')), true);
  assert.equal(mercadoVigente(abierto, utc('2026-10-06T19:02:00Z')), false);
  const cerrado: Mercado = { ...abierto, abierto: false };
  assert.equal(mercadoVigente(cerrado, utc('2026-10-06T19:29:00Z')), true);
  assert.equal(mercadoVigente(cerrado, utc('2026-10-06T19:30:00Z')), false);
  assert.equal(mercadoVigente(mercadoVacio(), utc('2026-10-06T19:00:00Z')), false);
});

const fetchOriginal = globalThis.fetch;
const llamadas: { url: string; auth: string | null }[] = [];
let respuesta: () => Response;
beforeEach(() => {
  llamadas.length = 0;
  process.env.TWELVEDATA_API_KEY = 'llave-twelve-secreta-777';
  globalThis.fetch = (async (entrada: string | URL, init?: RequestInit) => {
    llamadas.push({ url: String(entrada), auth: new Headers(init?.headers).get('authorization') });
    return respuesta();
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = fetchOriginal;
  delete process.env.TWELVEDATA_API_KEY;
});
const json = (cuerpo: unknown) => new Response(JSON.stringify(cuerpo), { status: 200, headers: { 'Content-Type': 'application/json' } });

test('consulta al proveedor solo cuando el caché venció; la llave va en el encabezado', async () => {
  const memoria = almacenMemoria();
  respuesta = () => json({ symbol: 'USD/MXN', close: '18.21500', previous_close: '18.13500', timestamp: 1791300000, is_market_open: true });
  let m = await obtenerMercado(leerConfiguracion(), memoria.almacen, utc('2026-10-06T19:21:00Z'));
  assert.equal(m.valor, 18.215);
  assert.equal(m.obtenido, '2026-10-06T19:21:00.000Z');
  assert.equal(m.hora, m.obtenido, 'la hora mostrada es la de la consulta, no la de la vela diaria del proveedor');
  assert.equal(llamadas.length, 1);
  assert.match(llamadas[0]!.url, /^https:\/\/api\.twelvedata\.com\/quote\?symbol=USD%2FMXN$/);
  assert.equal(llamadas[0]!.auth, 'apikey llave-twelve-secreta-777');

  // Un minuto después: desde el caché, sin llamada.
  m = await obtenerMercado(leerConfiguracion(), memoria.almacen, utc('2026-10-06T19:22:00Z'));
  assert.equal(llamadas.length, 1);
  assert.equal(memoria.conteo.escriturasMercado, 1);

  // Pasados los 2 minutos: nueva cotización.
  respuesta = () => json({ close: '18.22000', previous_close: '18.13500', timestamp: 1791300180, is_market_open: true });
  m = await obtenerMercado(leerConfiguracion(), memoria.almacen, utc('2026-10-06T19:23:30Z'));
  assert.equal(llamadas.length, 2);
  assert.equal(m.valor, 18.22);
  const r = respuestaMercado(m);
  assert.equal(r.disponible, true);
  assert.equal(r.error, null);
  assert.equal(r.simbolo, 'USD/MXN');
});

test('si el proveedor falla se conserva el último precio, se anota el error sin la llave y no se insiste antes de un minuto', async () => {
  const memoria = almacenMemoria({ mercado: { ...mercadoVacio(), valor: 18.2, hora: '2026-10-06T19:00:00.000Z', abierto: true, obtenido: '2026-10-06T19:00:00.000Z' } });
  respuesta = () => json({ status: 'error', code: 429, message: 'You have run out of API credits for the current minute. llave-twelve-secreta-777' });
  let m = await obtenerMercado(leerConfiguracion(), memoria.almacen, utc('2026-10-06T19:10:00Z'));
  assert.equal(m.valor, 18.2);
  assert.match(m.ultimoError?.mensaje ?? '', /run out of API credits/);
  assert.ok(!JSON.stringify(m).includes('llave-twelve-secreta'));
  assert.equal(respuestaMercado(m).disponible, true, 'sigue mostrando el último precio');

  m = await obtenerMercado(leerConfiguracion(), memoria.almacen, utc('2026-10-06T19:10:30Z'));
  assert.equal(llamadas.length, 1, 'medio minuto después no se reintenta');
  respuesta = () => json({ close: '18.25000', previous_close: '18.13500', timestamp: 1791300660, is_market_open: true });
  m = await obtenerMercado(leerConfiguracion(), memoria.almacen, utc('2026-10-06T19:11:01Z'));
  assert.equal(llamadas.length, 2);
  assert.equal(m.valor, 18.25);
  assert.equal(m.ultimoError, null);
});

test('sin llave no se llama al proveedor y la respuesta dice qué variable falta', async () => {
  delete process.env.TWELVEDATA_API_KEY;
  const memoria = almacenMemoria();
  respuesta = () => json({});
  const m = await obtenerMercado(leerConfiguracion(), memoria.almacen, utc('2026-10-06T19:10:00Z'));
  assert.equal(llamadas.length, 0);
  const r = respuestaMercado(m);
  assert.equal(r.disponible, false);
  assert.equal(r.error, 'Falta la variable TWELVEDATA_API_KEY');
});
