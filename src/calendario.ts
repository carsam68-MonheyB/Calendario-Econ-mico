// Calendario base: lectura y validación de data/calendario.csv.

export type Pais = 'MX' | 'US';
export type Tipo = 'nivel' | 'pct' | 'tasa' | 'evento';
export type Mejor = 'alto' | 'bajo' | 'neutral';

export interface FilaCalendario {
  id: string;
  fecha: string; // AAAA-MM-DD
  hora: string | null; // HH:MM en hora del centro de México (UTC−6)
  pais: Pais;
  indicador: string;
  periodo: string;
  unidad: string;
  tipo: Tipo;
  mejor: Mejor;
  esperado: number | null;
  real: number | null;
}

const COLUMNAS = ['fecha', 'hora', 'pais', 'indicador', 'periodo', 'unidad', 'tipo', 'mejor', 'esperado', 'real'] as const;
const TIPOS: readonly Tipo[] = ['nivel', 'pct', 'tasa', 'evento'];
const MEJORES: readonly Mejor[] = ['alto', 'bajo', 'neutral'];

/** Identificador estable y legible, por ejemplo "2026-10-08-mx-inpc-general-anual". */
export function idEvento(fecha: string, pais: string, indicador: string): string {
  const texto = `${fecha} ${pais} ${indicador}`
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  return texto.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Lector de CSV que respeta comillas dobles (por si el archivo se edita en Excel). */
export function parsearCsv(texto: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = '';
  let entreComillas = false;
  const limpio = texto.replace(/^﻿/, '');
  for (let i = 0; i < limpio.length; i++) {
    const c = limpio[i];
    if (entreComillas) {
      if (c === '"') {
        if (limpio[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          entreComillas = false;
        }
      } else {
        campo += c;
      }
    } else if (c === '"') {
      entreComillas = true;
    } else if (c === ',') {
      fila.push(campo);
      campo = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && limpio[i + 1] === '\n') i++;
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = '';
    } else {
      campo += c;
    }
  }
  if (campo !== '' || fila.length > 0) {
    fila.push(campo);
    filas.push(fila);
  }
  return filas.filter((f) => f.some((v) => v.trim() !== ''));
}

function numeroOpcional(valor: string, linea: number, columna: string): number | null {
  const v = valor.trim();
  if (v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Línea ${linea}: "${columna}" no es un número (${v}).`);
  return n;
}

export function leerCalendario(texto: string): FilaCalendario[] {
  const [encabezado, ...resto] = parsearCsv(texto);
  if (!encabezado || encabezado.map((c) => c.trim()).join(',') !== COLUMNAS.join(',')) {
    throw new Error(`El encabezado del calendario debe ser: ${COLUMNAS.join(',')}`);
  }
  const vistos = new Set<string>();
  return resto.map((celdas, i) => {
    const linea = i + 2;
    if (celdas.length !== COLUMNAS.length) {
      throw new Error(`Línea ${linea}: se esperaban ${COLUMNAS.length} columnas y hay ${celdas.length}.`);
    }
    const [fecha, hora, pais, indicador, periodo, unidad, tipo, mejor, esperado, real] = celdas.map((c) => c.trim()) as [
      string, string, string, string, string, string, string, string, string, string,
    ];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new Error(`Línea ${linea}: fecha inválida (${fecha}).`);
    if (hora !== '' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) throw new Error(`Línea ${linea}: hora inválida (${hora}).`);
    if (pais !== 'MX' && pais !== 'US') throw new Error(`Línea ${linea}: país inválido (${pais}).`);
    if (!TIPOS.includes(tipo as Tipo)) throw new Error(`Línea ${linea}: tipo inválido (${tipo}).`);
    if (!MEJORES.includes(mejor as Mejor)) throw new Error(`Línea ${linea}: "mejor" inválido (${mejor}).`);
    if (indicador === '') throw new Error(`Línea ${linea}: falta el indicador.`);
    const id = idEvento(fecha, pais, indicador);
    if (vistos.has(id)) throw new Error(`Línea ${linea}: evento repetido (${fecha}, ${pais}, ${indicador}).`);
    vistos.add(id);
    return {
      id,
      fecha,
      hora: hora === '' ? null : hora,
      pais,
      indicador,
      periodo,
      unidad,
      tipo: tipo as Tipo,
      mejor: mejor as Mejor,
      esperado: numeroOpcional(esperado, linea, 'esperado'),
      real: numeroOpcional(real, linea, 'real'),
    };
  });
}
