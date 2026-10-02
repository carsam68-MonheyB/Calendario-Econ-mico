import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { leerCalendario } from '../src/calendario.ts';
import {
  aplicarConsensos,
  consensoVacio,
  eventosSinConsenso,
  firmar,
  firmaValida,
  registrarIntento,
  tocaRevisarConsenso,
} from '../src/consenso.ts';
import { sincronizar } from '../src/datos.ts';
import { almacenMemoria } from '../src/almacen.ts';
import { leerConfiguracion } from '../src/config.ts';
import { consultarConsenso, leerJsonConsenso, preguntaConsenso } from '../src/organismos/claude.ts';
import { buscarEventoTe, valorTe } from '../src/organismos/te.ts';
import { revisarConsenso } from '../src/programada.ts';
import { ventanas } from '../src/programacion.ts';

const calendario = leerCalendario(`fecha,hora,pais,indicador,periodo,unidad,tipo,mejor,esperado,real
2026-10-02,06:30,US,Nómina no agrícola,sep,miles,nivel,alto,89,29
2026-10-07,12:00,US,Minutas del FOMC,reunión 15-16 sep,,evento,neutral,,
2026-10-08,06:00,MX,INPC general anual,sep,% a/a,pct,bajo,,
2026-10-08,,MX,Minuta de Banxico,decisión 24 sep,,evento,neutral,,
2026-10-14,06:30,US,CPI general anual,sep,% a/a,pct,bajo,,
2026-10-22,06:00,MX,INPC general anual 1a quincena,oct,% a/a,pct,bajo,,
2026-10-28,12:00,US,Decisión de la Fed (límite superior),oct,%,tasa,neutral,,
2026-10-29,06:30,US,PIB (avance),3T,% t/t anualizado,pct,alto,,
`);
const inicio = (f: (typeof calendario)[number]) => ventanas(f).inicio;
const utc = (iso: string) => new Date(iso);
const ids = (filas: { id: string }[]) => filas.map((f) => f.id);

test('se revisa a las 20, 21 y 22 h de la víspera y a las 5 h del día, en el minuto 0', () => {
  assert.equal(tocaRevisarConsenso(utc('2026-10-08T02:00:00Z')), true); // 20:00 del centro
  assert.equal(tocaRevisarConsenso(utc('2026-10-08T02:15:00Z')), false);
  assert.equal(tocaRevisarConsenso(utc('2026-10-08T11:00:00Z')), true); // 5:00 del centro
  assert.equal(tocaRevisarConsenso(utc('2026-10-08T15:00:00Z')), false);
});

test('a las 20:00 de la víspera se piden los eventos de mañana con valores y sin esperado', () => {
  const a20 = utc('2026-10-08T02:00:00Z'); // 7 oct, 20:00 del centro
  assert.deepEqual(ids(eventosSinConsenso(calendario, null, a20, inicio)), ['2026-10-08-mx-inpc-general-anual']);
  // Antes de las 20:00 todavía no toca.
  assert.deepEqual(ids(eventosSinConsenso(calendario, null, utc('2026-10-08T01:00:00Z'), inicio)), []);
  // Un evento con esperado capturado en el CSV no se pide.
  assert.deepEqual(ids(eventosSinConsenso(calendario, null, utc('2026-10-02T02:00:00Z'), inicio)), []);
});

test('el mismo día se pide solo si aún no se publica; los errores se reintentan cada hora hasta 3 veces', () => {
  const a5 = utc('2026-10-08T11:00:00Z'); // 8 oct, 5:00 del centro, antes de las 6:00
  assert.deepEqual(ids(eventosSinConsenso(calendario, null, a5, inicio)), ['2026-10-08-mx-inpc-general-anual']);
  assert.deepEqual(ids(eventosSinConsenso(calendario, null, utc('2026-10-08T12:01:00Z'), inicio)), []);

  const c = consensoVacio();
  registrarIntento(c, '2026-10-08-mx-inpc-general-anual', utc('2026-10-08T02:00:00Z'), { error: 'Anthropic: error 529' });
  assert.equal(eventosSinConsenso(calendario, c, utc('2026-10-08T02:30:00Z'), inicio).length, 0, 'menos de una hora');
  assert.equal(eventosSinConsenso(calendario, c, utc('2026-10-08T03:00:00Z'), inicio).length, 1);
  registrarIntento(c, '2026-10-08-mx-inpc-general-anual', utc('2026-10-08T03:00:00Z'), { error: 'x' });
  registrarIntento(c, '2026-10-08-mx-inpc-general-anual', utc('2026-10-08T04:00:00Z'), { error: 'x' });
  assert.equal(eventosSinConsenso(calendario, c, utc('2026-10-08T11:00:00Z'), inicio).length, 0, 'tres intentos');

  const resuelto = consensoVacio();
  registrarIntento(resuelto, '2026-10-08-mx-inpc-general-anual', utc('2026-10-08T02:00:00Z'), { valor: null, fuente: 'x', url: null });
  assert.equal(eventosSinConsenso(calendario, resuelto, utc('2026-10-08T11:00:00Z'), inicio).length, 0, 'sin consenso claro no se repite');
});

test('el consenso solo llena un esperado vacío y guarda de dónde vino', () => {
  const datos = sincronizar(calendario, null, utc('2026-10-01T00:00:00Z'));
  const c = consensoVacio();
  registrarIntento(c, '2026-10-08-mx-inpc-general-anual', utc('2026-10-08T02:05:00Z'), { valor: 3.8, fuente: 'Citi (búsqueda de Claude)', url: 'https://x.mx' });
  registrarIntento(c, '2026-10-02-us-nomina-no-agricola', utc('2026-10-01T02:05:00Z'), { valor: 120, fuente: 'Otra', url: null });
  aplicarConsensos(datos.eventos, c);
  const inpc = datos.eventos.find((e) => e.id === '2026-10-08-mx-inpc-general-anual');
  assert.deepEqual(inpc?.esperado, { valor: 3.8, fuente: 'Citi (búsqueda de Claude)', url: 'https://x.mx', obtenido: '2026-10-08T02:05:00.000Z' });
  assert.equal(datos.eventos.find((e) => e.id === '2026-10-02-us-nomina-no-agricola')?.esperado?.valor, 89, 'el CSV manda');
});

test('firma de la llamada a la Background Function', () => {
  const ahora = utc('2026-10-08T02:00:00Z');
  const marca = String(ahora.getTime());
  const cuerpo = '{"ids":["a"]}';
  const firma = firmar(cuerpo, marca, 'secreto');
  assert.equal(firmaValida(cuerpo, marca, firma, 'secreto', ahora), true);
  assert.equal(firmaValida('{"ids":["b"]}', marca, firma, 'secreto', ahora), false, 'cuerpo alterado');
  assert.equal(firmaValida(cuerpo, marca, firma, 'otro', ahora), false, 'otra llave');
  assert.equal(firmaValida(cuerpo, marca, firma, 'secreto', utc('2026-10-08T02:11:00Z')), false, 'vencida');
  assert.equal(firmaValida(cuerpo, null, firma, 'secreto', ahora), false);
});

test('Claude: la pregunta describe periodo, medición y unidad', () => {
  const q = preguntaConsenso(calendario.find((f) => f.id === '2026-10-22-mx-inpc-general-anual-1a-quincena')!);
  assert.match(q, /México, INPC general anual 1a quincena/);
  assert.match(q, /primera quincena de octubre de 2026/);
  assert.match(q, /cifras originales/);
  assert.match(q, /jueves 22 de octubre de 2026 a las 06:00/);
  const fed = preguntaConsenso(calendario.find((f) => f.id.includes('fed'))!);
  assert.match(fed, /límite superior del rango objetivo/);
  assert.match(fed, /miércoles 28 de octubre de 2026/);
});

test('Claude: lectura del JSON de la respuesta', () => {
  assert.deepEqual(leerJsonConsenso('{"valor": 3.1, "fuente": "Reuters", "url": "https://www.reuters.com/a"}'), {
    valor: 3.1,
    fuente: 'Reuters',
    url: 'https://www.reuters.com/a',
  });
  assert.deepEqual(leerJsonConsenso('Encontré esto:\n{"valor": "-78.5", "fuente": "Bloomberg", "url": "javascript:alert(1)"}'), {
    valor: -78.5,
    fuente: 'Bloomberg',
    url: null,
  });
  assert.deepEqual(leerJsonConsenso('{"valor": null, "fuente": "", "url": ""}'), { valor: null, fuente: '', url: null });
  assert.equal(leerJsonConsenso('No hay consenso.'), null);
  assert.equal(leerJsonConsenso('{"valor": "alto"}'), null);
});

const fetchOriginal = globalThis.fetch;
const pedidos: { url: string; cuerpo: Record<string, unknown>; encabezados: Headers }[] = [];
let respuestas: unknown[] = [];
beforeEach(() => {
  pedidos.length = 0;
  globalThis.fetch = (async (entrada: string | URL | Request, init?: RequestInit) => {
    const url = entrada instanceof Request ? entrada.url : String(entrada);
    const cuerpo = init?.body ? JSON.parse(String(init.body)) : {};
    pedidos.push({ url, cuerpo, encabezados: new Headers(init?.headers) });
    const siguiente = respuestas.shift();
    return new Response(JSON.stringify(siguiente ?? {}), { status: 200, headers: { 'Content-Type': 'application/json', 'request-id': 'req_1' } });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = fetchOriginal;
  delete process.env.FUENTE_CONSENSO;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.TE_API_KEY;
  delete process.env.URL;
});

const mensaje = (stop: string, texto: string | null) => ({
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-5-5',
  content: texto === null ? [{ type: 'server_tool_use', id: 'srv_1', name: 'web_search', input: { query: 'x' } }] : [{ type: 'text', text: texto }],
  stop_reason: stop,
  stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 5, server_tool_use: { web_search_requests: 1 } },
});

test('Claude: modelo, búsqueda web, respaldo por rechazo y reanudación de pause_turn', async () => {
  respuestas = [mensaje('pause_turn', null), mensaje('end_turn', '{"valor": 3.8, "fuente": "Encuesta Citi", "url": "https://www.citi.com/x"}')];
  const fila = calendario.find((f) => f.id === '2026-10-08-mx-inpc-general-anual')!;
  const r = await consultarConsenso(fila, 'sk-ant-prueba-123456');
  assert.deepEqual(r, { valor: 3.8, fuente: 'Encuesta Citi', url: 'https://www.citi.com/x', busquedas: 2 });
  assert.equal(pedidos.length, 2);
  const primero = pedidos[0]!;
  assert.match(primero.url, /api\.anthropic\.com\/v1\/messages/);
  assert.equal(primero.cuerpo.model, 'claude-opus-5-5');
  assert.equal(primero.cuerpo.fallbacks, 'default');
  assert.match(primero.encabezados.get('anthropic-beta') ?? '', /server-side-fallback-2026-07-01/);
  assert.deepEqual((primero.cuerpo.tools as { type: string }[])[0]?.type, 'web_search_20260318');
  // La reanudación reenvía el turno pausado sin agregar mensajes nuevos del usuario.
  const mensajes = pedidos[1]!.cuerpo.messages as { role: string }[];
  assert.deepEqual(mensajes.map((m) => m.role), ['user', 'assistant']);
});

test('Claude: un rechazo o una respuesta sin JSON es un error, nunca un dato inventado', async () => {
  const fila = calendario.find((f) => f.id === '2026-10-08-mx-inpc-general-anual')!;
  respuestas = [mensaje('refusal', '')];
  await assert.rejects(consultarConsenso(fila, 'sk-ant-prueba-123456'), /rechazada/);
  respuestas = [mensaje('end_turn', 'Creo que será alrededor de 3.8')];
  await assert.rejects(consultarConsenso(fila, 'sk-ant-prueba-123456'), /JSON/);
});

test('Trading Economics: conversión de unidades y búsqueda del evento', () => {
  assert.equal(valorTe('150K', '', 'miles'), 150);
  assert.equal(valorTe('-78.3B', 'USD', 'mmd USD'), -78.3);
  assert.equal(valorTe('USD -1.2B', '', 'mdd'), -1200);
  assert.equal(valorTe('605.4', 'USD Million', 'mdd'), 605.4);
  assert.equal(valorTe('7.2M', '', 'millones'), 7.2);
  assert.equal(valorTe('3.1%', '%', '% a/a'), 3.1);
  assert.equal(valorTe('', '%', '% a/a'), null);
  const fila = calendario.find((f) => f.id === '2026-10-14-us-cpi-general-anual')!;
  const eventos = [
    { Country: 'United States', Event: 'Inflation Rate MoM', Date: '2026-10-14T12:30:00', Reference: 'Sep', Actual: '0.3%' },
    { Country: 'United States', Event: 'Inflation Rate YoY', Date: '2026-10-14T12:30:00', Reference: 'Sep', Actual: '3.1%', Forecast: '3.0%', URL: '/united-states/inflation-cpi' },
    { Country: 'Mexico', Event: 'Inflation Rate YoY', Date: '2026-10-08T12:00:00', Reference: 'Sep', Actual: '3.7%' },
  ];
  assert.equal(buscarEventoTe(fila, eventos)?.Actual, '3.1%');
  const pib = calendario.find((f) => f.id === '2026-10-29-us-pib-avance')!;
  assert.equal(buscarEventoTe(pib, [{ Country: 'United States', Event: 'GDP Growth Rate QoQ Adv', Date: '2026-10-29T12:30:00', Reference: 'Q3', Actual: '2.1%' }])?.Actual, '2.1%');
  assert.equal(buscarEventoTe(pib, [{ Country: 'United States', Event: 'GDP Growth Rate QoQ Adv', Date: '2026-10-29T12:30:00', Reference: 'Q2', Actual: '2.1%' }]), null, 'otro trimestre');
});

test('modo tradingeconomics: el consenso es "Forecast", no "TEForecast"', async () => {
  process.env.FUENTE_CONSENSO = 'tradingeconomics';
  process.env.TE_API_KEY = 'te-llave-prueba-123';
  respuestas = [[{ Country: 'Mexico', Event: 'Inflation Rate YoY', Date: '2026-10-08T12:00:00', Reference: 'Sep', Forecast: '3.8%', TEForecast: '3.9%', URL: '/mexico/inflation-cpi' }]];
  const memoria = almacenMemoria();
  const n = await revisarConsenso(leerConfiguracion(), calendario, memoria.almacen, utc('2026-10-08T02:00:00Z'));
  assert.equal(n, 1);
  const c = memoria.actual().consenso?.eventos['2026-10-08-mx-inpc-general-anual'];
  assert.equal(c?.valor, 3.8);
  assert.equal(c?.fuente, 'Trading Economics (consenso)');
  assert.ok(!JSON.stringify(memoria.actual()).includes('te-llave-prueba-123'));
});

test('modo claude: dispara la Background Function con la lista firmada', async () => {
  process.env.FUENTE_CONSENSO = 'claude';
  process.env.ANTHROPIC_API_KEY = 'sk-ant-prueba-123456';
  process.env.URL = 'https://calendario.example';
  respuestas = [{}];
  const ahora = utc('2026-10-08T02:00:00Z');
  const n = await revisarConsenso(leerConfiguracion(), calendario, almacenMemoria().almacen, ahora);
  assert.equal(n, 1);
  const p = pedidos[0]!;
  assert.equal(p.url, 'https://calendario.example/.netlify/functions/consenso-background');
  assert.deepEqual(p.cuerpo, { ids: ['2026-10-08-mx-inpc-general-anual'] });
  assert.equal(firmaValida(JSON.stringify(p.cuerpo), p.encabezados.get('x-calendario-marca'), p.encabezados.get('x-calendario-firma'), 'sk-ant-prueba-123456', ahora), true);
});
