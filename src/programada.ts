// Punto de entrada común de las dos funciones programadas.

import { ejecutarCorrida, type Consultor, type ResumenCorrida } from './actualizador.ts';
import { almacenBlobs, type Almacen } from './almacen.ts';
import { cargarCalendario, cargarCorrecciones, horaActual } from './archivos.ts';
import type { FilaCalendario } from './calendario.ts';
import { leerConfiguracion, type Configuracion } from './config.ts';
import {
  consensoVacio,
  eventosSinConsenso,
  firmar,
  registrarFuente,
  registrarIntento,
  tocaRevisarConsenso,
} from './consenso.ts';
import { tieneFuente } from './fuentes.ts';
import { buscarEventoTe, consultarCalendarioTe, urlTe, valorTe } from './organismos/te.ts';
import { ventanas } from './programacion.ts';
import { ErrorFuente, obtener, sanitizar } from './red.ts';
import { MINUTO } from './tiempo.ts';

/** Minuto exacto de la corrida: así una ejecución que arranca con segundos de retraso cae en su turno. */
export function minutoDeCorrida(instante: Date): Date {
  return new Date(Math.floor(instante.getTime() / MINUTO) * MINUTO);
}

/** El cron de cada minuto cubre los días hábiles de 11:00 a 20:59 UTC; el de 15 minutos, el resto. */
export function cubiertoPorCronDeMinuto(instante: Date): boolean {
  const dia = instante.getUTCDay();
  const hora = instante.getUTCHours();
  return dia >= 1 && dia <= 5 && hora >= 11 && hora <= 20;
}

export const RUTA_CONSENSO = '/.netlify/functions/consenso-background';

/** Modo claude: dispara la Background Function con una firma que solo conocen las funciones del sitio. */
async function dispararConsensoClaude(ids: string[], llave: string, ahora: Date): Promise<void> {
  const base = process.env.URL;
  if (!base) throw new ErrorFuente('Falta la variable URL del sitio');
  const cuerpo = JSON.stringify({ ids });
  const marca = String(ahora.getTime());
  const respuesta = await obtener(new URL(RUTA_CONSENSO, base), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-calendario-marca': marca, 'x-calendario-firma': firmar(cuerpo, marca, llave) },
    body: cuerpo,
  });
  await respuesta.body?.cancel().catch(() => {});
}

/** Modo tradingeconomics: el consenso ("Forecast") se lee directo del calendario de TE. */
async function consensoTradingEconomics(filas: FilaCalendario[], llave: string, almacen: Almacen, ahora: Date): Promise<void> {
  const consenso = (await almacen.leerConsenso()) ?? consensoVacio();
  try {
    const fechas = filas.map((f) => f.fecha).sort();
    const eventos = await consultarCalendarioTe(fechas[0]!, fechas.at(-1)!, llave);
    for (const fila of filas) {
      const te = buscarEventoTe(fila, eventos);
      const valor = te ? valorTe(te.Forecast, te.Unit, fila.unidad) : null;
      if (te && valor !== null) registrarIntento(consenso, fila.id, ahora, { valor, fuente: 'Trading Economics (consenso)', url: urlTe(te) });
      else registrarIntento(consenso, fila.id, ahora, { error: te ? 'Sin consenso publicado todavía' : 'Evento no encontrado en Trading Economics' });
    }
    registrarFuente(consenso, 'Trading Economics', ahora, null);
  } catch (e) {
    registrarFuente(consenso, 'Trading Economics', ahora, e instanceof ErrorFuente ? e.message : sanitizar((e as Error).message));
  }
  await almacen.guardarConsenso(consenso);
}

/** A las 20:00 de la víspera (y en los reintentos) pide el esperado de los eventos que no lo tienen. */
export async function revisarConsenso(config: Configuracion, calendario: FilaCalendario[], almacen: Almacen, ahora: Date): Promise<number> {
  if (config.modoConsenso === 'ninguna' || !tocaRevisarConsenso(ahora)) return 0;
  const consenso = await almacen.leerConsenso();
  const pendientes = eventosSinConsenso(calendario, consenso, ahora, (f) => ventanas(f).inicio);
  if (pendientes.length === 0) return 0;

  if (config.modoConsenso === 'tradingeconomics') {
    if (!config.llaves.tradingeconomics) return 0;
    await consensoTradingEconomics(pendientes, config.llaves.tradingeconomics, almacen, ahora);
    return pendientes.length;
  }
  if (!config.llaves.anthropic) return 0;
  try {
    await dispararConsensoClaude(pendientes.map((f) => f.id), config.llaves.anthropic, ahora);
  } catch (e) {
    console.error('[consenso] no se pudo disparar:', e instanceof ErrorFuente ? e.message : sanitizar((e as Error).message));
    return 0;
  }
  return pendientes.length;
}

export async function correrProgramada(nombre: string, crearConsultor: (config: Configuracion) => Consultor): Promise<ResumenCorrida> {
  const inicio = Date.now();
  const config = leerConfiguracion();
  const ahora = minutoDeCorrida(horaActual());
  const calendario = cargarCalendario();
  const almacen = almacenBlobs();
  const resumen = await ejecutarCorrida({
    ahora,
    calendario,
    correcciones: cargarCorrecciones().correcciones,
    almacen,
    consultar: crearConsultor(config),
    esConsultable: (fila) => tieneFuente(fila, config.modoReal),
  });
  const consensos = await revisarConsenso(config, calendario, almacen, ahora);
  // Una línea por corrida en los logs de Netlify. Nunca incluye llaves.
  if (resumen.motivo !== 'sin ventana activa' || consensos > 0) {
    console.log(
      `[${nombre}] ${resumen.motivo}: consultados=${resumen.consultados.length} nuevos=${resumen.nuevos.join(',') || '-'} ` +
        `revisados=${resumen.revisados.join(',') || '-'} anteriores=${resumen.anteriores.length} escribio=${resumen.escribioDatos} consensos=${consensos} ${Date.now() - inicio} ms`,
    );
  }
  return resumen;
}
