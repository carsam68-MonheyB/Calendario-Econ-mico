// Una corrida de la función programada: decide qué toca, consulta y guarda solo si algo cambió.

import type { FilaCalendario } from './calendario.ts';
import { redondear } from './calculos.ts';
import { aplicarConsensos } from './consenso.ts';
import { aplicarCorrecciones, FUENTE_MANUAL, type Correccion } from './correcciones.ts';
import type { Almacen } from './almacen.ts';
import { actualizarEstados, huella, sincronizar } from './datos.ts';
import { indicadorDe } from './indicadores.ts';
import type { EstadoServicio, EventoGuardado } from './modelo.ts';
import { tocaConsultar } from './programacion.ts';
import { sanitizar } from './red.ts';

export interface PeticionConsulta {
  /** Eventos sin dato real a los que les toca consulta en esta corrida. */
  aConsultar: EventoGuardado[];
  /** Eventos ya publicados de los mismos indicadores, para detectar revisiones sin llamadas extra. */
  paraRevision: EventoGuardado[];
}

export interface ValorObtenido {
  id: string;
  valor: number;
  fuente: string;
  url: string | null;
}

export interface ResultadoConsulta {
  valores: ValorObtenido[];
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
  motivo: 'sin ventana activa' | 'ya publicados' | 'consulta';
  consultados: string[];
  nuevos: string[];
  revisados: string[];
  escribioDatos: boolean;
  escribioEstado: boolean;
}

function mismoValor(a: number, b: number, decimales: number): boolean {
  return redondear(a, decimales) === redondear(b, decimales);
}

export async function ejecutarCorrida(op: OpcionesCorrida): Promise<ResumenCorrida> {
  const { ahora } = op;
  const resumen: ResumenCorrida = {
    motivo: 'sin ventana activa',
    consultados: [],
    nuevos: [],
    revisados: [],
    escribioDatos: false,
    escribioEstado: false,
  };

  // Sin ventana activa se termina aquí, sin leer Blobs ni llamar a nadie.
  // Las filas que ya traen el real desde el CSV tampoco se consultan.
  const tocan = op.calendario.filter(
    (f) => f.tipo !== 'evento' && f.real === null && op.esConsultable(f) && tocaConsultar(f, ahora),
  );
  if (tocan.length === 0) return resumen;

  const [guardados, consenso] = await Promise.all([op.almacen.leerDatos(), op.almacen.leerConsenso()]);
  const antes = huella(guardados);
  const datos = sincronizar(op.calendario, guardados, ahora);
  aplicarCorrecciones(datos.eventos, op.correcciones, ahora);
  aplicarConsensos(datos.eventos, consenso);

  const porId = new Map(datos.eventos.map((e) => [e.id, e]));
  const aConsultar = tocan.map((f) => porId.get(f.id)).filter((e): e is EventoGuardado => e !== undefined && e.real === null);

  if (aConsultar.length > 0) {
    resumen.motivo = 'consulta';
    resumen.consultados = aConsultar.map((e) => e.id);
    const claves = new Set(aConsultar.map((e) => indicadorDe(e).clave));
    const paraRevision = datos.eventos.filter(
      (e) => e.real !== null && e.real.fuente !== FUENTE_MANUAL && claves.has(indicadorDe(e).clave),
    );
    const pedidos = new Set(resumen.consultados);
    const resultado = await op.consultar({ aConsultar, paraRevision }, ahora);

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
  } else {
    resumen.motivo = 'ya publicados';
  }

  actualizarEstados(datos, op.esConsultable, ahora);
  if (huella(datos) !== antes) {
    datos.actualizado = ahora.toISOString();
    await op.almacen.guardarDatos(datos);
    resumen.escribioDatos = true;
  }
  return resumen;
}
