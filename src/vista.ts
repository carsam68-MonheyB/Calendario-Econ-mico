// Respuestas de /api/datos y /api/estado.

import type { FilaCalendario, Mejor, Pais, Tipo } from './calendario.ts';
import { calcularVariacion, type Variacion } from './calculos.ts';
import { VARIABLES_DE_LLAVES, type Configuracion, type Llaves } from './config.ts';
import { aplicarConsensos, type DatosConsenso } from './consenso.ts';
import { aplicarCorrecciones, type Correccion } from './correcciones.ts';
import { sincronizar } from './datos.ts';
import { indicadorDe } from './indicadores.ts';
import type { Datos, EstadoServicio, EventoGuardado, ValorConFuente } from './modelo.ts';
import { estadoVisible, publicadoDesde, ventanas, type EstadoVisible } from './programacion.ts';

export interface FuenteVista {
  nombre: string;
  url: string | null;
  obtenido: string;
}

export interface EventoVista {
  id: string;
  fecha: string;
  hora: string | null;
  pais: Pais;
  indicador: string;
  periodo: string;
  unidad: string;
  tipo: Tipo;
  mejor: Mejor;
  decimales: number;
  altoImpacto: boolean;
  esperado: number | null;
  esperadoFuente: FuenteVista | null;
  real: number | null;
  realFuente: FuenteVista | null;
  revision: number | null;
  revisionFuente: FuenteVista | null;
  variacion: Variacion | null;
  estado: EstadoVisible;
  /** Tiene fuente automática con la configuración actual. */
  consultable: boolean;
  /** Hora de publicación en UTC (6:00 del centro si no tiene hora). */
  inicio: string;
  /** Desde aquí, sin dato, el evento está "Retrasado". */
  finEspera: string;
  /** Desde aquí, un evento sin valores se muestra como publicado. */
  publicadoDesde: string;
}

export interface Vista {
  generado: string;
  actualizado: string | null;
  modoReal: Configuracion['modoReal'];
  modoConsenso: Configuracion['modoConsenso'];
  eventos: EventoVista[];
}

function fuente(v: ValorConFuente | null): FuenteVista | null {
  return v ? { nombre: v.fuente, url: v.url, obtenido: v.obtenido } : null;
}

function ordenar(a: FilaCalendario | EventoGuardado, b: FilaCalendario | EventoGuardado): number {
  if (a.fecha !== b.fecha) return a.fecha < b.fecha ? -1 : 1;
  // Dentro del día, por hora; las filas sin hora van al final.
  const ha = a.hora ?? '99:99';
  const hb = b.hora ?? '99:99';
  return ha < hb ? -1 : ha > hb ? 1 : 0;
}

export function construirVista(entrada: {
  calendario: FilaCalendario[];
  datos: Datos | null;
  consenso: DatosConsenso | null;
  correcciones: Correccion[];
  config: Configuracion;
  esConsultable: (fila: FilaCalendario | EventoGuardado) => boolean;
  ahora: Date;
}): Vista {
  const { calendario, correcciones, config, esConsultable, ahora } = entrada;
  const datos = sincronizar(calendario, entrada.datos, ahora);
  // Las correcciones se ven desde el siguiente deploy, aunque la función programada aún no corra.
  aplicarCorrecciones(datos.eventos, correcciones, ahora);
  aplicarConsensos(datos.eventos, entrada.consenso);

  const eventos = [...datos.eventos].sort(ordenar).map((e): EventoVista => {
    const meta = indicadorDe(e);
    const consultable = e.tipo !== 'evento' && esConsultable(e);
    const v = ventanas(e);
    const esperado = e.esperado?.valor ?? null;
    const real = e.real?.valor ?? null;
    return {
      id: e.id,
      fecha: e.fecha,
      hora: e.hora,
      pais: e.pais,
      indicador: e.indicador,
      periodo: e.periodo,
      unidad: e.unidad,
      tipo: e.tipo,
      mejor: e.mejor,
      decimales: meta.decimales,
      altoImpacto: meta.altoImpacto,
      esperado,
      esperadoFuente: fuente(e.esperado),
      real,
      realFuente: fuente(e.real),
      revision: e.revision?.valor ?? null,
      revisionFuente: fuente(e.revision),
      variacion: calcularVariacion(e.tipo, e.mejor, meta.decimales, real, esperado),
      estado: estadoVisible(e, real !== null, consultable, ahora),
      consultable,
      inicio: v.inicio.toISOString(),
      finEspera: v.finEspera.toISOString(),
      publicadoDesde: publicadoDesde(e).toISOString(),
    };
  });

  return {
    generado: ahora.toISOString(),
    actualizado: entrada.datos?.actualizado ?? null,
    modoReal: config.modoReal,
    modoConsenso: config.modoConsenso,
    eventos,
  };
}

export function construirEstado(entrada: {
  estado: EstadoServicio | null;
  consenso: DatosConsenso | null;
  config: Configuracion;
  errorCorrecciones: string | null;
  ahora: Date;
}) {
  const { estado, config, errorCorrecciones, ahora } = entrada;
  // Solo se informa si cada llave está configurada, nunca su valor.
  const llavesConfiguradas = Object.fromEntries(
    (Object.keys(VARIABLES_DE_LLAVES) as (keyof Llaves)[]).map((k) => [VARIABLES_DE_LLAVES[k], Boolean(config.llaves[k])]),
  );
  return {
    generado: ahora.toISOString(),
    modoReal: config.modoReal,
    modoConsenso: config.modoConsenso,
    ultimaCorrida: estado?.ultimaCorrida ?? null,
    llavesConfiguradas,
    correcciones: errorCorrecciones ?? 'sin errores',
    fuentes: estado?.fuentes ?? {},
    consenso: {
      fuentes: entrada.consenso?.fuentes ?? {},
      conValor: Object.values(entrada.consenso?.eventos ?? {}).filter((c) => c.valor !== null).length,
      sinConsensoClaro: Object.values(entrada.consenso?.eventos ?? {}).filter((c) => c.valor === null && c.error === null).length,
      conError: Object.entries(entrada.consenso?.eventos ?? {})
        .filter(([, c]) => c.error !== null)
        .map(([id, c]) => ({ id, intentos: c.intentos, error: c.error })),
    },
  };
}
