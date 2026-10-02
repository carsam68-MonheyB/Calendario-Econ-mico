import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { leerRespuestaBls, periodoBls } from '../src/organismos/bls.ts';
import { fechaDeRevision, leerIta, leerNipa, periodoBea } from '../src/organismos/bea.ts';
import { leerEits } from '../src/organismos/census.ts';
import { leerFred, periodoFred } from '../src/organismos/fred.ts';
import { limiteSuperiorFed, urlComunicadoFed } from '../src/organismos/fed.ts';
import { leerInegi, periodoInegi } from '../src/organismos/inegi.ts';
import { leerAnuncios, leerSie, periodoSie, tasaDesdeTitulo } from '../src/organismos/banxico.ts';
import { calcular } from '../src/fuentes.ts';
import { redondear } from '../src/calculos.ts';

test('BLS: periodos y cálculo del CPI anual con el índice sin ajuste', () => {
  assert.equal(periodoBls('2026', 'M09'), '2026-09');
  assert.equal(periodoBls('2026', 'Q03'), '2026-T3');
  assert.equal(periodoBls('2026', 'M13'), null);
  const datos = leerRespuestaBls({
    status: 'REQUEST_SUCCEEDED',
    Results: {
      series: [
        {
          seriesID: 'CUUR0000SA0',
          data: [
            { year: '2026', period: 'M08', value: '334.980', calculations: { pct_changes: { '12': '3.4' } } },
            { year: '2025', period: 'M08', value: '323.976' },
            { year: '2025', period: 'M10', value: '-' },
          ],
        },
      ],
    },
  });
  const cpi = datos.get('CUUR0000SA0');
  assert.equal(cpi?.has('2025-10'), false);
  const valor = calcular(cpi, { tipo: 'anual' }, { tipo: 'mes', anio: 2026, mes: 8 });
  assert.equal(redondear(valor!, 1), 3.4);
  assert.equal(datos.get('CUUR0000SA0#12m')?.get('2026-08'), 3.4);
  // El periodo que aún no se publica no da valor: se sigue esperando.
  assert.equal(calcular(cpi, { tipo: 'anual' }, { tipo: 'mes', anio: 2026, mes: 9 }), null);
});

test('BLS: errores de cuota sin exponer la llave', () => {
  assert.throws(
    () => leerRespuestaBls({ status: 'REQUEST_NOT_PROCESSED', message: ['daily threshold reached'] }),
    /BLS: daily threshold reached/,
  );
});

test('BEA: periodos, valores y fecha de revisión de la tabla', () => {
  assert.equal(periodoBea('2026Q2'), '2026-T2');
  assert.equal(periodoBea('2026M08'), '2026-08');
  const r = leerNipa('T10101', {
    BEAAPI: {
      Results: {
        Data: [
          { SeriesCode: 'A191RL', LineNumber: '1', TimePeriod: '2026Q2', DataValue: '2.2' },
          { SeriesCode: 'DPCERL', LineNumber: '2', TimePeriod: '2026Q2', DataValue: '1,234.5' },
        ],
        Notes: [{ NoteRef: 'T10101', NoteText: 'Table 1.1.1. Percent Change From Preceding Period in Real GDP - LastRevised: September 25, 2026' }],
      },
    },
  });
  assert.equal(r.series.get('T10101:A191RL')?.get('2026-T2'), 2.2);
  assert.equal(r.series.get('T10101:DPCERL')?.get('2026-T2'), 1234.5);
  assert.equal(r.revisado, '2026-09-25');
  assert.equal(fechaDeRevision([{ NoteText: 'Last Revised on: November 25, 2026' }]), '2026-11-25');
  assert.throws(() => leerNipa('T10101', { BEAAPI: { Results: { Error: { APIErrorDescription: 'Invalid API UserId.' } } } }), /BEA: Invalid/);
  const ita = leerIta({ BEAAPI: { Results: { Data: [{ Indicator: 'BalCurrAcct', AreaOrCountry: 'AllCountries', TimePeriod: '2026Q2', DataValue: '-246023' }] } } });
  assert.equal(calcular(ita.get('ITA:BalCurrAcct'), { tipo: 'escala', factor: 0.001 }, { tipo: 'trimestre', anio: 2026, trimestre: 2 }), -246.023);
});

test('Census: tabla con encabezado', () => {
  const obs = leerEits([
    ['cell_value', 'time_slot_id', 'category_code', 'data_type_code', 'seasonally_adj', 'time'],
    ['1.2', '0', '44X72', 'MPCSM', 'yes', '2026-08'],
    ['0.6', '0', '44X72', 'MPCSM', 'yes', '2026-07'],
  ]);
  assert.equal(obs.get('2026-08'), 1.2);
  assert.throws(() => leerEits({ error: 'x' }), /Census/);
});

test('FRED: fechas por frecuencia y valores faltantes', () => {
  assert.equal(periodoFred('2026-07-01', 'trimestre'), '2026-T3');
  assert.equal(periodoFred('2026-09-01', 'mes'), '2026-09');
  const obs = leerFred({ observations: [{ date: '2026-09-01', value: '159044' }, { date: '2025-10-01', value: '.' }] }, 'mes');
  assert.equal(obs.get('2026-09'), 159044);
  assert.equal(obs.has('2025-10'), false);
});

test('Fed: límite superior del rango con fracciones y guiones especiales', () => {
  assert.equal(urlComunicadoFed('2026-10-28'), 'https://www.federalreserve.gov/newsevents/pressreleases/monetary20261028a.htm');
  assert.equal(
    limiteSuperiorFed('<p>the Committee decided to raise the target range for the federal funds rate by 1/4 percentage point to <strong>3-3/4 to 4 percent</strong>.</p>'),
    4,
  );
  assert.equal(limiteSuperiorFed('decided to maintain the target range for the federal funds rate at 3‑1/2 to 3‑3/4 percent.'), 3.75);
  assert.equal(limiteSuperiorFed('to lower the target range for the federal funds rate by 1/2 percentage point to 4&#8209;3/4 to 5 percent'), 5);
  assert.equal(limiteSuperiorFed('<p>Nada que ver.</p>'), null);
});

test('INEGI: periodos mensuales, trimestrales y quincenales', () => {
  assert.equal(periodoInegi('2026/08', '8'), '2026-08');
  assert.equal(periodoInegi('2026/02', '4'), '2026-T2');
  assert.equal(periodoInegi('2026/09/01', '15'), '2026-09-Q1');
  assert.equal(periodoInegi('2026/08/02', '15'), '2026-08-Q2');
  const datos = leerInegi({
    Series: [
      {
        INDICADOR: '910392',
        FREQ: '8',
        OBSERVATIONS: [
          { TIME_PERIOD: '2026/08', OBS_VALUE: '145.46199999999999000000' },
          { TIME_PERIOD: '2025/08', OBS_VALUE: '140.86000000000000000000' },
        ],
      },
    ],
  });
  const valor = calcular(datos.get('910392'), { tipo: 'anual' }, { tipo: 'mes', anio: 2026, mes: 8 });
  assert.equal(redondear(valor!, 2), 3.27);
  assert.throws(() => leerInegi({ ErrorInfo: 'No se encontraron resultados' }), /INEGI/);
});

test('Banxico: series del SIE con comas y N/E', () => {
  assert.equal(periodoSie('01/08/2026', 'mes'), '2026-08');
  assert.equal(periodoSie('24/09/2026', 'dia'), '2026-09-24');
  const datos = leerSie(
    { bmx: { series: [{ idSerie: 'SE27803', datos: [{ fecha: '01/08/2026', dato: '5,452.34' }, { fecha: '01/09/2026', dato: 'N/E' }] }] } },
    { SE27803: 'mes' },
  );
  assert.equal(datos.get('SE27803')?.get('2026-08'), 5452.34);
  assert.equal(datos.get('SE27803')?.has('2026-09'), false);
});

test('Banxico: anuncios de política monetaria desde la página oficial', () => {
  const html = new TextDecoder('windows-1252').decode(readFileSync(new URL('./fixtures/banxico-anuncios.html', import.meta.url)));
  const anuncios = leerAnuncios(html);
  assert.equal(anuncios[0]?.fecha, '2026-09-24');
  assert.match(anuncios[0]?.titulo ?? '', /se mantiene sin cambio en 6\.50 por ciento/);
  assert.match(anuncios[0]?.url ?? '', /^https:\/\/www\.banxico\.org\.mx\/.*\.pdf$/);
  const recorte = anuncios.find((a) => a.fecha === '2026-05-07');
  assert.match(recorte?.titulo ?? '', /disminuye en 25 puntos base/);
  assert.equal(tasaDesdeTitulo(anuncios[0]!.titulo, null), 6.5);
  assert.equal(tasaDesdeTitulo(recorte!.titulo, null), null);
  assert.equal(tasaDesdeTitulo(recorte!.titulo, 6.75), 6.5);
  assert.equal(tasaDesdeTitulo('La tasa objetivo aumenta en 50 puntos base', 6.5), 7);
});
