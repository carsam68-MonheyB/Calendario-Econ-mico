import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { almacenMemoria } from '../src/almacen.ts';
import { leerConfiguracion } from '../src/config.ts';
import { fixVacio, revisarFix, SERIE_FIX, tocaRevisarFix, type Fix } from '../src/fix.ts';
import { vistaFix } from '../src/vista.ts';

const utc = (iso: string) => new Date(iso);
const conFix = (fecha: string, valor: number, anterior: { fecha: string; valor: number } | null = null): Fix => ({
  ...fixVacio(),
  actual: { fecha, valor },
  anterior,
  obtenido: '2026-10-05T18:30:00.000Z',
});

test('sin FIX guardado se intenta en cualquier múltiplo de 15 minutos', () => {
  assert.equal(tocaRevisarFix(null, utc('2026-10-04T09:15:00Z')), true);
  assert.equal(tocaRevisarFix(fixVacio(), utc('2026-10-04T09:30:00Z')), true);
  assert.equal(tocaRevisarFix(null, utc('2026-10-04T09:07:00Z')), false);
});

test('con el FIX de un día anterior se busca en días hábiles de 12:00 a 20:00 del centro cada 30 minutos', () => {
  const viernes = conFix('2026-10-02', 18.4);
  assert.equal(tocaRevisarFix(viernes, utc('2026-10-05T17:30:00Z')), false, '11:30 del centro: todavía no');
  assert.equal(tocaRevisarFix(viernes, utc('2026-10-05T18:00:00Z')), true, '12:00');
  assert.equal(tocaRevisarFix(viernes, utc('2026-10-05T18:15:00Z')), false, '12:15 no es múltiplo de 30');
  assert.equal(tocaRevisarFix(viernes, utc('2026-10-05T18:30:00Z')), true, '12:30');
  assert.equal(tocaRevisarFix(viernes, utc('2026-10-06T02:30:00Z')), true, '20:30 del 5 de octubre');
  assert.equal(tocaRevisarFix(viernes, utc('2026-10-06T03:00:00Z')), false, '21:00 ya no');
  assert.equal(tocaRevisarFix(viernes, utc('2026-10-03T18:30:00Z')), false, 'sábado');
  assert.equal(tocaRevisarFix(conFix('2026-10-05', 18.5), utc('2026-10-05T19:00:00Z')), false, 'ya está el de hoy');
});

const fetchOriginal = globalThis.fetch;
const llamadas: string[] = [];
let respuesta: () => Response;
beforeEach(() => {
  llamadas.length = 0;
  process.env.BANXICO_TOKEN = 'token-banxico-secreto-999';
  globalThis.fetch = (async (entrada: string | URL) => {
    llamadas.push(String(entrada));
    return respuesta();
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = fetchOriginal;
  delete process.env.BANXICO_TOKEN;
});

const sie = (datos: { fecha: string; dato: string }[]) =>
  new Response(JSON.stringify({ bmx: { series: [{ idSerie: SERIE_FIX, datos }] } }), { status: 200, headers: { 'Content-Type': 'application/json' } });

test('guarda el FIX del día y el anterior; no vuelve a consultar ni a escribir si no hay uno nuevo', async () => {
  const memoria = almacenMemoria();
  respuesta = () => sie([{ fecha: '01/10/2026', dato: '18.3500' }, { fecha: '02/10/2026', dato: '18.4123' }, { fecha: '05/10/2026', dato: '18.4555' }]);
  let r = await revisarFix(leerConfiguracion(), memoria.almacen, utc('2026-10-05T18:30:00Z'));
  assert.equal(r, 'actualizado');
  const fix = memoria.actual().fix;
  assert.deepEqual(fix?.actual, { fecha: '2026-10-05', valor: 18.4555 });
  assert.deepEqual(fix?.anterior, { fecha: '2026-10-02', valor: 18.4123 });
  assert.equal(fix?.obtenido, '2026-10-05T18:30:00.000Z');
  assert.match(llamadas[0] ?? '', /SF43718\/datos\/2026-09-25\/2026-10-05$/);
  assert.ok(!llamadas[0]?.includes('token-banxico'), 'el token va en el encabezado, no en la URL');

  // Más tarde el mismo día: ya está el de hoy, ni siquiera se llama a Banxico.
  r = await revisarFix(leerConfiguracion(), memoria.almacen, utc('2026-10-05T19:00:00Z'));
  assert.equal(r, 'omitido');
  assert.equal(llamadas.length, 1);

  // Al día siguiente a las 12:00 Banxico aún muestra el de ayer: sin cambio y sin escritura.
  r = await revisarFix(leerConfiguracion(), memoria.almacen, utc('2026-10-06T18:00:00Z'));
  assert.equal(r, 'sin cambio');
  assert.equal(memoria.conteo.escriturasFix, 1);
});

test('un error de Banxico se registra sin exponer el token y se limpia al recuperarse', async () => {
  const memoria = almacenMemoria({ fix: conFix('2026-10-02', 18.4123) });
  respuesta = () => new Response('{"error":{"mensaje":"token inválido"}}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  let r = await revisarFix(leerConfiguracion(), memoria.almacen, utc('2026-10-05T18:30:00Z'));
  assert.equal(r, 'error');
  assert.match(memoria.actual().fix?.ultimoError?.mensaje ?? '', /Banxico: token inválido/);
  assert.ok(!JSON.stringify(memoria.actual().fix).includes('token-banxico-secreto'));
  assert.deepEqual(memoria.actual().fix?.actual, { fecha: '2026-10-02', valor: 18.4123 }, 'conserva el último FIX bueno');

  respuesta = () => sie([{ fecha: '02/10/2026', dato: '18.4123' }, { fecha: '05/10/2026', dato: '18.4555' }]);
  r = await revisarFix(leerConfiguracion(), memoria.almacen, utc('2026-10-05T19:00:00Z'));
  assert.equal(r, 'actualizado');
  assert.equal(memoria.actual().fix?.ultimoError, null);
});

test('sin token no se llama a Banxico y el error dice qué variable falta', async () => {
  delete process.env.BANXICO_TOKEN;
  const memoria = almacenMemoria();
  respuesta = () => sie([]);
  const r = await revisarFix(leerConfiguracion(), memoria.almacen, utc('2026-10-05T18:30:00Z'));
  assert.equal(r, 'error');
  assert.equal(llamadas.length, 0);
  assert.equal(memoria.actual().fix?.ultimoError?.mensaje, 'Falta la variable BANXICO_TOKEN');
});

test('la vista trae el FIX con su cambio contra el día anterior', () => {
  assert.equal(vistaFix(null), null);
  assert.equal(vistaFix(fixVacio()), null);
  const v = vistaFix(conFix('2026-10-05', 18.4555, { fecha: '2026-10-02', valor: 18.4123 }));
  assert.equal(v?.valor, 18.4555);
  assert.deepEqual(v?.cambio, { absoluto: 0.0432, porcentaje: 0.23 });
  assert.equal(v?.fuente, 'Banxico');
  assert.match(v?.url ?? '', /^https:\/\/www\.banxico\.org\.mx\//);
  assert.equal(vistaFix(conFix('2026-10-05', 18.4555))?.cambio, null);
});
