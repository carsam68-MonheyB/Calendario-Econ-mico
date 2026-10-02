# Prompt: Calendario económico México–EUA con datos automáticos (oct–dic 2026)

## Objetivo

Construye una aplicación web pequeña con el calendario de indicadores económicos de México y Estados Unidos del 30 de septiembre al 31 de diciembre de 2026. La aplicación debe llenar sola el dato real en cuanto se publique, sin captura manual.

Por cada indicador muestra:
- la fecha;
- el país con su bandera;
- el indicador;
- el dato esperado;
- el dato real;
- la variación en porcentaje.

El usuario es contralor financiero y la consulta en celular y en computadora. La interfaz va en español y los números en formato es-MX.

Cuando necesites que yo configure algo (crear cuentas, obtener llaves de API o desplegar), dame pasos exactos y numerados. Incluye la ruta precisa de cada pantalla y no des por sabido dónde está cada opción.

No inventes datos. Un valor real solo se muestra si lo devolvió una fuente y corresponde al periodo correcto.

## Arquitectura

Usa el mismo flujo de mis otros proyectos: un repositorio en GitHub trabajado con Claude Code, publicado en Netlify, donde tengo plan de pago. La regla central es que **los datos no se guardan en el repositorio**. En Netlify cada deploy a producción consume créditos, así que un deploy solo debe ocurrir cuando cambia el código, nunca cuando llega un dato.

1. **Repositorio en GitHub** conectado a Netlify como siempre. Puede ser privado.
2. **Netlify Scheduled Function** (`netlify/functions/actualizar.mts`).
   - Corre por cron. Netlify usa UTC y permite un intervalo mínimo de 1 minuto.
   - Revisa qué eventos tocan, consulta sus fuentes y guarda los resultados.
   - Tiene un límite de 30 segundos por ejecución. Por eso cada corrida consulta solo las series que tocan, en paralelo y con un timeout de unos 8 segundos por llamada.
3. **Netlify Blobs** como almacenamiento.
   - Un store `calendario` con la llave `datos` (dataset con esperado, real, estado, fuente y hora de actualización).
   - La llave `estado` guarda, por fuente, el último intento, la última respuesta correcta y el último error.
   - Escribe solo cuando algo cambia.
4. **Función de lectura** (`netlify/functions/datos.mts`).
   - Expone `GET /api/datos` y `GET /api/estado` con `config.path`.
   - Responde con `Cache-Control: no-store`.
5. **Página estática** (`index.html`) en el mismo sitio.
6. **Llaves de API.** Van en Site configuration → Environment variables, marcadas como secretas. Nunca aparecen en el código, en Blobs ni en las respuestas.

### Programación

Programa dos crons:
- **Cada minuto, en días hábiles, de 11:00 a 20:59 UTC** (5:00 a 14:59 hora del centro). Ahí caen todas las publicaciones con hora. Si no hay una ventana activa, la función termina de inmediato para gastar lo mínimo de cómputo.
- **Cada 15 minutos el resto del día y los fines de semana,** para eventos sin hora y para los "Retrasados".

Además:
- Las horas del dataset están en UTC−6; súmales 6 horas para pasarlas a UTC.
- Las Scheduled Functions solo corren en deploys publicados. Para probar localmente usa `netlify dev` y `netlify functions:invoke actualizar`.
- Mi plan es **Netlify Personal**. Verifica que el cron de 1 minuto esté disponible en ese plan. Si no lo está, usa el intervalo mínimo permitido y avísame.
- La consulta del consenso con Claude puede tardar más de 30 segundos. Hazla en una Background Function, que tiene 15 minutos de límite, disparada por la función programada.

### Presupuesto de créditos

El plan Personal trae 1,000 créditos al mes, compartidos con todos los sitios de mi equipo en Netlify, incluido monheyb.com. Este proyecto debe consumir lo menos posible:

- **Meta:** menos de 50 créditos al mes en operación normal.
- **Deploys:** cada deploy a producción cuesta 15 créditos. Mientras se desarrolla, trabaja en una rama aparte y revisa los cambios en deploy previews. Pasa a producción solo cuando una etapa esté terminada y probada, y dime antes de cada deploy a producción.
- **Pruebas:** las Scheduled Functions no corren en los previews. La lógica de consulta se prueba en local con `netlify dev` y `netlify functions:invoke`.
- **Memoria:** si el plan lo permite, configura las funciones con la memoria mínima que les alcance, porque el cómputo se cobra por GB-hora.
- **Recorte:** si la estimación de cómputo supera la meta, propón cómo reducirla, por ejemplo con un cron cada 2 minutos o con ventanas más cortas, antes de aplicarlo.

Archivos esperados:
- `netlify/functions/actualizar.mts`, `netlify/functions/datos.mts` y, si se usa, `netlify/functions/consenso-background.mts`
- `src/fuentes.ts` (mapeo indicador → fuente y serie) y `src/calculos.ts`
- `data/calendario.csv`, que se carga en Blobs la primera vez
- `data/correcciones.json`
- `index.html`, `netlify.toml` y `README.md`

## Fuente del dato real

Se elige con la variable `FUENTE_REAL`, que puede valer `oficial` o `tradingeconomics`.

### Modo `oficial` (gratis)

Pide registrarse para obtener llaves sin costo. Usa como fuente primaria la API del organismo que publica, porque es la que se actualiza primero. Usa FRED solo como respaldo.

| Indicador | Fuente primaria | Series de referencia para validar |
|---|---|---|
| Nómina no agrícola y desempleo EUA | BLS API v2 | CES0000000001, LNS14000000 (FRED: PAYEMS, UNRATE) |
| CPI general y subyacente a/a | BLS API v2, índices sin ajuste estacional | CUUR0000SA0, CUUR0000SA0L1E |
| PPI demanda final a/a | BLS API v2 | WPUFD4 |
| JOLTS vacantes | BLS API v2 | FRED: JTSJOL |
| Costo del empleo (ECI) t/t | BLS API v2 | FRED: ECIALLCIV |
| PIB t/t anualizado y PCE subyacente a/a | BEA API (NIPA) | FRED: A191RL1Q225SBEA, PCEPILFE |
| Balanza comercial y cuenta corriente EUA | BEA API | FRED: BOPGSTB, IEABC |
| Ventas minoristas EUA m/m | Census API (indicadores económicos) | FRED: RSAFS |
| Decisión de la Fed | Comunicado oficial en federalreserve.gov | FRED: DFEDTARU |
| INPC general y subyacente (mensual y 1a quincena), IGAE, actividad industrial, PIB oportuno, PIB, consumo privado, ventas minoristas, desempleo, balanza comercial y confianza del consumidor de México | API del Banco de Información Económica (BIE) de INEGI | Buscar en el BIE |
| Decisión de Banxico y remesas | API del SIE de Banxico; para la decisión, también el comunicado oficial | SIE: SF61745 (tasa objetivo) |
| ISM, IMEF y ADP | Son privados y no están en APIs oficiales | Solo con el modo `tradingeconomics` |

Antes de usar cada serie, busca su identificador exacto en la documentación oficial, sobre todo los de INEGI y Banxico. Verifícala así: el último valor que devuelve la API debe coincidir con el último boletín publicado. Si no coincide, no la uses y avísame.

Para las decisiones de política monetaria, toma la tasa del comunicado oficial publicado ese día. FRED y el SIE pueden reflejar el cambio hasta la fecha en que entra en vigor, así que úsalos solo para confirmar.

Reglas de cálculo:
- **Variaciones a/a:** usa cifras originales, sin ajuste estacional: (índice del periodo / índice del mismo periodo del año anterior − 1) × 100. En las quincenas, compara con la misma quincena del año anterior.
- **Variaciones m/m y t/t:** usa cifras desestacionalizadas.
- **Nómina no agrícola:** cambio mensual en miles = nivel del mes − nivel del mes anterior.
- **Redondeo:** igual que el boletín oficial. CPI, PPI, PCE, PIB de EUA y tasas de desempleo van a 1 decimal; el INPC va a 2 decimales.
- **Primera cifra:** guarda la primera cifra publicada y no la sobrescribas con revisiones posteriores, porque la comparación contra el consenso se hace con el primer dato. Si después hay revisión, muéstrala aparte en texto pequeño.
- **Validación de periodo:** acepta un valor solo si su fecha de observación corresponde al `periodo` del evento. Por ejemplo, el CPI de septiembre debe ser la observación 2026-09. Si la API todavía muestra el mes anterior, sigue esperando.

### Modo `tradingeconomics` (de pago)

Con la llave de la API de Trading Economics, toma del calendario de México y de Estados Unidos los campos `Actual` y `Consensus` de cada evento. Este modo cubre todos los indicadores, incluidos ISM, IMEF y ADP, y también llena el esperado.

Mapea cada fila del dataset a su evento de Trading Economics por país, indicador y periodo de referencia. Guarda ese mapeo en `src/fuentes.js`.

## Fuente del esperado (consenso)

Se elige con la variable `FUENTE_CONSENSO`, que puede valer `tradingeconomics`, `claude` o `ninguna`.

- **`tradingeconomics`:** usa el campo `Consensus`. No lo sustituyas con el pronóstico propio de Trading Economics (`TEForecast`).
- **`claude`:** a las 20:00 del día anterior a cada evento, la Background Function de consenso llama a la Messages API de Anthropic con la herramienta de búsqueda web. Le pide el consenso del mercado para ese indicador y periodo.
  - La respuesta debe ser solo este JSON: `{"valor": número o null, "fuente": "texto", "url": "..."}`. Si no hay un consenso claro, `valor` es `null`.
  - Consulta docs.claude.com para el nombre del modelo vigente y la configuración de la herramienta de búsqueda web.
  - La llave va como variable de entorno secreta en Netlify.
- **`ninguna`:** el esperado queda vacío y la variación muestra "—".

Cada esperado guarda de dónde vino. En la página, un ícono de información junto al valor muestra la fuente al tocarlo.

## Cuándo consultar

- **Eventos con hora:** desde la hora de publicación, consulta cada minuto durante 45 minutos.
- **Si no llegó en ese lapso:** consulta cada 15 minutos hasta las 23:59. Si tampoco llega, márcalo "Retrasado" y reintenta cada hora al día siguiente.
- **Eventos sin hora:** consulta cada 15 minutos de 6:00 a 20:00 de ese día.
- **Al llegar el dato:** cuando un evento ya tiene su dato real, deja de consultarlo.
- **Límites de las APIs:** respeta los límites diarios de cada una. Agrupa en una sola llamada las series del mismo organismo cuando la API lo permita.

## Comportamiento de la página

- **Actualización:** al abrir, pide `/api/datos`.
  - Si hay un evento en su ventana de publicación (de 2 minutos antes a 30 minutos después), vuelve a pedir cada 30 segundos.
  - Fuera de esa ventana, pide cada 10 minutos.
  - Pausa las consultas cuando la pestaña no está visible y actualiza al volver.
- **Dato nuevo:** cuando llega un dato real, la fila se resalta una sola vez y muestra la etiqueta "Nuevo" durante 10 minutos.
- **Notificación:** si el usuario dio permiso, muestra una notificación del navegador con un resumen como "EUA, CPI sep: 3.1% vs 3.0% esperado (+3.3%)".
- **Frescura:** arriba muestra "Actualizado hace X min". Si el servidor no responde, avisa y muestra la hora del último dato bueno.
- **Estados por fila:**
  - "Pendiente": todavía no es su hora.
  - "Esperando dato": dentro de su ventana de publicación.
  - "Publicado": ya tiene dato real.
  - "Retrasado": pasó su ventana sin dato.
- **Corrección manual:** queda solo como respaldo y se usa casi nunca, porque cada cambio implica un deploy. Se hace editando `data/correcciones.json` en GitHub; la función la aplica en su siguiente corrida y marca el valor como "manual". La página nunca escribe datos.
- **Retraso esperado:** entre la publicación oficial y la página debe pasar alrededor de 1 minuto, más lo que tarde la fuente en actualizar su API.

## Columnas, en este orden

1. **Fecha y hora.** Fecha como "jue 8 oct"; hora debajo, en hora del centro de México. Si no hay hora, muestra "—".
2. **País.** Bandera más el nombre: "México" o "EUA".
3. **Indicador.** Nombre más el periodo de referencia en texto secundario, por ejemplo "INPC general anual" y debajo "sep".
4. **Esperado.** Valor más su unidad.
5. **Real.** Valor más su unidad.
6. **Variación %.** Ver reglas abajo.

## Banderas

Dibuja las banderas con SVG inline, de 20×14 px, con un borde sutil. No uses emojis de bandera: Windows los muestra como letras ("MX", "US").

- **México:** tres franjas verticales #006847, #FFFFFF y #CE1126, con un círculo pequeño café al centro como escudo simplificado.
- **EUA:** 13 franjas horizontales #B22234 y #FFFFFF, con un cantón azul #3C3B6E arriba a la izquierda. Las estrellas pueden ser puntos blancos simplificados.

## Cálculo de la variación

La columna `tipo` define el cálculo:

- **`nivel`** (miles, millones de dólares, índices). Variación % = (Real − Esperado) / |Esperado| × 100, con 1 decimal y signo. Ejemplo: esperado 89, real 29 da −67.4%.
- **`pct`** (indicadores que ya son porcentaje: inflación, desempleo, PIB, ventas). Usa la misma Variación %. Debajo, en texto pequeño, muestra la diferencia en puntos porcentuales: Real − Esperado, por ejemplo "+0.10 pp".
- **`tasa`** (decisiones de la Fed y de Banxico). Usa la misma Variación %. Debajo muestra la diferencia en puntos base, por ejemplo "+25 pb".
- **`evento`** (minutas, informes, elecciones). No lleva valores; muestra "—" en las tres columnas numéricas.

Si falta Esperado o Real, o si Esperado = 0, la variación es "—". Usar |Esperado| en el denominador hace que el signo sea correcto cuando el esperado es negativo, como en una balanza comercial deficitaria.

## Color de la variación

La columna `mejor` indica qué dirección es favorable:

- `alto`: un dato real arriba de lo esperado es favorable.
- `bajo`: un dato real abajo de lo esperado es favorable (inflación, desempleo).
- `neutral`: sin juicio (tasas de bancos centrales, costo del empleo).

Reglas de color:

- Favorable va en verde y desfavorable en rojo.
- Neutral va en un tono sin carga, como azul grisáceo.
- Si el dato coincide con lo esperado, va en gris con el texto "En línea".
- Agrega siempre una flecha ▲ o ▼ según si el real quedó arriba o abajo de lo esperado. Así se entiende sin depender solo del color.

## Organización y filtros

- Agrupa las filas por semana con un encabezado, por ejemplo "Semana del 5 al 9 de octubre".
- Dentro de cada día, ordena por hora; las filas sin hora van al final.
- Resalta el día de hoy. Al abrir, desplázate automáticamente al próximo evento pendiente.
- Pon una barra de filtros arriba:
  - País: Todos, México o EUA.
  - Mes: octubre, noviembre o diciembre.
  - Estado: Todos, Pendientes o Publicados.
  - Búsqueda por texto en el indicador.
- Marca con una etiqueta discreta de "Alto impacto" estos indicadores: decisiones de Fed y Banxico, INPC, CPI, nómina no agrícola, desempleo de EUA, PIB y PCE.
- Muestra los feriados como una nota en su fecha:
  - México: 2 nov, 16 nov y 25 dic.
  - EUA: 12 oct, 11 nov, 26 nov y 25 dic.
- Muestra una nota en las semanas del periodo de silencio de la Fed: del 17 al 29 de octubre y del 28 de noviembre al 10 de diciembre.

## Diseño

- El público es un financiero que revisa datos rápido. La prioridad es leer en dos segundos el esperado, el real y la sorpresa.
- La pieza memorable es la columna de variación. Todo lo demás debe ser sobrio.
- Elige una paleta y tipografía propias para este tema. Evita los defaults genéricos: fondo crema con acento terracota, negro con un solo acento neón, o tarjetas idénticas con sombra gris.
- Alinea los números a la derecha con `font-variant-numeric: tabular-nums`.
- Usa mayúsculas solo al inicio de frase. No pongas etiquetas en MAYÚSCULAS.
- En escritorio, muestra una tabla. En celular (menos de 640 px), cada evento es un bloque compacto:
  - línea 1: fecha y hora;
  - línea 2: bandera e indicador;
  - línea 3: esperado, real y variación.
- Soporta modo claro y oscuro según el sistema.
- Debe tener foco visible con teclado y respetar `prefers-reduced-motion`.

## Notas de horario

Todas las horas del dataset ya están en hora del centro de México (UTC−6, sin horario de verano). EUA publica sus datos a las 8:30 ET, que equivale a las 6:30 hasta el 30 de octubre y a las 7:30 desde el 2 de noviembre, porque EUA atrasa su reloj el 1 de noviembre. No conviertas las horas otra vez.

## Dataset

Columnas:

- `fecha`: AAAA-MM-DD.
- `hora`: hora del centro, HH:MM; vacía si no está confirmada.
- `pais`: MX o US.
- `indicador`
- `periodo`
- `unidad`
- `tipo`: `nivel`, `pct`, `tasa` o `evento`.
- `mejor`: `alto`, `bajo` o `neutral`.
- `esperado`: vacío si aún no hay dato.
- `real`: vacío si aún no hay dato.

Unidades: "mmd USD" son miles de millones de dólares y "mdd" son millones de dólares.

Las tres primeras filas (ADP, nómina y desempleo de septiembre) traen esperado y real ya capturados. Úsalas como valores iniciales y como prueba de los cálculos.

```csv
fecha,hora,pais,indicador,periodo,unidad,tipo,mejor,esperado,real
2026-09-30,06:15,US,Empleo privado ADP,sep,miles,nivel,alto,68,90
2026-10-02,06:30,US,Nómina no agrícola,sep,miles,nivel,alto,89,29
2026-10-02,06:30,US,Tasa de desempleo,sep,%,pct,bajo,4.1,4.2
2026-10-05,06:00,MX,Consumo privado,jul,% a/a,pct,alto,,
2026-10-05,08:00,US,ISM servicios,sep,índice,nivel,alto,,
2026-10-06,06:00,MX,Confianza del consumidor,sep,índice,nivel,alto,,
2026-10-06,06:30,US,Balanza comercial,ago,mmd USD,nivel,alto,,
2026-10-07,12:00,US,Minutas del FOMC,reunión 15-16 sep,,evento,neutral,,
2026-10-08,06:00,MX,INPC general anual,sep,% a/a,pct,bajo,,
2026-10-08,06:00,MX,INPC subyacente anual,sep,% a/a,pct,bajo,,
2026-10-08,,MX,Minuta de Banxico,decisión 24 sep,,evento,neutral,,
2026-10-12,06:00,MX,Actividad industrial,ago,% a/a,pct,alto,,
2026-10-14,06:30,US,CPI general anual,sep,% a/a,pct,bajo,,
2026-10-14,06:30,US,CPI subyacente anual,sep,% a/a,pct,bajo,,
2026-10-15,06:30,US,PPI demanda final anual,sep,% a/a,pct,bajo,,
2026-10-15,06:30,US,Ventas minoristas,sep,% m/m,pct,alto,,
2026-10-21,06:00,MX,Ventas minoristas,ago,% a/a,pct,alto,,
2026-10-22,06:00,MX,INPC general anual 1a quincena,oct,% a/a,pct,bajo,,
2026-10-22,06:00,MX,INPC subyacente anual 1a quincena,oct,% a/a,pct,bajo,,
2026-10-22,06:00,MX,Tasa de desempleo,sep,%,pct,bajo,,
2026-10-23,06:00,MX,IGAE,ago,% a/a,pct,alto,,
2026-10-27,06:00,MX,Balanza comercial,sep,mdd,nivel,alto,,
2026-10-28,12:00,US,Decisión de la Fed (límite superior),oct,%,tasa,neutral,,
2026-10-29,06:30,US,PIB (avance),3T,% t/t anualizado,pct,alto,,
2026-10-29,06:30,US,PCE subyacente anual,sep,% a/a,pct,bajo,,
2026-10-30,06:00,MX,PIB oportuno,3T,% a/a,pct,alto,,
2026-10-30,06:30,US,Índice de costo del empleo (ECI),3T,% t/t,pct,neutral,,
2026-10-30,,MX,Finanzas públicas,sep,,evento,neutral,,
2026-11-02,09:00,US,ISM manufacturero,oct,índice,nivel,alto,,
2026-11-02,12:00,MX,IMEF manufacturero,oct,índice,nivel,alto,,
2026-11-03,,US,Elecciones intermedias,,,evento,neutral,,
2026-11-03,,MX,Remesas,sep,mdd,nivel,alto,,
2026-11-03,09:00,US,Vacantes JOLTS,sep,millones,nivel,alto,,
2026-11-04,07:30,US,Balanza comercial,sep,mmd USD,nivel,alto,,
2026-11-04,09:00,US,ISM servicios,oct,índice,nivel,alto,,
2026-11-05,06:00,MX,Consumo privado,ago,% a/a,pct,alto,,
2026-11-05,06:00,MX,Confianza del consumidor,oct,índice,nivel,alto,,
2026-11-05,13:00,MX,Decisión de Banxico (tasa objetivo),nov,%,tasa,neutral,,
2026-11-06,07:30,US,Nómina no agrícola,oct,miles,nivel,alto,,
2026-11-06,07:30,US,Tasa de desempleo,oct,%,pct,bajo,,
2026-11-09,06:00,MX,INPC general anual,oct,% a/a,pct,bajo,,
2026-11-09,06:00,MX,INPC subyacente anual,oct,% a/a,pct,bajo,,
2026-11-10,07:30,US,CPI general anual,oct,% a/a,pct,bajo,,
2026-11-10,07:30,US,CPI subyacente anual,oct,% a/a,pct,bajo,,
2026-11-11,06:00,MX,Actividad industrial,sep,% a/a,pct,alto,,
2026-11-13,07:30,US,PPI demanda final anual,oct,% a/a,pct,bajo,,
2026-11-17,07:30,US,Ventas minoristas,oct,% m/m,pct,alto,,
2026-11-18,13:00,US,Minutas del FOMC,reunión 27-28 oct,,evento,neutral,,
2026-11-19,,MX,Minuta de Banxico,decisión 5 nov,,evento,neutral,,
2026-11-20,06:00,MX,Ventas minoristas,sep,% a/a,pct,alto,,
2026-11-23,06:00,MX,PIB (cifra completa),3T,% a/a,pct,alto,,
2026-11-23,06:00,MX,IGAE,sep,% a/a,pct,alto,,
2026-11-24,06:00,MX,INPC general anual 1a quincena,nov,% a/a,pct,bajo,,
2026-11-24,06:00,MX,INPC subyacente anual 1a quincena,nov,% a/a,pct,bajo,,
2026-11-25,07:30,US,PIB (2a estimación),3T,% t/t anualizado,pct,alto,,
2026-11-25,07:30,US,PCE subyacente anual,oct,% a/a,pct,bajo,,
2026-11-25,13:00,US,Libro Beige,,,evento,neutral,,
2026-11-26,06:00,MX,Tasa de desempleo,oct,%,pct,bajo,,
2026-11-26,,MX,Informe trimestral de Banxico,jul-sep,,evento,neutral,,
2026-11-27,06:00,MX,Balanza comercial,oct,mdd,nivel,alto,,
2026-11-30,,MX,Finanzas públicas,oct,,evento,neutral,,
2026-12-01,09:00,US,ISM manufacturero,nov,índice,nivel,alto,,
2026-12-01,09:00,US,Vacantes JOLTS,oct,millones,nivel,alto,,
2026-12-01,,MX,Remesas,oct,mdd,nivel,alto,,
2026-12-01,12:00,MX,IMEF manufacturero,nov,índice,nivel,alto,,
2026-12-04,06:00,MX,Consumo privado,sep,% a/a,pct,alto,,
2026-12-04,07:30,US,Nómina no agrícola,nov,miles,nivel,alto,,
2026-12-04,07:30,US,Tasa de desempleo,nov,%,pct,bajo,,
2026-12-07,06:00,MX,Confianza del consumidor,nov,índice,nivel,alto,,
2026-12-08,07:30,US,Balanza comercial,oct,mmd USD,nivel,alto,,
2026-12-09,06:00,MX,INPC general anual,nov,% a/a,pct,bajo,,
2026-12-09,06:00,MX,INPC subyacente anual,nov,% a/a,pct,bajo,,
2026-12-09,13:00,US,Decisión de la Fed (límite superior) y proyecciones,dic,%,tasa,neutral,,
2026-12-10,07:30,US,CPI general anual,nov,% a/a,pct,bajo,,
2026-12-10,07:30,US,CPI subyacente anual,nov,% a/a,pct,bajo,,
2026-12-11,06:00,MX,Actividad industrial,oct,% a/a,pct,alto,,
2026-12-15,07:30,US,PPI demanda final anual,nov,% a/a,pct,bajo,,
2026-12-16,07:30,US,Ventas minoristas,nov,% m/m,pct,alto,,
2026-12-17,06:00,MX,Ventas minoristas,oct,% a/a,pct,alto,,
2026-12-17,13:00,MX,Decisión de Banxico (tasa objetivo),dic,%,tasa,neutral,,
2026-12-18,06:00,MX,Oferta y utilización,3T,,evento,neutral,,
2026-12-18,07:30,US,Cuenta corriente,3T,mmd USD,nivel,alto,,
2026-12-23,06:00,MX,INPC general anual 1a quincena,dic,% a/a,pct,bajo,,
2026-12-23,06:00,MX,INPC subyacente anual 1a quincena,dic,% a/a,pct,bajo,,
2026-12-23,06:00,MX,IGAE,oct,% a/a,pct,alto,,
2026-12-23,06:00,MX,Balanza comercial,nov,mdd,nivel,alto,,
2026-12-23,07:30,US,PIB (final),3T,% t/t anualizado,pct,alto,,
2026-12-23,07:30,US,PCE subyacente anual,nov,% a/a,pct,bajo,,
2026-12-24,06:00,MX,Tasa de desempleo,nov,%,pct,bajo,,
2026-12-30,13:00,US,Minutas del FOMC,reunión 8-9 dic,,evento,neutral,,
2026-12-30,,MX,Finanzas públicas,nov,,evento,neutral,,
```

## Entregable y verificación

Entrega el código completo en el repositorio y un `README.md` con pasos exactos y numerados para:
- conectar el repositorio a un sitio nuevo de Netlify;
- obtener cada llave gratuita (BLS, BEA, Census, FRED, INEGI y Banxico) y, si se usan, las de Trading Economics y Anthropic;
- cargar cada llave en Site configuration → Environment variables y marcarla como secreta;
- confirmar en la pestaña Functions del sitio que la función programada aparece con su horario;
- revisar el consumo de créditos del sitio en la sección de uso de la cuenta de Netlify.

Antes de entregar, comprueba lo siguiente:

- **Fuentes oficiales:** invocando la función a mano con datos ya publicados (la nómina y el desempleo de septiembre de EUA, el INPC de agosto de México), obtiene el valor correcto de la fuente oficial.
- **Variación:** la nómina de septiembre da −67.4%, y el desempleo da +2.4% con "+0.10 pp".
- **Periodo:** un evento cuyo periodo aún no se publica queda "Pendiente" y no muestra el dato del mes anterior.
- **Llaves:** no aparecen en el repositorio, en Blobs, en `/api/datos`, en `/api/estado` ni en la página.
- **Sin deploys por datos:** que llegue un dato nuevo no genera ningún deploy ni commit.
- **Tiempo de ejecución:** una corrida sin ventana activa termina en menos de 1 segundo, y una con consultas termina antes de 30 segundos.
- **Dataset y filtros:** aparecen las 91 filas y los filtros funcionan.
- **Costo estimado:** incluye en el README una estimación del consumo mensual de créditos de cómputo con los horarios configurados.
