// Función programada: cada 15 minutos el resto del día y los fines de semana, para eventos sin hora
// y para los retrasados. Netlify admite un solo horario por función, por eso es un archivo aparte.

import type { Config } from '@netlify/functions';
import { crearConsultor } from '../../src/consultor-por-modo.ts';
import { correrProgramada, cubiertoPorCronDeMinuto } from '../../src/programada.ts';

export default async () => {
  // En días hábiles de 11:00 a 20:59 UTC ya corre la función de cada minuto.
  if (cubiertoPorCronDeMinuto(new Date())) return;
  await correrProgramada('cada-15', crearConsultor);
};

export const config: Config = {
  schedule: '*/15 * * * *',
};
