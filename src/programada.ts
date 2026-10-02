// Punto de entrada común de las dos funciones programadas.

import { ejecutarCorrida, type Consultor, type ResumenCorrida } from './actualizador.ts';
import { almacenBlobs } from './almacen.ts';
import { cargarCalendario, cargarCorrecciones, horaActual } from './archivos.ts';
import { leerConfiguracion } from './config.ts';
import { tieneFuente } from './fuentes.ts';
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

export async function correrProgramada(nombre: string, crearConsultor: (config: ReturnType<typeof leerConfiguracion>) => Consultor): Promise<ResumenCorrida> {
  const inicio = Date.now();
  const config = leerConfiguracion();
  const resumen = await ejecutarCorrida({
    ahora: minutoDeCorrida(horaActual()),
    calendario: cargarCalendario(),
    correcciones: cargarCorrecciones().correcciones,
    almacen: almacenBlobs(),
    consultar: crearConsultor(config),
    esConsultable: (fila) => tieneFuente(fila, config.modoReal),
  });
  // Una línea por corrida en los logs de Netlify. Nunca incluye llaves.
  if (resumen.motivo !== 'sin ventana activa') {
    console.log(
      `[${nombre}] ${resumen.motivo}: consultados=${resumen.consultados.length} nuevos=${resumen.nuevos.join(',') || '-'} ` +
        `revisados=${resumen.revisados.join(',') || '-'} escribio=${resumen.escribioDatos} ${Date.now() - inicio} ms`,
    );
  }
  return resumen;
}
