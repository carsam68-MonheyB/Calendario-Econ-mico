// Modo oficial: consulta en paralelo a los organismos que tocan y calcula el dato de cada evento.

import type { Consultor, ResultadoConsulta, ValorObtenido } from './actualizador.ts';
import type { Configuracion, Llaves } from './config.ts';
import { VARIABLES_DE_LLAVES } from './config.ts';
import { calcular, claveSerie, MAPEO_OFICIAL, type Mapeo, type Receta, type Serie } from './fuentes.ts';
import { indicadorDe } from './indicadores.ts';
import type { EventoGuardado } from './modelo.ts';
import { consultarAnuncios, consultarSie, SERIE_TASA_OBJETIVO, tasaDesdeTitulo } from './organismos/banxico.ts';
import { consultarIta, consultarNipa } from './organismos/bea.ts';
import { consultarBls } from './organismos/bls.ts';
import { claveCensus, consultarEits } from './organismos/census.ts';
import { consultarFed, urlComunicadoFed } from './organismos/fed.ts';
import { consultarFred } from './organismos/fred.ts';
import { consultarInegi } from './organismos/inegi.ts';
import type { Observaciones } from './organismos/tipos.ts';
import { periodoDeEvento, type Periodo } from './periodos.ts';
import { ErrorFuente, sanitizar } from './red.ts';
import { sumarDias } from './tiempo.ts';

interface Pedido {
  evento: EventoGuardado;
  periodo: Periodo;
  mapeo: Mapeo;
  /** true si el evento espera su primer dato; false si solo se revisa por revisiones. */
  solicitado: boolean;
}

interface Lote {
  datos: Map<string, Observaciones>;
  /** Tabla de BEA → fecha de su última revisión. */
  revisiones: Map<string, string>;
  /** Fecha → URL del comunicado (Fed, Banxico). */
  comunicados: Map<string, string>;
  intentos: ResultadoConsulta['intentos'];
  fallidos: Set<string>;
}

const nuevoLote = (): Lote => ({ datos: new Map(), revisiones: new Map(), comunicados: new Map(), intentos: {}, fallidos: new Set() });

function exigir(llaves: Llaves, cual: keyof Llaves): string {
  const llave = llaves[cual];
  if (!llave) throw new ErrorFuente(`Falta la variable ${VARIABLES_DE_LLAVES[cual]}`);
  return llave;
}

function aniosDe(pedidos: Pedido[]): number[] {
  const anios = pedidos.map((p) => Number(p.evento.fecha.slice(0, 4)));
  const desde = Math.min(...anios) - 1;
  const hasta = Math.max(...anios);
  return Array.from({ length: hasta - desde + 1 }, (_, i) => desde + i);
}

async function anunciosBanxico(fechas: string[], token: string | undefined, lote: Lote): Promise<void> {
  const anuncios = await consultarAnuncios();
  const obs: Observaciones = new Map();
  for (const fecha of fechas) {
    const anuncio = anuncios.find((a) => a.fecha === fecha);
    if (!anuncio) continue; // Aún no se publica.
    let vigente: number | null = null;
    if (tasaDesdeTitulo(anuncio.titulo, null) === null) {
      // El título solo dice el movimiento: se aplica a la tasa vigente ese día (cambia al día siguiente).
      if (!token) throw new ErrorFuente(`Falta la variable ${VARIABLES_DE_LLAVES.banxico}`);
      const sie = await consultarSie({ [SERIE_TASA_OBJETIVO]: 'dia' }, sumarDias(fecha, -10), fecha, token);
      const serie = [...(sie.get(SERIE_TASA_OBJETIVO) ?? new Map<string, number>())].filter(([f]) => f <= fecha).sort();
      vigente = serie.at(-1)?.[1] ?? null;
    }
    const tasa = tasaDesdeTitulo(anuncio.titulo, vigente);
    if (tasa === null) throw new ErrorFuente('Banxico: no se pudo leer la tasa del anuncio');
    obs.set(fecha, tasa);
    if (anuncio.url) lote.comunicados.set(fecha, anuncio.url);
  }
  lote.datos.set('BANXICO:ANUNCIO', obs);
}

/** Lanza en paralelo una llamada por organismo (o por tabla) y junta los resultados. */
async function consultarSeries(pares: { serie: Serie; pedido: Pedido }[], llaves: Llaves, lote: Lote): Promise<void> {
  const porOrganismo = new Map<string, { serie: Serie; pedido: Pedido }[]>();
  for (const par of pares) {
    const lista = porOrganismo.get(par.serie.organismo) ?? [];
    lista.push(par);
    porOrganismo.set(par.serie.organismo, lista);
  }

  const tareas = [...porOrganismo].map(async ([organismo, lista]) => {
    const pedidos = lista.map((p) => p.pedido);
    const anios = aniosDe(pedidos);
    const series = lista.map((p) => p.serie);
    const unicos = <T>(xs: T[]) => [...new Set(xs)];
    try {
      switch (organismo) {
        case 'BLS': {
          const ids = unicos(series.map((s) => claveSerie(s).replace(/#12m$/, '')));
          const datos = await consultarBls(ids, anios[0]!, anios.at(-1)!, exigir(llaves, 'bls'));
          for (const [k, v] of datos) lote.datos.set(k, v);
          break;
        }
        case 'BEA': {
          const llave = exigir(llaves, 'bea');
          const tablas = unicos(series.flatMap((s) => (s.organismo === 'BEA' && !('ita' in s) ? [`${s.tabla}|${s.frecuencia}`] : [])));
          const ita = unicos(series.flatMap((s) => (s.organismo === 'BEA' && 'ita' in s ? [s.ita] : [])));
          await Promise.all([
            ...tablas.map(async (t) => {
              const [tabla, frecuencia] = t.split('|') as [string, 'Q' | 'M'];
              const r = await consultarNipa(tabla, frecuencia, anios, llave);
              for (const [k, v] of r.series) lote.datos.set(k, v);
              if (r.revisado) lote.revisiones.set(tabla, r.revisado);
            }),
            ...(ita.length ? [consultarIta(ita, anios, llave).then((r) => r.forEach((v, k) => lote.datos.set(k, v)))] : []),
          ]);
          break;
        }
        case 'Census': {
          const llave = exigir(llaves, 'census');
          const desde = `${anios[0]}-01`;
          const censales = new Map(series.flatMap((s) => (s.organismo === 'Census' ? [[claveCensus(s), s] as const] : [])));
          await Promise.all([...censales].map(async ([clave, s]) => lote.datos.set(clave, await consultarEits(s, desde, llave))));
          break;
        }
        case 'Fed': {
          const fechas = unicos(pedidos.map((p) => p.evento.fecha));
          lote.datos.set('FED', await consultarFed(fechas));
          for (const f of fechas) lote.comunicados.set(f, urlComunicadoFed(f));
          break;
        }
        case 'FRED': {
          const llave = exigir(llaves, 'fred');
          const desde = `${anios[0]}-01-01`;
          const fredes = new Map(series.flatMap((s) => (s.organismo === 'FRED' ? [[s.id, s] as const] : [])));
          await Promise.all([...fredes].map(async ([id, s]) => lote.datos.set(id, await consultarFred(id, s.frecuencia, desde, llave))));
          break;
        }
        case 'INEGI': {
          const ids = unicos(series.map(claveSerie));
          const datos = await consultarInegi(ids, exigir(llaves, 'inegi'));
          for (const [k, v] of datos) lote.datos.set(k, v);
          break;
        }
        case 'Banxico': {
          const fechasAnuncio = unicos(lista.filter((p) => 'anuncio' in p.serie).map((p) => p.pedido.evento.fecha));
          const sie = Object.fromEntries(
            series.flatMap((s) => (s.organismo === 'Banxico' && !('anuncio' in s) ? [[s.id, s.frecuencia] as const] : [])),
          );
          const hoy = new Date().toISOString().slice(0, 10);
          await Promise.all([
            ...(fechasAnuncio.length ? [anunciosBanxico(fechasAnuncio, llaves.banxico, lote)] : []),
            ...(Object.keys(sie).length
              ? [consultarSie(sie, `${anios[0]}-01-01`, hoy, exigir(llaves, 'banxico')).then((r) => r.forEach((v, k) => lote.datos.set(k, v)))]
              : []),
          ]);
          break;
        }
      }
      lote.intentos[organismo] = { ok: true };
    } catch (e) {
      lote.fallidos.add(organismo);
      lote.intentos[organismo] = { ok: false, error: e instanceof ErrorFuente ? e.message : sanitizar(`${organismo}: ${(e as Error).message}`) };
    }
  });
  await Promise.all(tareas);
}

function valorDe(recetas: Receta[], pedido: Pedido, lote: Lote): number | null {
  for (const receta of recetas) {
    const valor = calcular(lote.datos.get(claveSerie(receta.serie)), receta.calculo, pedido.periodo);
    if (valor !== null && Number.isFinite(valor)) return valor;
  }
  return null;
}

/**
 * La segunda y la tercera estimación del PIB de EUA son el mismo trimestre que el avance:
 * solo se aceptan si BEA marca la tabla como revisada el día del evento o después.
 */
function vintageValida(pedido: Pedido, lote: Lote): boolean {
  if (!pedido.solicitado || indicadorDe(pedido.evento).clave !== 'us.pib') return true;
  const revisado = lote.revisiones.get('T10101');
  if (revisado) return revisado >= pedido.evento.fecha;
  return (indicadorDe(pedido.evento).estimacion ?? 1) === 1;
}

export function crearConsultorOficial(config: Configuracion): Consultor {
  return async ({ aConsultar, paraRevision }) => {
    const solicitados = new Set(aConsultar.map((e) => e.id));
    const pedidos: Pedido[] = [];
    for (const evento of [...aConsultar, ...paraRevision]) {
      const mapeo = MAPEO_OFICIAL[indicadorDe(evento).clave];
      const periodo = periodoDeEvento(evento);
      if (mapeo && periodo) pedidos.push({ evento, periodo, mapeo, solicitado: solicitados.has(evento.id) });
    }

    const lote = nuevoLote();
    await consultarSeries(
      pedidos.flatMap((pedido) => pedido.mapeo.primaria.map((r) => ({ serie: r.serie, pedido }))),
      config.llaves,
      lote,
    );

    const valores: ValorObtenido[] = [];
    const conRespaldo: Pedido[] = [];
    for (const pedido of pedidos) {
      const organismo = pedido.mapeo.primaria[0]!.serie.organismo;
      if (lote.fallidos.has(organismo)) {
        const estimacion = indicadorDe(pedido.evento).estimacion ?? 1;
        if (pedido.solicitado && pedido.mapeo.respaldo && estimacion === 1) conRespaldo.push(pedido);
        continue;
      }
      const valor = valorDe(pedido.mapeo.primaria, pedido, lote);
      if (valor === null || !vintageValida(pedido, lote)) continue;
      const url = lote.comunicados.get(pedido.evento.fecha) ?? pedido.mapeo.url;
      valores.push({ id: pedido.evento.id, valor, fuente: organismo, url });
    }

    // Respaldo con FRED solo para los eventos cuya fuente primaria no respondió.
    if (conRespaldo.length > 0) {
      const respaldo = nuevoLote();
      await consultarSeries(
        conRespaldo.flatMap((pedido) => pedido.mapeo.respaldo!.map((r) => ({ serie: r.serie, pedido }))),
        config.llaves,
        respaldo,
      );
      Object.assign(lote.intentos, respaldo.intentos);
      for (const pedido of conRespaldo) {
        const valor = valorDe(pedido.mapeo.respaldo!, pedido, respaldo);
        if (valor === null) continue;
        const id = claveSerie(pedido.mapeo.respaldo![0]!.serie);
        valores.push({ id: pedido.evento.id, valor, fuente: 'FRED (respaldo)', url: `https://fred.stlouisfed.org/series/${id}` });
      }
    }

    return { valores, intentos: lote.intentos };
  };
}
