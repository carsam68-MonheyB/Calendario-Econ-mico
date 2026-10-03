// Estructuras que se guardan en Netlify Blobs (store "calendario").

import type { FilaCalendario } from './calendario.ts';
import type { EstadoVisible } from './programacion.ts';

export interface ValorConFuente {
  valor: number;
  /** Quién lo dio: "BLS", "INEGI", "Dataset", "Manual", etc. */
  fuente: string;
  /** Página pública del dato o del boletín. Nunca lleva llaves. */
  url: string | null;
  /** Cuándo se obtuvo (ISO, UTC). */
  obtenido: string;
}

/** Llave "datos": el calendario con esperado, real, estado, fuente y hora de actualización. */
export interface EventoGuardado extends Omit<FilaCalendario, 'esperado' | 'real' | 'anterior'> {
  esperado: ValorConFuente | null;
  /** Último dato publicado antes del evento: el del periodo anterior o la tasa vigente. */
  anterior: ValorConFuente | null;
  /** Primera cifra publicada. No se sobrescribe con revisiones. */
  real: ValorConFuente | null;
  /** Cifra revisada más reciente, si difiere de la primera. */
  revision: ValorConFuente | null;
  estado: EstadoVisible;
  actualizado: string | null;
}

export interface Datos {
  version: 1;
  actualizado: string;
  eventos: EventoGuardado[];
}

/** Llave "estado": por fuente, el último intento, la última respuesta correcta y el último error. */
export interface EstadoFuente {
  ultimoIntento: string | null;
  ultimoExito: string | null;
  ultimoError: { fecha: string; mensaje: string } | null;
}

export interface EstadoServicio {
  version: 1;
  ultimaCorrida: string | null;
  fuentes: Record<string, EstadoFuente>;
}
