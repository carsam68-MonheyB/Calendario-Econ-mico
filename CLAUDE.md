# Calendario económico México–EUA

La especificación completa está en `docs/especificacion.md`.

## Reglas
- Trabaja en una rama aparte y abre un PR. `main` es producción: cada merge dispara un deploy a producción que cuesta 15 créditos de Netlify. Avisa al usuario antes de cada merge a `main`.
- Los datos no se guardan en el repositorio. El dato real llega por la función programada y se guarda en Netlify Blobs. Nunca hagas commit de datos.
- Las llaves de API solo viven en variables de entorno. Nunca van en el código, en Blobs, en `/api/datos`, en `/api/estado` ni en la página.
- No inventes datos. Un valor real solo se muestra si lo devolvió una fuente y corresponde al periodo del evento.
- La interfaz va en español y los números en formato es-MX.
- Cuando el usuario tenga que configurar algo, dale pasos exactos y numerados, con la ruta de cada pantalla. Responde breve.

## Comandos
- `npm test`: pruebas.
- `npm run typecheck`: revisión de tipos.
- `netlify dev` y `netlify functions:invoke actualizar`: pruebas locales de las funciones. Las funciones programadas no corren en los deploy previews.
