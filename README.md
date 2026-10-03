# Calendario económico México–EUA

Calendario de indicadores económicos de México y Estados Unidos del 30 de septiembre al 31 de diciembre de 2026. El dato real se llena solo en cuanto el organismo lo publica, sin captura manual. El esperado se llena con el consenso del mercado si se activa.

La interfaz va en español y los números en formato es-MX. Las horas son del centro de México (UTC−6, sin horario de verano).

## Cómo funciona

| Pieza | Qué hace |
|---|---|
| `public/index.html` | La página. Pide `/api/datos` al abrir y nunca escribe datos. |
| `netlify/functions/actualizar.mts` | Función programada cada minuto en días hábiles de 11:00 a 20:59 UTC (5:00 a 14:59 del centro). Ahí caen todas las publicaciones con hora. |
| `netlify/functions/actualizar-cada-15.mts` | Función programada cada 15 minutos el resto del día y los fines de semana. Netlify admite un solo horario por función, por eso son dos archivos. |
| `netlify/functions/consenso-background.mts` | Background Function (hasta 15 minutos) que busca el consenso con Claude. |
| `netlify/functions/datos.mts` | `GET /api/datos` y `GET /api/estado`, con `Cache-Control: no-store`. |
| `src/fuentes.ts` | Mapeo indicador → fuente y serie, y el cálculo de cada dato. |
| `src/calculos.ts` | Variación contra lo esperado, puntos porcentuales, puntos base y redondeo. |
| `data/calendario.csv` | Las 91 filas del calendario. Viaja dentro de cada función y se carga en Blobs la primera vez. |
| `data/correcciones.json` | Correcciones manuales de respaldo. |

Netlify Blobs guarda todo en el store `calendario`:

- `datos`: el calendario con esperado, real, estado, fuente y hora de actualización.
- `estado`: por fuente, el último intento, la última respuesta correcta y el último error.
- `consenso`: el esperado que se buscó y sus intentos.

Los datos nunca se guardan en el repositorio. Que llegue un dato no genera commits ni deploys. Si cambias el CSV, en el siguiente deploy se actualizan fechas, horas y nombres sin perder los datos ya obtenidos.

### Cuándo se consulta cada evento

| Momento | Frecuencia |
|---|---|
| Desde la hora de publicación, durante 45 minutos | Cada minuto |
| Después, hasta las 23:59 | Cada 15 minutos |
| Eventos sin hora, de 6:00 a 20:00 | Cada 15 minutos |
| Sin dato al terminar el día: "Retrasado", todo el día siguiente | Cada hora |
| Después, hasta 30 días | Cada 6 horas |

Cuando un evento ya tiene su dato real, deja de consultarse. Una corrida sin ventana activa termina sin leer Blobs ni llamar a ninguna fuente. Las series del mismo organismo van en una sola llamada cuando el tamaño lo permite (BLS y Banxico agrupan; BEA y Census, una llamada por tabla; INEGI, una por serie porque cada serie completa pesa unos 100 KB). Todas las llamadas de una corrida van en paralelo y cada una tiene un límite de 8 segundos.

El último tramo, cada 6 horas durante 30 días, no estaba en la especificación. Lo agregué para que un dato que tarda días, por ejemplo por un cierre del gobierno de EUA, llegue solo.

### La página

- Si hay un evento entre 2 minutos antes y 30 minutos después de su hora, vuelve a pedir datos cada 30 segundos; si no, cada 10 minutos. Se pausa con la pestaña oculta y actualiza al volver. Usa `If-None-Match`, así que una respuesta sin cambios no trae cuerpo.
- Estados por fila: "Pendiente", "Esperando dato", "Publicado" y "Retrasado". ISM, IMEF y ADP muestran "Sin fuente automática" en modo oficial.
- Un dato nuevo resalta su fila una sola vez y muestra "Nuevo" durante 10 minutos. Con permiso del navegador, avisa con una notificación como "EUA, CPI general anual sep: 3.1% vs 3.0% esperado (+3.3%)".
- Arriba muestra "Actualizado hace X min". Si el servidor no responde, avisa y muestra la hora del último dato bueno.

## Fuente del dato real

Se elige con `FUENTE_REAL`: `oficial` (por omisión) o `tradingeconomics`.

### Modo oficial

| Indicador | Fuente | Serie | Cálculo |
|---|---|---|---|
| Nómina no agrícola | BLS | CES0000000001 | Nivel del mes − nivel del mes anterior, en miles |
| Tasa de desempleo EUA | BLS | LNS14000000 | Valor publicado |
| CPI general y subyacente a/a | BLS | CUUR0000SA0, CUUR0000SA0L1E (sin ajuste) | (índice / índice de hace 12 meses − 1) × 100 |
| PPI demanda final a/a | BLS | WPUFD4 (sin ajuste) | Igual que el CPI |
| Vacantes JOLTS | BLS | JTS000000000000000JOL | Miles ÷ 1,000 |
| Costo del empleo (ECI) t/t | BLS | CIS1010000000000Q | Valor publicado |
| PIB t/t anualizado | BEA | NIPA T10101, A191RL | Valor publicado. La 2a estimación y la final solo se aceptan si BEA marca la tabla como revisada ese día |
| PCE subyacente a/a | BEA | NIPA T20804, DPCCRG | Variación anual del índice |
| Balanza comercial EUA | Census | EITS `ftd`, BOPGS / BAL, desestacionalizada | Millones ÷ 1,000 |
| Cuenta corriente | BEA | ITA BalCurrAcct, QSA | Millones ÷ 1,000 |
| Ventas minoristas EUA m/m | Census | EITS `marts`, 44X72 / MPCSM | Valor publicado |
| Decisión de la Fed | federalreserve.gov | Comunicado `monetaryAAAAMMDDa.htm` | Límite superior del rango objetivo |
| INPC general y subyacente | INEGI | 910392, 910393 | Variación anual del índice |
| INPC 1a quincena | INEGI | 910420, 910421 | Contra la misma quincena del año anterior |
| IGAE | INEGI | 737121 | Variación anual, serie original |
| Actividad industrial | INEGI | 736407 | Variación anual, serie original |
| PIB oportuno | INEGI | 798947 | Variación anual publicada, serie original |
| PIB | INEGI | 735879 | Variación anual, serie original |
| Consumo privado | INEGI | 740933 | Variación anual, serie original |
| Ventas minoristas MX | INEGI | 718506 | Variación anual, serie original |
| Tasa de desempleo MX | INEGI | 444603 | Valor publicado, serie original (la del boletín) |
| Balanza comercial MX | INEGI | 897 | Saldo publicado, millones de dólares |
| Confianza del consumidor | INEGI | 454186 | Serie desestacionalizada (la que encabeza el boletín) |
| Remesas | Banxico SIE | SE27803 | Valor publicado, millones de dólares |
| Decisión de Banxico | banxico.org.mx | Anuncio de las 13:00 | Nivel del anuncio; si solo dice el movimiento, se aplica a la tasa vigente ese día (SF61745) |
| ISM, IMEF y ADP | — | — | Son privados: solo con `FUENTE_REAL=tradingeconomics` |

INEGI se consulta con la fuente `BIE-BISE` y el área geográfica `00`. Para INEGI, la serie anual que publica el propio instituto (910406, 737145, etc.) queda de respaldo por si falta el índice del año anterior.

FRED se usa solo si la fuente primaria no responde: PAYEMS, UNRATE, CPIAUCNS, CPILFENS, JTSJOL, ECIALLCIV, A191RL1Q225SBEA (solo el avance del PIB), PCEPILFE, BOPGSTB, IEABC y RSAFS.

Las decisiones de la Fed y de Banxico salen del comunicado oficial del día. FRED y el SIE cambian la tasa hasta la fecha en que entra en vigor, así que no se usan como fuente.

### Reglas de cálculo

- **Variaciones a/a:** cifras originales, sin ajuste estacional. La excepción es el PCE: BEA solo publica el índice desestacionalizado y calcula su variación anual sobre ese índice, igual que aquí.
- **Variaciones m/m y t/t:** cifras desestacionalizadas, tal como las publica la fuente.
- **Redondeo:** igual que el boletín. CPI, PPI, PCE, PIB de EUA y tasas de desempleo, 1 decimal. INPC, 2 decimales. JOLTS, 1 decimal en millones. Tasas de interés, 2 decimales.
- **Primera cifra:** se guarda la primera cifra publicada. Si una consulta posterior trae una cifra distinta (por ejemplo, la nómina de septiembre revisada en el informe de octubre), se guarda aparte y se muestra en texto pequeño. La variación siempre usa la primera cifra.
- **Periodo:** un valor solo se acepta si su fecha de observación es el periodo del evento. Si la API todavía muestra el mes anterior, se sigue esperando.

### Modo tradingeconomics

Toma del calendario de Trading Economics el campo `Actual` como dato real. Cubre también ISM, IMEF y ADP. Cada fila del CSV se busca por país, fecha de publicación, nombre del evento en TE y periodo; el mapeo está en `src/organismos/te.ts`.

Los nombres de los eventos de TE no se pudieron comprobar sin una llave de pago. Si alguno no coincide, el evento se queda sin dato y `/api/estado` lo informa; se corrige editando `NOMBRES_TE`.

## Fuente del esperado

Se elige con `FUENTE_CONSENSO`: `ninguna` (por omisión), `claude` o `tradingeconomics`. Cada esperado guarda de dónde vino; en la página, el ícono de información junto al valor muestra la fuente.

- **`claude`:** a las 20:00 de la víspera, la función programada dispara `consenso-background`, que le pide a la Messages API el consenso de cada evento del día siguiente, con la búsqueda web (`web_search_20260318`, hasta 5 búsquedas por evento).
  - La respuesta debe ser solo `{"valor": número o null, "fuente": "texto", "url": "..."}`. Sin un consenso claro, `valor` queda en `null`.
  - Modelo: `claude-opus-5-5`, el vigente según la documentación de Claude. Se puede cambiar con `CLAUDE_MODELO`.
  - Si un clasificador de seguridad rechaza la solicitud, la API la repite con el modelo de respaldo recomendado (`fallbacks: "default"`).
  - Un error se reintenta a las 21:00 y a las 22:00 de la víspera y a las 5:00 del día, hasta 3 intentos.
  - La Background Function solo acepta llamadas firmadas por el propio sitio, así que nadie más puede gastar tu saldo.
  - Costo aproximado: 10 dólares por cada 1,000 búsquedas más los tokens. Para los 76 eventos de oct–dic, unos 10 a 20 dólares en total.
- **`tradingeconomics`:** usa el consenso del calendario de TE. TE lo llama `Forecast`; su pronóstico propio, `TEForecast`, nunca se usa.
- **`ninguna`:** el esperado queda vacío y la variación muestra "—".

Lo capturado en el CSV o en `data/correcciones.json` siempre manda sobre el consenso.

## Variables de entorno

| Variable | Valor | Cuándo |
|---|---|---|
| `FUENTE_REAL` | `oficial` o `tradingeconomics` | Opcional; por omisión `oficial` |
| `FUENTE_CONSENSO` | `ninguna`, `claude` o `tradingeconomics` | Opcional; por omisión `ninguna` |
| `BLS_API_KEY` | Llave de BLS | Modo oficial |
| `BEA_API_KEY` | UserID de BEA | Modo oficial |
| `CENSUS_API_KEY` | Llave de Census | Modo oficial |
| `FRED_API_KEY` | Llave de FRED | Modo oficial (respaldo) |
| `INEGI_TOKEN` | Token de INEGI | Modo oficial |
| `BANXICO_TOKEN` | Token del SIE de Banxico | Modo oficial |
| `ANTHROPIC_API_KEY` | Llave de la API de Anthropic | `FUENTE_CONSENSO=claude` |
| `CLAUDE_MODELO` | Otro modelo de Claude | Opcional |
| `TE_API_KEY` | Llave de Trading Economics | Cualquier modo `tradingeconomics` |

Las llaves nunca aparecen en el código, en Blobs, en `/api/datos`, en `/api/estado` ni en la página. `/api/estado` solo dice si cada una está configurada. Los mensajes de error se limpian antes de guardarse.

## Pasos

### 1. Obtener las llaves gratuitas

**BLS**
1. Abre https://data.bls.gov/registrationEngine/
2. En **Organization Name** pon tu nombre y en **Email Address** tu correo.
3. Escribe los números de la imagen, marca **I agree to the Terms of Service.** y toca **Submit Registration**.
4. La llave llega por correo desde labstat@bls.gov. Si trae un enlace de activación, ábrelo. La llave se renueva una vez al año.

**BEA**
1. Abre https://apps.bea.gov/API/signup/
2. En **Register** llena **Name** y **Email**, resuelve el reCAPTCHA, marca **I agree to the Terms of Service** y toca **Register**.
3. Abre el correo y haz clic en el enlace; la llave (UserID) no funciona hasta entonces.

**Census**
1. Abre https://api.census.gov/data/key_signup.html
2. Llena **Organization Name** y **Email Address** (un correo .com.mx puede ser rechazado), marca **I agree to the terms of service** y toca **Request Key**.
3. Abre el correo y haz clic en el enlace para activar la llave.

**FRED**
1. Abre https://fredaccount.stlouisfed.org/apikeys
2. Te pedirá iniciar sesión. En **Want to create a new account?** toca **Register**, o entra con Google.
3. Ya con la sesión iniciada, vuelve a https://fredaccount.stlouisfed.org/apikeys y toca **Request API Key**.
4. Escribe una descripción corta, acepta los términos y envía. La llave aparece en pantalla.

**INEGI**
1. Abre https://www.inegi.org.mx/app/desarrolladores/generatoken/Usuarios/token_Verify
2. Escribe tu correo en **Dirección de correo electrónico** y toca **Obtener token**.
3. El token llega por correo.

**Banxico**
1. Abre https://www.banxico.org.mx/SieAPIRest/service/v1/token
2. En **Solicitar token**, escribe el código de la imagen en **Código de seguridad** y toca **Generar token**.
3. El token aparece una sola vez en pantalla y no llega por correo: cópialo en ese momento.

### 2. Llaves opcionales

**Anthropic** (solo con `FUENTE_CONSENSO=claude`)
1. Abre https://platform.claude.com/settings/keys e inicia sesión.
2. Crea una llave nueva, ponle un nombre como "calendario-economico" y cópiala.
3. La cuenta necesita saldo para usar la API; se agrega en **Billing** → **Add credits**, sin recarga automática.
4. Si le pusiste fecha de vencimiento a la llave, Anthropic te avisa por correo antes; ese día creas otra, la cambias en Netlify y haces un deploy.

**Trading Economics** (de pago): la llave se obtiene en https://developer.tradingeconomics.com después de contratar un plan.

### 3. Conectar el repositorio a un sitio nuevo de Netlify

Al conectarlo, Netlify publica `main` a producción de inmediato, y cada deploy a producción cuesta 15 créditos. Conéctalo cuando `main` ya tenga la versión que quieres publicar.

1. Entra a https://app.netlify.com.
2. En el panel de tu equipo, toca **Add new project** y luego **Import an existing project**.
3. Elige **GitHub** y autoriza a Netlify si te lo pide. Si el repositorio no aparece en la lista, usa la opción para configurar la app de Netlify en GitHub, agrega `Calendario-Econ-mico` y guarda.
4. Elige el repositorio **Calendario-Econ-mico**.
5. Deja la rama `main`. Los demás campos ya vienen de `netlify.toml`: sin comando de compilación, publicación en `public` y funciones en `netlify/functions`.
6. Antes de publicar, carga las variables (paso 4) si la pantalla lo permite; si no, cárgalas justo después.
7. Toca **Publish**.

### 4. Cargar las llaves en Netlify

Cada cambio de variables necesita un deploy nuevo para tomar efecto, así que conviene cargarlas todas juntas.

1. En el proyecto, ve a **Project configuration** → **Environment variables**.
2. Toca **Add a variable** → **Add a single variable**.
3. En **Key** escribe el nombre, por ejemplo `BLS_API_KEY`, y en el valor pega la llave.
4. Marca **Contains secret values**.
5. Toca **Create variable**.
6. Repite para cada llave. `FUENTE_REAL`, `FUENTE_CONSENSO` y `CLAUDE_MODELO` no son secretas.
7. Si el proyecto ya estaba publicado, ve a **Deploys** y lanza un deploy nuevo para que las funciones lean las variables (15 créditos).

### 5. Hacer público el proyecto

Los equipos creados desde el 28 de julio de 2026 crean proyectos privados: solo se ven con sesión de Netlify. Con el consenso de Claude, la función programada llama a su propio sitio y un proyecto privado la bloquea.

1. En el proyecto, ve a **Project configuration** → **General** → **Visitor access** → **Project visibility**.
2. Elige que sea público y guarda. También aparece un botón **Make public** después del primer deploy a producción.

### 6. Confirmar la función programada

1. En el proyecto, ve a **Cloud compute** → **Functions**.
2. Deben aparecer `actualizar` y `actualizar-cada-15` con la etiqueta **Scheduled** y la fecha de su próxima ejecución, más `datos` y `consenso-background`.
3. Al abrir una función ves su horario y sus registros. El botón **Run now** la corre a mano.

### 7. Revisar el consumo de créditos

1. En el panel del equipo, ve a **Usage & billing**.
2. Abre **Credit usage breakdown** para ver cómputo, peticiones, ancho de banda y deploys a producción.
3. **Account usage insights** muestra los créditos por día.

## Corrección manual (respaldo)

Se usa casi nunca, porque cada cambio en `main` es un deploy (15 créditos).

1. En GitHub abre `data/correcciones.json` en la rama `main` y toca el lápiz para editar.
2. Agrega un objeto por evento, con `fecha`, `pais` e `indicador` tal como están en el CSV, y `real` y/o `esperado`. Un `null` borra el dato:
   ```json
   [
     { "fecha": "2026-10-08", "pais": "MX", "indicador": "INPC general anual", "real": 3.76 }
   ]
   ```
3. Toca **Commit changes**. Después del deploy, la página muestra el valor y lo marca como "Corrección manual"; la función lo guarda en su siguiente corrida.

Si el archivo tiene un error, no se aplica ninguna corrección y `/api/estado` dice cuál es.

## Pruebas locales

```bash
npm install
npm test                 # pruebas
npm run typecheck        # tipos
netlify dev              # página y funciones en http://localhost:8888
netlify functions:invoke actualizar
```

En `netlify dev` hay dos variables solo para pruebas: `PRUEBA_AHORA` fija la hora de la corrida (ISO, UTC) y `CALENDARIO_CSV` usa otro calendario. Netlify no las toma en producción.

Las funciones programadas no corren en los deploy previews; su lógica se prueba aquí. Las llaves se toman de las variables del entorno local.

## Verificación realizada

El 3 de octubre de 2026 se comparó cada serie con el último boletín publicado, con las llaves reales:

| Fuente | Series comprobadas | Resultado |
|---|---|---|
| INEGI | INPC general y subyacente (mensual y 1a quincena), IGAE, actividad industrial, PIB oportuno, PIB, consumo privado, ventas minoristas, desempleo, balanza comercial, confianza del consumidor | 15 de 15 coinciden; 3 s en total |
| Banxico | Remesas de agosto (5,452.3 mdd), tasa objetivo (6.50%), anuncio del 24 de septiembre | Coinciden |
| BEA | PIB 2T (2.2%), PCE subyacente de agosto (3.0%), cuenta corriente 2T (−246.0 mmd) | Coinciden |
| Census | Balanza comercial de julio (−88.6 mmd); ventas minoristas de agosto da 1.1% porque Census revisó el 1.2% del boletín el 28 de septiembre | Coinciden |
| FRED | Nómina de septiembre (+29 mil) y desempleo (4.2%) | Coinciden |
| Fed | Comunicado del 16 de septiembre: límite superior 4.00% | Coincide |
| BLS | Pendiente: la llave fue rechazada por la API | Mientras tanto, nómina, desempleo, CPI y JOLTS salen por FRED |

Además, con un calendario de prueba y la hora fijada al 2 de octubre a las 12:00, una corrida de `actualizar` obtuvo INPC de agosto (3.26% y 3.88%), IGAE de julio (3.4%), nómina (+29 mil, −67.4% contra lo esperado) y desempleo (4.2%, +2.4% y +0.10 pp) en 2.8 segundos; el INPC de septiembre quedó "Pendiente" sin tomar el dato de agosto, y ninguna llave apareció en `/api/datos` ni en `/api/estado`. Una corrida sin ventana activa termina en menos de 0.3 segundos.

## Estimación de créditos de Netlify

Plan Personal: 1,000 créditos al mes compartidos por todo el equipo. En este plan la memoria de las funciones está fija en 1 GB, así que el cómputo solo depende del tiempo de ejecución.

| Concepto | Cálculo | Créditos al mes |
|---|---|---|
| Corridas sin ventana activa | ~15,900 corridas (cada minuto en días hábiles 11–20 UTC más cada 15 minutos) × 0.05–0.4 s × 1 GB ≈ 0.5 GB-h × 10 créditos | ~5 |
| Corridas con consultas | ~16 publicaciones con hora al mes, casi todas resueltas en pocos minutos | ~1 (hasta ~15 si todas se retrasan) |
| Consenso con Claude | ~16 días con eventos × ~90 s de espera | ~4 |
| Peticiones web | Corridas programadas (si cuentan) más la página: ~21,000 × 2 por cada 10,000 | ~4 |
| Ancho de banda | Respuestas 304 sin cuerpo; < 0.1 GB × 20 | < 2 |
| **Total en operación normal** | | **~15 (peor caso ~30)** |
| Deploy a producción | 15 por deploy; previews y deploys fallidos no cuestan | Solo cuando cambia el código |

Si el consumo real supera la meta de 50, se puede pasar el cron a cada 2 minutos o acortar la ventana de 11–20 UTC a las horas con publicaciones.

## Notas

- **CPI de octubre de 2026:** el BLS no recopiló el CPI de octubre de 2025 por el cierre del gobierno, así que falta la base de la variación anual. Si el BLS publica su propio cambio a 12 meses, se usa ese; si no, el evento queda "Retrasado" y se captura en `data/correcciones.json`.
- **Retrasos de las APIs:** el dato llega a la página alrededor de 1 minuto después de que la API de la fuente se actualiza. Algunas actualizan su API unos minutos después del boletín.
- **Límites de las APIs:** BLS, 500 consultas al día; BEA, 100 por minuto; Banxico, 80 por minuto y 40,000 al día; FRED, 120 por minuto. El calendario se queda muy por debajo.
- **Fines de semana y feriados:** sin publicaciones, la función termina de inmediato.
