// Consenso del mercado buscado por Claude con la herramienta de búsqueda web (modo FUENTE_CONSENSO=claude).

import Anthropic from '@anthropic-ai/sdk';
import type { FilaCalendario } from '../calendario.ts';

/** Lo que se necesita de una fila para preguntar su consenso. */
export type FilaBase = Omit<FilaCalendario, 'esperado' | 'real'>;
import { indicadorDe } from '../indicadores.ts';
import { periodoDeEvento } from '../periodos.ts';
import { ErrorFuente, sanitizar } from '../red.ts';

/** Modelo vigente según la documentación de Claude. Se puede cambiar con la variable CLAUDE_MODELO. */
export const MODELO_POR_OMISION = 'claude-opus-5-5';
const MAXIMO_REANUDACIONES = 4;

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const ORDINALES = ['primer', 'segundo', 'tercer', 'cuarto'];

export const INSTRUCCIONES = `Buscas el consenso del mercado para un indicador económico que se publicará pronto. El consenso es la mediana o el promedio de los pronósticos de analistas encuestados por un medio o proveedor reconocido, por ejemplo Reuters, Bloomberg, Dow Jones o MarketWatch, la columna de consenso de Trading Economics, Investing.com o FXStreet; para México también Citi, Banorte, El Economista o El Financiero.

Reglas:
- Usa la búsqueda web; no respondas de memoria.
- El consenso debe corresponder exactamente al indicador, la medición y el periodo que se piden.
- No uses el pronóstico propio de Trading Economics (TEForecast), ni el dato del periodo anterior, ni una estimación tuya.
- Si las fuentes no coinciden, usa la encuesta más reconocida.
- Si no hay un consenso claro para ese periodo, el valor es null.
- Expresa el valor en la unidad que se indica.

Responde únicamente con este objeto JSON, sin texto antes ni después:
{"valor": número o null, "fuente": "nombre de la encuesta o del medio", "url": "dirección de la página donde viste el consenso"}`;

function fechaLarga(fecha: string): string {
  const [a, m, d] = fecha.split('-').map(Number) as [number, number, number];
  const dia = new Date(Date.UTC(a, m - 1, d)).getUTCDay();
  return `${DIAS[dia]} ${d} de ${MESES[m - 1]} de ${a}`;
}

export function describirPeriodo(fila: FilaBase): string {
  const p = periodoDeEvento(fila);
  if (!p) return fila.periodo;
  switch (p.tipo) {
    case 'mes':
      return `${MESES[p.mes - 1]} de ${p.anio}`;
    case 'trimestre':
      return `${ORDINALES[p.trimestre - 1]} trimestre de ${p.anio}`;
    case 'quincena':
      return `primera quincena de ${MESES[p.mes - 1]} de ${p.anio}`;
    case 'dia':
      return `decisión anunciada el ${fechaLarga(p.fecha)}`;
  }
}

export function describirMedicion(fila: FilaBase): string {
  const clave = indicadorDe(fila).clave;
  if (clave === 'us.fed') return 'límite superior del rango objetivo de la tasa de fondos federales';
  if (clave === 'mx.banxico') return 'tasa objetivo (tasa de interés interbancaria a un día)';
  if (fila.unidad === '% a/a') {
    return fila.pais === 'MX' ? 'variación anual con cifras originales (sin ajuste estacional)' : 'variación anual';
  }
  if (fila.unidad === '% m/m') return 'variación mensual con cifras desestacionalizadas';
  if (fila.unidad === '% t/t anualizado') return 'variación trimestral anualizada con cifras desestacionalizadas';
  if (fila.unidad === '% t/t') return 'variación trimestral con cifras desestacionalizadas';
  if (clave === 'mx.confianza') return 'nivel del índice con cifras desestacionalizadas';
  return 'nivel publicado en el boletín';
}

export function describirUnidad(fila: FilaBase): string {
  switch (fila.unidad) {
    case '%':
      return fila.tipo === 'tasa' ? 'porcentaje, por ejemplo 4.25' : 'porcentaje, por ejemplo 4.2';
    case '% a/a':
    case '% m/m':
    case '% t/t':
    case '% t/t anualizado':
      return 'porcentaje, por ejemplo 2.5';
    case 'miles':
      return 'miles, por ejemplo 150 para 150,000 empleos';
    case 'millones':
      return 'millones, por ejemplo 7.2 para 7.2 millones';
    case 'mmd USD':
      return 'miles de millones de dólares; un déficit va con signo negativo, por ejemplo -78.5';
    case 'mdd':
      return 'millones de dólares; un déficit va con signo negativo, por ejemplo -1250';
    case 'índice':
      return 'puntos del índice, por ejemplo 52.3';
    default:
      return fila.unidad || 'la unidad del boletín';
  }
}

export function preguntaConsenso(fila: FilaBase): string {
  const pais = fila.pais === 'MX' ? 'México' : 'Estados Unidos';
  const hora = fila.hora ? ` a las ${fila.hora}, hora del centro de México` : '';
  return [
    `Indicador: ${pais}, ${fila.indicador}.`,
    `Medición: ${describirMedicion(fila)}.`,
    `Periodo de referencia: ${describirPeriodo(fila)}.`,
    `Publicación: ${fechaLarga(fila.fecha)}${hora}.`,
    `Unidad del valor: ${describirUnidad(fila)}.`,
  ].join('\n');
}

/** Toma el último objeto JSON con "valor" del texto de la respuesta y lo valida. */
export function leerJsonConsenso(texto: string): { valor: number | null; fuente: string; url: string | null } | null {
  const candidatos = texto.match(/\{[^{}]*"valor"[^{}]*\}/g) ?? [];
  for (const candidato of candidatos.reverse()) {
    let objeto: Record<string, unknown>;
    try {
      objeto = JSON.parse(candidato) as Record<string, unknown>;
    } catch {
      continue;
    }
    let valor: number | null | undefined;
    if (objeto.valor === null) valor = null;
    else if (typeof objeto.valor === 'number' && Number.isFinite(objeto.valor)) valor = objeto.valor;
    else if (typeof objeto.valor === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(objeto.valor)) valor = Number(objeto.valor);
    if (valor === undefined) continue;
    const fuente = typeof objeto.fuente === 'string' ? objeto.fuente.trim().slice(0, 120) : '';
    const url = typeof objeto.url === 'string' && /^https:\/\/[^\s"<>]+$/.test(objeto.url.trim()) ? objeto.url.trim() : null;
    return { valor, fuente, url };
  }
  return null;
}

function mensajeDeError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) return 'Anthropic: la llave no es válida';
  if (error instanceof Anthropic.PermissionDeniedError) return 'Anthropic: la llave no tiene permiso para este modelo o herramienta';
  if (error instanceof Anthropic.RateLimitError) return 'Anthropic: se alcanzó el límite de peticiones';
  if (error instanceof Anthropic.BadRequestError) return sanitizar(`Anthropic: solicitud rechazada (${error.message})`);
  if (error instanceof Anthropic.APIError) return `Anthropic: error ${error.status ?? 'de conexión'}`;
  if (error instanceof ErrorFuente) return error.message;
  return sanitizar(`Anthropic: ${(error as Error).message}`);
}

export interface ResultadoClaude {
  valor: number | null;
  fuente: string;
  url: string | null;
  busquedas: number;
}

export async function consultarConsenso(fila: FilaBase, llave: string, modelo = MODELO_POR_OMISION): Promise<ResultadoClaude> {
  const cliente = new Anthropic({ apiKey: llave, maxRetries: 2 });
  const mensajes: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: preguntaConsenso(fila) }];
  const parametros = {
    model: modelo,
    max_tokens: 16000,
    // Si un clasificador de seguridad rechaza la solicitud, la API la repite con el modelo de respaldo recomendado.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default' as const,
    output_config: { effort: 'medium' as const },
    system: INSTRUCCIONES,
    tools: [
      {
        type: 'web_search_20260318' as const,
        name: 'web_search' as const,
        max_uses: 5,
        response_inclusion: 'excluded' as const,
        user_location: { type: 'approximate' as const, country: fila.pais },
      },
    ],
  };
  try {
    let respuesta = await cliente.beta.messages.create({ ...parametros, messages: mensajes });
    let busquedas = respuesta.usage.server_tool_use?.web_search_requests ?? 0;
    // Una búsqueda larga puede pausarse: se reenvía el turno tal cual y la API continúa.
    for (let i = 0; respuesta.stop_reason === 'pause_turn' && i < MAXIMO_REANUDACIONES; i++) {
      mensajes.push({ role: 'assistant', content: respuesta.content });
      respuesta = await cliente.beta.messages.create({ ...parametros, messages: mensajes });
      busquedas += respuesta.usage.server_tool_use?.web_search_requests ?? 0;
    }
    if (respuesta.stop_reason === 'refusal') throw new ErrorFuente('Anthropic: la solicitud fue rechazada');
    if (respuesta.stop_reason === 'pause_turn') throw new ErrorFuente('Anthropic: la búsqueda no terminó');
    const texto = respuesta.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    const leido = leerJsonConsenso(texto);
    if (!leido) throw new ErrorFuente('Anthropic: la respuesta no trajo el JSON esperado');
    return { ...leido, busquedas };
  } catch (error) {
    throw new ErrorFuente(mensajeDeError(error));
  }
}
