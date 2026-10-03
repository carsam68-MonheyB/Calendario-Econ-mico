// Llamadas HTTP a las fuentes: tiempo máximo por llamada y errores sin llaves.

export const TIEMPO_MAXIMO_MS = 8_000;

export class ErrorFuente extends Error {
  override name = 'ErrorFuente';
}

/** Valores de entorno que nunca deben aparecer en un mensaje. */
export function secretosDelEntorno(env: Record<string, string | undefined> = process.env): string[] {
  return Object.entries(env)
    .filter(([nombre, valor]) => /(KEY|TOKEN|SECRET)/i.test(nombre) && typeof valor === 'string' && valor.length >= 6)
    .map(([, valor]) => valor as string);
}

/** Quita llaves y parámetros de URL de un mensaje de error antes de guardarlo o mostrarlo. */
export function sanitizar(mensaje: string, secretos: string[] = secretosDelEntorno()): string {
  let limpio = mensaje;
  for (const secreto of secretos) limpio = limpio.split(secreto).join('•••');
  // Las URL se reducen a su host y ruta: los parámetros pueden llevar llaves.
  limpio = limpio.replace(/(https?:\/\/[^\s?#"']+)[?#][^\s"']*/g, '$1');
  return limpio.slice(0, 300);
}

/** fetch con tiempo máximo. Lanza ErrorFuente con un mensaje seguro de guardar. */
export async function obtener(url: string | URL, opciones: RequestInit = {}, tiempoMs = TIEMPO_MAXIMO_MS): Promise<Response> {
  let respuesta: Response;
  try {
    respuesta = await fetch(url, {
      ...opciones,
      headers: { 'User-Agent': 'calendario-economico/1.0', Accept: 'application/json, text/html;q=0.9, */*;q=0.5', ...opciones.headers },
      signal: AbortSignal.timeout(tiempoMs),
    });
  } catch (error) {
    const e = error as Error & { cause?: { code?: string } };
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      throw new ErrorFuente(`Sin respuesta en ${tiempoMs / 1000} s`);
    }
    throw new ErrorFuente(sanitizar(`Error de red${e.cause?.code ? ` (${e.cause.code})` : ''}: ${e.message}`));
  }
  const redireccionManual = opciones.redirect === 'manual' && respuesta.status >= 300 && respuesta.status < 400;
  if (!respuesta.ok && !redireccionManual) {
    // Se consume el cuerpo para liberar la conexión.
    await respuesta.body?.cancel().catch(() => {});
    throw new ErrorFuente(`HTTP ${respuesta.status}`);
  }
  return respuesta;
}

export async function obtenerJson<T = unknown>(url: string | URL, opciones: RequestInit = {}, tiempoMs = TIEMPO_MAXIMO_MS): Promise<T> {
  const respuesta = await obtener(url, opciones, tiempoMs);
  try {
    return (await respuesta.json()) as T;
  } catch {
    throw new ErrorFuente('Respuesta que no es JSON');
  }
}

export async function obtenerTexto(url: string | URL, opciones: RequestInit = {}, tiempoMs = TIEMPO_MAXIMO_MS): Promise<string> {
  return (await obtener(url, opciones, tiempoMs)).text();
}
