import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { leerCalendario } from '../src/calendario.ts';
import { leerConfiguracion } from '../src/config.ts';
import { crearConsultorOficial } from '../src/consultor.ts';
import { sincronizar } from '../src/datos.ts';
import type { EventoGuardado } from '../src/modelo.ts';

const LLAVES = {
  BLS_API_KEY: 'llave-bls-secreta-123',
  BEA_API_KEY: 'llave-bea-secreta-456',
  CENSUS_API_KEY: 'llave-census-secreta',
  FRED_API_KEY: 'llave-fred-secreta-789',
  INEGI_TOKEN: 'token-inegi-secreto-000',
  BANXICO_TOKEN: 'token-banxico-secreto-111',
};

const eventos = sincronizar(
  leerCalendario(`fecha,hora,pais,indicador,periodo,unidad,tipo,mejor,esperado,real
2026-10-02,06:30,US,Nómina no agrícola,sep,miles,nivel,alto,89,
2026-10-02,06:30,US,Tasa de desempleo,sep,%,pct,bajo,4.1,
2026-10-14,06:30,US,CPI general anual,sep,% a/a,pct,bajo,,
2026-11-25,07:30,US,PIB (2a estimación),3T,% t/t anualizado,pct,alto,,
2026-11-05,13:00,MX,Decisión de Banxico (tasa objetivo),nov,%,tasa,neutral,,
2026-10-08,06:00,MX,INPC general anual,sep,% a/a,pct,bajo,,
2026-10-28,12:00,US,Decisión de la Fed (límite superior),oct,%,tasa,neutral,,
`),
  null,
  new Date('2026-10-01T00:00:00Z'),
).eventos;
const evento = (inicio: string) => eventos.find((e) => e.id.startsWith(inicio)) as EventoGuardado;

type Ruta = (url: URL, init?: RequestInit) => Response | Promise<Response>;
let rutas: Ruta;
const fetchOriginal = globalThis.fetch;
const llamadas: string[] = [];

beforeEach(() => {
  llamadas.length = 0;
  Object.assign(process.env, LLAVES);
  globalThis.fetch = (async (entrada: string | URL, init?: RequestInit) => {
    const url = new URL(String(entrada));
    llamadas.push(url.toString());
    return rutas(url, init);
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = fetchOriginal;
  for (const k of Object.keys(LLAVES)) delete process.env[k];
});

const json = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } });

const blsSeptiembre = {
  status: 'REQUEST_SUCCEEDED',
  Results: {
    series: [
      {
        seriesID: 'CES0000000001',
        data: [{ year: '2026', period: 'M09', value: '159044' }, { year: '2026', period: 'M08', value: '159015' }, { year: '2026', period: 'M07', value: '158990' }],
      },
      { seriesID: 'LNS14000000', data: [{ year: '2026', period: 'M09', value: '4.2' }, { year: '2026', period: 'M08', value: '4.3' }] },
    ],
  },
};

test('nómina y desempleo de septiembre salen de BLS con el valor del boletín', async () => {
  rutas = (url) => (url.hostname === 'api.bls.gov' ? json(blsSeptiembre) : json({}, 404));
  const consultar = crearConsultorOficial(leerConfiguracion());
  const r = await consultar({ aConsultar: [evento('2026-10-02-us-nomina'), evento('2026-10-02-us-tasa')], paraRevision: [], paraAnterior: [] }, new Date());
  assert.deepEqual(
    r.valores.map((v) => [v.id, v.valor, v.fuente]),
    [
      ['2026-10-02-us-nomina-no-agricola', 29, 'BLS'],
      ['2026-10-02-us-tasa-de-desempleo', 4.2, 'BLS'],
    ],
  );
  // El dato anterior sale de la misma respuesta: el cambio de agosto y la tasa de agosto.
  assert.deepEqual(
    r.anteriores.map((v) => [v.id, v.valor, v.fuente]),
    [
      ['2026-10-02-us-nomina-no-agricola', 25, 'BLS'],
      ['2026-10-02-us-tasa-de-desempleo', 4.3, 'BLS'],
    ],
  );
  assert.deepEqual(r.intentos, { BLS: { ok: true } });
  assert.equal(llamadas.length, 1, 'una sola llamada a BLS para las dos series');
});

test('solo el dato anterior: se calcula el periodo previo sin pedir el real', async () => {
  const hastaAgosto = {
    status: 'REQUEST_SUCCEEDED',
    Results: { series: [{ seriesID: 'CUUR0000SA0', data: [{ year: '2026', period: 'M08', value: '334.980' }, { year: '2025', period: 'M08', value: '323.976' }] }] },
  };
  rutas = () => json(hastaAgosto);
  const r = await crearConsultorOficial(leerConfiguracion())({ aConsultar: [], paraRevision: [], paraAnterior: [evento('2026-10-14-us-cpi')] }, new Date());
  assert.deepEqual(r.valores, []);
  assert.equal(r.anteriores.length, 1);
  assert.equal(r.anteriores[0]?.valor.toFixed(1), '3.4');
  assert.equal(r.anteriores[0]?.fuente, 'BLS');
  assert.equal(llamadas.length, 1);
});

test('el anterior de una decisión de Banxico es la tasa vigente, tomada del SIE sin leer los anuncios', async () => {
  rutas = (url) => {
    if (url.pathname.includes('/SieAPIRest/')) {
      return json({ bmx: { series: [{ idSerie: 'SF61745', datos: [{ fecha: '03/11/2026', dato: '6.5000' }, { fecha: '04/11/2026', dato: '6.5000' }] }] } });
    }
    return json({}, 404);
  };
  const r = await crearConsultorOficial(leerConfiguracion())(
    { aConsultar: [], paraRevision: [], paraAnterior: [evento('2026-11-05-mx-decision')] },
    new Date(),
  );
  assert.deepEqual(r.valores, []);
  assert.deepEqual(r.anteriores.map((v) => [v.valor, v.fuente]), [[6.5, 'Banxico']]);
  assert.ok(llamadas.every((u) => !u.includes('anuncios')), 'no hace falta la página de anuncios');
});

test('el anterior de una decisión de la Fed es el límite superior vigente, tomado de FRED', async () => {
  rutas = (url) => {
    if (url.hostname === 'api.stlouisfed.org' && url.searchParams.get('series_id') === 'DFEDTARU') {
      return json({ observations: [{ date: '2026-10-26', value: '4.25' }, { date: '2026-10-27', value: '4.25' }, { date: '2026-10-28', value: '4.00' }] });
    }
    return json({}, 404);
  };
  const r = await crearConsultorOficial(leerConfiguracion())(
    { aConsultar: [], paraRevision: [], paraAnterior: [evento('2026-10-28-us-decision')] },
    new Date(),
  );
  assert.deepEqual(r.valores, []);
  assert.deepEqual(r.anteriores.map((v) => [v.valor, v.fuente]), [[4.25, 'FRED']], 'la última observación anterior al día de la reunión');
  assert.ok(llamadas.every((u) => !u.includes('federalreserve.gov')));
});

test('un mes que aún no se publica no toma el dato del mes anterior', async () => {
  const soloAgosto = {
    status: 'REQUEST_SUCCEEDED',
    Results: { series: [{ seriesID: 'CUUR0000SA0', data: [{ year: '2026', period: 'M08', value: '334.980' }, { year: '2025', period: 'M08', value: '323.976' }] }] },
  };
  rutas = () => json(soloAgosto);
  const r = await crearConsultorOficial(leerConfiguracion())({ aConsultar: [evento('2026-10-14-us-cpi')], paraRevision: [], paraAnterior: [] }, new Date());
  assert.deepEqual(r.valores, []);
  assert.deepEqual(r.intentos, { BLS: { ok: true } });
});

test('si BLS falla, se usa FRED como respaldo', async () => {
  rutas = (url) => {
    if (url.hostname === 'api.bls.gov') return json({}, 503);
    if (url.hostname === 'api.stlouisfed.org') {
      const serie = url.searchParams.get('series_id');
      return json({ observations: serie === 'PAYEMS' ? [{ date: '2026-08-01', value: '159015' }, { date: '2026-09-01', value: '159044' }] : [{ date: '2026-09-01', value: '4.2' }] });
    }
    return json({}, 404);
  };
  const r = await crearConsultorOficial(leerConfiguracion())({ aConsultar: [evento('2026-10-02-us-nomina')], paraRevision: [], paraAnterior: [] }, new Date());
  assert.deepEqual(r.valores.map((v) => [v.valor, v.fuente, v.url]), [[29, 'FRED (respaldo)', 'https://fred.stlouisfed.org/series/PAYEMS']]);
  assert.deepEqual(r.intentos.BLS, { ok: false, error: 'HTTP 503' });
  assert.deepEqual(r.intentos.FRED, { ok: true });
});

test('sin llave no se llama a la fuente y se avisa qué variable falta', async () => {
  delete process.env.INEGI_TOKEN;
  rutas = () => json({}, 500);
  const r = await crearConsultorOficial(leerConfiguracion())({ aConsultar: [evento('2026-10-08-mx-inpc')], paraRevision: [], paraAnterior: [] }, new Date());
  assert.deepEqual(r.intentos.INEGI, { ok: false, error: 'Falta la variable INEGI_TOKEN' });
  assert.equal(llamadas.length, 0);
});

test('PIB segunda estimación: solo vale si BEA ya revisó la tabla ese día', async () => {
  const bea = (revisado: string) => ({
    BEAAPI: {
      Results: {
        Data: [{ SeriesCode: 'A191RL', TimePeriod: '2026Q3', DataValue: '2.8' }],
        Notes: [{ NoteRef: 'T10101', NoteText: `Table 1.1.1. ... - LastRevised: ${revisado}` }],
      },
    },
  });
  const pib = evento('2026-11-25-us-pib');
  rutas = () => json(bea('October 29, 2026'));
  let r = await crearConsultorOficial(leerConfiguracion())({ aConsultar: [pib], paraRevision: [], paraAnterior: [] }, new Date());
  assert.deepEqual(r.valores, [], 'todavía es la cifra del avance');
  rutas = () => json(bea('November 25, 2026'));
  r = await crearConsultorOficial(leerConfiguracion())({ aConsultar: [pib], paraRevision: [], paraAnterior: [] }, new Date());
  assert.deepEqual(r.valores.map((v) => [v.valor, v.fuente]), [[2.8, 'BEA']]);
});

test('decisión de Banxico: un recorte se aplica a la tasa vigente ese día', async () => {
  const lista = readFileSync(new URL('./fixtures/banxico-anuncios.html', import.meta.url))
    .toString('latin1')
    .replace('24/09/26', '05/11/26')
    .replace('se mantiene sin cambio en 6.50 por ciento', 'disminuye en 25 puntos base');
  rutas = (url) => {
    if (url.pathname.includes('anuncios-politica-monetaria')) return new Response(Buffer.from(lista, 'latin1'), { status: 200 });
    if (url.pathname.includes('/SieAPIRest/')) {
      return json({ bmx: { series: [{ idSerie: 'SF61745', datos: [{ fecha: '04/11/2026', dato: '6.5000' }, { fecha: '05/11/2026', dato: '6.5000' }] }] } });
    }
    return json({}, 404);
  };
  const r = await crearConsultorOficial(leerConfiguracion())({ aConsultar: [evento('2026-11-05-mx-decision')], paraRevision: [], paraAnterior: [] }, new Date());
  assert.equal(r.valores[0]?.valor, 6.25);
  assert.equal(r.valores[0]?.fuente, 'Banxico');
  assert.match(r.valores[0]?.url ?? '', /\.pdf$/);
});

test('los errores nunca llevan llaves', async () => {
  rutas = (url) => {
    throw new Error(`conexión rechazada en ${url.toString()}`);
  };
  const r = await crearConsultorOficial(leerConfiguracion())(
    { aConsultar: [evento('2026-10-02-us-nomina'), evento('2026-10-08-mx-inpc'), evento('2026-11-25-us-pib')], paraRevision: [], paraAnterior: [] },
    new Date(),
  );
  const texto = JSON.stringify(r);
  for (const llave of Object.values(LLAVES)) assert.ok(!texto.includes(llave), `se filtró ${llave}`);
  assert.equal(r.intentos.INEGI?.ok, false);
});
