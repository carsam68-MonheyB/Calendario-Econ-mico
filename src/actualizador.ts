// Una corrida de la función programada: decide qué toca, consulta y guarda solo si algo cambió.

import type { FilaCalendario } from './calendario.ts';
import { redondear } from './calculos.ts';
import { aplicarConsensos } from './consenso.ts';
import { aplicarCorrecciones, FUENTE_MANUAL, type Correccion } from './correcciones.ts';
import type { Almacen } from './almacen.ts';
import { actualizarEstados, huella, sincronizar } from './datos.ts';
import { indicadorDe } from './indicadores.ts';
import type { EstadoServicio, EventoGuardado, ValorConFuente } from './modelo.ts';
import { tocaConsultar, tocaRevisarAnteriores } from './programacion.ts';
import { sanitizar } from './red.ts';
import { fechaCdmx, sumarDias } from './tiempo.ts';

/** Días hacia adelante y hacia atrás en que se completa el dato anterior de los eventos que no lo tienen. */
export const DIAS_DE_ANTERIOR = 10;

export interface PeticionConsulta {
  /** Eventos sin dato real a los que les toca consulta en esta corrida. */
  aConsultar: EventoGuardado[];
  /** Eventos ya publicados de los mismos indicadores, para detectar revisiones sin llamadas extra. */
  paraRevision: EventoGuardado[];
  /** Eventos cercanos (pendientes o ya publicados) a los que les falta el dato anterior. */
  paraAnterior: EventoGuardado[];
}

export interface ValorObtenido {
  id: string;
  valor: number;
  fuente: string;
  url: string | null;
}

export interface ResultadoConsulta {
  valores: ValorObtenido[];
  /** Último dato publicado antes de cada evento (aConsultar y paraAnterior). */
  anteriores: ValorObtenido[];
  /** Resultado por fuente consultada ("BLS", "INEGI", …). El error ya viene sin llaves. */
  intentos: Record<string, { ok: boolean; error?: string }>;
}

export type Consultor = (peticion: PeticionConsulta, ahora: Date) => Promise<ResultadoConsulta>;

export interface OpcionesCorrida {
  ahora: Date;
  calendario: FilaCalendario[];
  correcciones: Correccion[];
  almacen: Almacen;
  consultar: Consultor;
  esConsultable: (fila: FilaCalendario | EventoGuardado) => boolean;
}

export interface ResumenCorrida {
  motivo: 'sin ventana activa' | 'ya publicados' | 'consulta' | 'anteriores';
  consultados: string[];
  nuevos: string[];
  revisados: string[];
  anteriores: string[];
  escribioDatos: boolean;
  escribioEstado: boolean;
}

function mismoValor(a: number, b: number, decimales: number): boolean {
  return redondear(a, decimales) === redondear(b, decimales);
}

/**
 * El dato anterior de una estimación posterior del mismo periodo es la estimación previa ya publicada
 * (PIB avance → segunda estimación → final). Se toma del propio calendario, sin consultar nada.
 */
export function anteriorDesdeCalendario(evento: EventoGuardado, eventos: EventoGuardado[]): ValorConFuente | null {
  const clave = indicadorDe(evento).clave;
  const previos = eventos
    .filter(
      (e) =>
        e.id !== evento.id &&
        e.pais === evento.pais &&
        e.periodo === evento.periodo &&
        e.fecha < evento.fecha &&
        e.real !== null &&
        indicadorDe(e).clave === clave,
    )
    .sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  return previos[0]?.real ?? null;
}

export async function ejecutarCorrida(op: OpcionesCorrida): Promise<ResumenCorrida> {
  const { ahora } = op;
  const resumen: ResumenCorrida = {
    motivo: 'sin ventana activa',
    consultados: [],
    nuevos: [],
    revisados: [],
    anteriores: [],
    escribioDatos: false,
    escribioEstado: false,
  };

  // Sin ventana activa se termina aquí, sin leer Blobs ni llamar a nadie.
  // Las filas que ya traen el real desde el CSV tampoco se consultan.
  const tocan = op.calendario.filter(
    (f) => f.tipo !== 'evento' && f.real === null && op.esConsultable(f) && tocaConsultar(f, ahora),
  );
  const revisarAnteriores = tocaRevisarAnteriores(ahora);
  if (tocan.length === 0 && !revisarAnteriores) return resumen;

  const [guardados, consenso] = await Promise.all([op.almacen.leerDatos(), op.almacen.leerConsenso()]);
  const antes = huella(guardados);
  const datos = sincronizar(op.calendario, guardados, ahora);
  aplicarCorrecciones(datos.eventos, op.correcciones, ahora);
  aplicarConsensos(datos.eventos, consenso);

  const porId = new Map(datos.eventos.map((e) => [e.id, e]));
  const aConsultar = tocan.map((f) => porId.get(f.id)).filter((e): e is EventoGuardado => e !== undefined && e.real === null);

  // Dato anterior: eventos de los días cercanos que todavía no lo tienen (los pendientes y los que
  // ya se publicaron sin que la fuente pudiera darlo, por ejemplo los que traen el real en el CSV).
  const hoy = fechaCdmx(ahora);
  const desde = sumarDias(hoy, -DIAS_DE_ANTERIOR);
  const hasta = sumarDias(hoy, DIAS_DE_ANTERIOR);
  const paraAnterior = revisarAnteriores
    ? datos.eventos.filter(
        (e) =>
          e.tipo !== 'evento' &&
          e.anterior === null &&
          e.fecha >= desde &&
          e.fecha <= hasta &&
          op.esConsultable(e) &&
          !aConsultar.some((a) => a.id === e.id),
      )
    : [];

  const marcaAnterior = (e: EventoGuardado, valor: ValorConFuente) => {
    e.anterior = valor;
    e.actualizado = ahora.toISOString();
    resumen.anteriores.push(e.id);
  };
  // Lo que se resuelve sin llamadas: la estimación previa del mismo periodo.
  for (const e of [...aConsultar, ...paraAnterior]) {
    if (e.anterior !== null) continue;
    const previo = anteriorDesdeCalendario(e, datos.eventos);
    if (previo) marcaAnterior(e, { ...previo });
  }
  const paraAnteriorRestantes = paraAnterior.filter((e) => e.anterior === null);

  if (aConsultar.length > 0 || paraAnteriorRestantes.length > 0) {
    resumen.motivo = aConsultar.length > 0 ? 'consulta' : 'anteriores';
    resumen.consultados = aConsultar.map((e) => e.id);
    const claves = new Set(aConsultar.map((e) => indicadorDe(e).clave));
    const paraRevision = datos.eventos.filter(
      (e) => e.real !== null && e.real.fuente !== FUENTE_MANUAL && claves.has(indicadorDe(e).clave),
    );
    const pedidos = new Set(resumen.consultados);
    const pedidosAnterior = new Set([...aConsultar, ...paraAnteriorRestantes].map((e) => e.id));
    const resultado = await op.consultar({ aConsultar, paraRevision, paraAnterior: paraAnteriorRestantes }, ahora);

    // Primero los anteriores: se actualizan mientras el evento sigue pendiente (la fuente puede revisar el
    // periodo previo) y quedan fijos al publicarse. Uno que faltaba se completa aunque el real ya esté.
    for (const a of resultado.anteriores) {
      const e = porId.get(a.id);
      if (!e || !pedidosAnterior.has(e.id) || !Number.isFinite(a.valor)) continue;
      if (e.anterior && (e.real !== null || e.anterior.fuente === FUENTE_MANUAL)) continue;
      if (anteriorDesdeCalendario(e, datos.eventos)) continue;
      const decimales = indicadorDe(e).decimales;
      if (e.anterior && mismoValor(e.anterior.valor, a.valor, decimales)) continue;
      marcaAnterior(e, { valor: redondear(a.valor, decimales), fuente: a.fuente, url: a.url, obtenido: ahora.toISOString() });
    }

    for (const v of resultado.valores) {
      const e = porId.get(v.id);
      if (!e || !Number.isFinite(v.valor)) continue;
      const decimales = indicadorDe(e).decimales;
      const nuevo = { valor: redondear(v.valor, decimales), fuente: v.fuente, url: v.url, obtenido: ahora.toISOString() };
      if (e.real === null) {
        if (!pedidos.has(e.id)) continue;
        e.real = nuevo;
        e.actualizado = nuevo.obtenido;
        resumen.nuevos.push(e.id);
      } else if (e.real.fuente !== FUENTE_MANUAL && !mismoValor(e.real.valor, v.valor, decimales)) {
        // Primera cifra intacta; la revisión se guarda aparte.
        if (!e.revision || !mismoValor(e.revision.valor, v.valor, decimales)) {
          e.revision = nuevo;
          e.actualizado = nuevo.obtenido;
          resumen.revisados.push(e.id);
        }
      }
    }

    const estado: EstadoServicio = (await op.almacen.leerEstado()) ?? { version: 1, ultimaCorrida: null, fuentes: {} };
    estado.ultimaCorrida = ahora.toISOString();
    for (const [nombre, intento] of Object.entries(resultado.intentos)) {
      const previo = estado.fuentes[nombre] ?? { ultimoIntento: null, ultimoExito: null, ultimoError: null };
      previo.ultimoIntento = ahora.toISOString();
      if (intento.ok) previo.ultimoExito = ahora.toISOString();
      else previo.ultimoError = { fecha: ahora.toISOString(), mensaje: sanitizar(intento.error ?? 'Error desconocido') };
      estado.fuentes[nombre] = previo;
    }
    await op.almacen.guardarEstado(estado);
    resumen.escribioEstado = true;
  } else if (tocan.length > 0) {
    resumen.motivo = 'ya publicados';
  } else if (resumen.anteriores.length > 0) {
    resumen.motivo = 'anteriores';
  }

  actualizarEstados(datos, op.esConsultable, ahora);
  if (huella(datos) !== antes) {
    datos.actualizado = ahora.toISOString();
    await op.almacen.guardarDatos(datos);
    resumen.escribioDatos = true;
  }
  return resumen;
}
