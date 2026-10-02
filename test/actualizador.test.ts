import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ejecutarCorrida, type Consultor, type PeticionConsulta } from '../src/actualizador.ts';
import { almacenMemoria } from '../src/almacen.ts';
import { leerCalendario } from '../src/calendario.ts';
import { leerCorrecciones } from '../src/correcciones.ts';

const calendario = leerCalendario(`fecha,hora,pais,indicador,periodo,unidad,tipo,mejor,esperado,real
2026-10-02,06:30,US,Nómina no agrícola,sep,miles,nivel,alto,89,29
2026-10-02,06:30,US,Tasa de desempleo,sep,%,pct,bajo,4.1,
2026-10-05,08:00,US,ISM servicios,sep,índice,nivel,alto,,
2026-10-07,12:00,US,Minutas del FOMC,reunión 15-16 sep,,evento,neutral,,
2026-11-06,07:30,US,Nómina no agrícola,oct,miles,nivel,alto,,
`);

const sinIsm = (f: { indicador: string }) => !f.indicador.startsWith('ISM');
const utc = (iso: string) => new Date(iso);

function consultorFijo(valores: Record<string, number>, intentos: Record<string, { ok: boolean; error?: string }> = { BLS: { ok: true } }) {
  const peticiones: PeticionConsulta[] = [];
  const consultar: Consultor = async (peticion) => {
    peticiones.push(peticion);
    const ids = [...peticion.aConsultar, ...peticion.paraRevision].map((e) => e.id);
    return {
      valores: ids.filter((id) => id in valores).map((id) => ({ id, valor: valores[id]!, fuente: 'BLS', url: 'https://www.bls.gov/' })),
      intentos,
    };
  };
  return { consultar, peticiones };
}

const base = { calendario, correcciones: [], esConsultable: sinIsm };

test('sin ventana activa termina sin leer Blobs ni consultar', async () => {
  const { almacen, conteo } = almacenMemoria();
  const { consultar, peticiones } = consultorFijo({});
  const r = await ejecutarCorrida({ ...base, almacen, consultar, ahora: utc('2026-10-04T15:07:00Z') });
  assert.equal(r.motivo, 'sin ventana activa');
  assert.equal(conteo.lecturas, 0);
  assert.equal(peticiones.length, 0);
});

test('primera corrida: carga el CSV, consulta lo que toca y guarda el dato con su fuente', async () => {
  const { almacen, conteo, actual } = almacenMemoria();
  const { consultar, peticiones } = consultorFijo({ '2026-10-02-us-tasa-de-desempleo': 4.2 });
  const r = await ejecutarCorrida({ ...base, almacen, consultar, ahora: utc('2026-10-02T12:31:00Z') });
  assert.equal(r.motivo, 'consulta');
  // La nómina ya trae real en el CSV: no se vuelve a consultar.
  assert.deepEqual(r.consultados, ['2026-10-02-us-tasa-de-desempleo']);
  assert.deepEqual(r.nuevos, ['2026-10-02-us-tasa-de-desempleo']);
  assert.equal(peticiones[0]?.aConsultar.length, 1);
  assert.equal(conteo.escriturasDatos, 1);
  const { datos, estado } = actual();
  const desempleo = datos?.eventos.find((e) => e.id === '2026-10-02-us-tasa-de-desempleo');
  assert.equal(desempleo?.real?.valor, 4.2);
  assert.equal(desempleo?.real?.fuente, 'BLS');
  assert.equal(desempleo?.estado, 'publicado');
  assert.equal(datos?.eventos.find((e) => e.id === '2026-10-02-us-nomina-no-agricola')?.real?.fuente, 'Dataset');
  assert.equal(estado?.fuentes.BLS?.ultimoExito, '2026-10-02T12:31:00.000Z');
});

test('con el dato ya publicado deja de consultar y no reescribe', async () => {
  const memoria = almacenMemoria();
  const primero = consultorFijo({ '2026-10-02-us-tasa-de-desempleo': 4.2 });
  await ejecutarCorrida({ ...base, almacen: memoria.almacen, consultar: primero.consultar, ahora: utc('2026-10-02T12:31:00Z') });
  const segundo = consultorFijo({ '2026-10-02-us-tasa-de-desempleo': 4.3 });
  const r = await ejecutarCorrida({ ...base, almacen: memoria.almacen, consultar: segundo.consultar, ahora: utc('2026-10-02T12:32:00Z') });
  assert.equal(r.motivo, 'ya publicados');
  assert.equal(segundo.peticiones.length, 0);
  assert.equal(memoria.conteo.escriturasDatos, 1);
});

test('una revisión posterior se guarda aparte y no toca la primera cifra', async () => {
  const memoria = almacenMemoria();
  const { consultar, peticiones } = consultorFijo({
    '2026-11-06-us-nomina-no-agricola': 120,
    '2026-10-02-us-nomina-no-agricola': 41,
  });
  const r = await ejecutarCorrida({ ...base, almacen: memoria.almacen, consultar, ahora: utc('2026-11-06T13:30:00Z') });
  assert.deepEqual(r.nuevos, ['2026-11-06-us-nomina-no-agricola']);
  assert.deepEqual(r.revisados, ['2026-10-02-us-nomina-no-agricola']);
  assert.deepEqual(peticiones[0]?.paraRevision.map((e) => e.id), ['2026-10-02-us-nomina-no-agricola']);
  const sep = memoria.actual().datos?.eventos.find((e) => e.id === '2026-10-02-us-nomina-no-agricola');
  assert.equal(sep?.real?.valor, 29);
  assert.equal(sep?.revision?.valor, 41);
});

test('un error de la fuente queda en "estado" y el evento sigue esperando', async () => {
  const memoria = almacenMemoria();
  const { consultar } = consultorFijo({}, { BLS: { ok: false, error: 'HTTP 503' } });
  const r = await ejecutarCorrida({ ...base, almacen: memoria.almacen, consultar, ahora: utc('2026-10-02T12:30:00Z') });
  assert.deepEqual(r.nuevos, []);
  const { datos, estado } = memoria.actual();
  assert.equal(estado?.fuentes.BLS?.ultimoError?.mensaje, 'HTTP 503');
  assert.equal(estado?.fuentes.BLS?.ultimoExito, null);
  assert.equal(datos?.eventos.find((e) => e.id === '2026-10-02-us-tasa-de-desempleo')?.estado, 'esperando');
});

test('no acepta valores de eventos que no se pidieron', async () => {
  const memoria = almacenMemoria();
  const { consultar } = consultorFijo({ '2026-11-06-us-nomina-no-agricola': 120, '2026-10-02-us-tasa-de-desempleo': 4.2 });
  const r = await ejecutarCorrida({ ...base, almacen: memoria.almacen, consultar, ahora: utc('2026-10-02T12:30:00Z') });
  assert.deepEqual(r.nuevos, ['2026-10-02-us-tasa-de-desempleo']);
  assert.equal(memoria.actual().datos?.eventos.find((e) => e.id === '2026-11-06-us-nomina-no-agricola')?.real, null);
});

test('una corrección manual se aplica, se marca "Manual" y deja de consultarse', async () => {
  const memoria = almacenMemoria();
  const { correcciones } = leerCorrecciones('[{"fecha":"2026-10-02","pais":"US","indicador":"Tasa de desempleo","real":4.3}]');
  const { consultar, peticiones } = consultorFijo({ '2026-10-02-us-tasa-de-desempleo': 4.2 });
  await ejecutarCorrida({ ...base, correcciones, almacen: memoria.almacen, consultar, ahora: utc('2026-10-02T12:31:00Z') });
  assert.equal(peticiones.length, 0);
  const evento = memoria.actual().datos?.eventos.find((e) => e.id === '2026-10-02-us-tasa-de-desempleo');
  assert.equal(evento?.real?.valor, 4.3);
  assert.equal(evento?.real?.fuente, 'Manual');
});

test('correcciones mal escritas no se aplican y se informa el motivo', () => {
  assert.match(leerCorrecciones('{').error ?? '', /correcciones.json/);
  assert.match(leerCorrecciones('[{"fecha":"2026-10-02","pais":"US"}]').error ?? '', /faltan/);
  assert.match(leerCorrecciones('[{"fecha":"2026-10-02","pais":"US","indicador":"X","real":"4.2"}]').error ?? '', /número/);
  assert.equal(leerCorrecciones('[]').error, null);
});
