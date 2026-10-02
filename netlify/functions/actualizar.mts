// Función programada: cada minuto en días hábiles de 11:00 a 20:59 UTC (5:00 a 14:59 hora del centro).
// Ahí caen todas las publicaciones con hora. Sin ventana activa termina de inmediato.

import type { Config } from '@netlify/functions';
import { crearConsultor } from '../../src/consultor-por-modo.ts';
import { correrProgramada } from '../../src/programada.ts';

export default async () => {
  await correrProgramada('cada-minuto', crearConsultor);
};

export const config: Config = {
  schedule: '* 11-20 * * 1-5',
};
