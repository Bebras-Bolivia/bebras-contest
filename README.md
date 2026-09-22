# bebras-contest

Plataforma del **Desafío Bebras Bolivia**: gestión de tareas, competencias,
grupos, participantes y evaluación.

- `frontend/`: Astro 5 + React 19 + Tailwind + Shadcn/ui
- `backend/`: Express 5 + TypeScript en Cloudflare Workers, Prisma con D1 y
  documentos privados en R2.

Gestor de paquetes: **Bun 1.3.5** (`packageManager`); Node.js **22.12 o posterior**
para el CLI instalado de Wrangler. Hay tres paquetes independientes (raíz,
`backend`, `frontend`), sin workspaces, cada uno con su `bun.lock` versionado.
`bun run setup` instala los tres con `--frozen-lockfile`, también en CI: falla si
un manifiesto no coincide con su lockfile. Para actualizar dependencias, ejecuta
`bun install` en el paquete afectado y versiona juntos manifiesto y lockfile.

## Puesta en marcha

Ejecuta todos los comandos desde la raíz del repositorio:

```bash
bun run setup
bun run env:setup
```

`env:setup` crea `backend/.env` y `frontend/.env` a partir de sus ejemplos sin
sobrescribir archivos existentes. `bun run dev` no depende de esos archivos para
seleccionar Firebase: fuerza Firebase Auth de staging tanto en Astro como en el
Worker local, mientras D1 y R2 permanecen locales. `.dev.vars` es solo un override
opcional para invocar Wrangler directamente y nunca se sube al Worker. Consulta la
[guía de Firebase Authentication](docs/firebase-auth.md).

Prepara Prisma, la base de datos y los datos iniciales:

```bash
bun run db:generate
bun run db:push
bun scripts/cloudflare-credentials.ts local seed
bun run db:tasks
bun run build:local
```

Levanta backend y frontend juntos:

```bash
bun run dev
```

Este comando no admite producción ni bindings remotos. Las identidades de
Firebase se comparten con staging, pero perfiles, roles, colegios, documentos,
concursos y tareas se guardan en D1/R2 locales. Para probar staging completo, usa
su URL desplegada en lugar de mezclar frontend local con servicios remotos.

## Base de datos

La base activa es el binding **DB de D1**. En local Wrangler persiste en
`.wrangler/state/v3`; `backend/dev.db` pertenece al flujo SQLite legado y
`DATABASE_URL` ya no selecciona la base del Worker ni de las semillas adaptadas.
El esquema se aplica con migraciones de `backend/migrations/`, no con Prisma db push.

| Comando                                      | Qué hace                                                                                                                          |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `bun run db:push` | Aplica migraciones D1 locales mediante Wrangler. |
| `bun run db:seed` | Carga colegios; omite si coincide el conteo. Una carga incompleta o `--force` reemplaza el snapshot. |
| `bun run db:tasks` | Valida e inserta solo las tareas faltantes. |
| `bun run db:tasks:replace -- --confirm-replace` | Exporta y verifica un respaldo SQL D1 antes del reemplazo destructivo del catálogo y grafo de concursos. |
| `bun run db:schools:fetch`                   | Vuelve a descargar las unidades educativas del MINEDU y regenera el snapshot. Solo hace falta cuando el listado oficial cambia.   |
| `bun run db:admins` | Crea o restablece los tres admins con `SEED_ADMIN_PASSWORD`; para conservar cuentas existentes usa el bootstrap aditivo. |
| `bun run db:clear-teams -- --confirm-clear-teams` | Borra equipos, intentos, respuestas y resultados después de una confirmación explícita. |

`db:setup` ejecuta migraciones y semillas exclusivamente locales y requiere
`SEED_ADMIN_PASSWORD`. Detalles de semillas,
respaldo y comandos remotos en [la guía D1](docs/cloudflare-bootstrap.md).

Los recortes corregidos del banco se pueden regenerar con
`uv run --with pymupdf python backend/scripts/recrop-task-images.py`.
El script requiere el PDF original en `tareas-otono-2024/_referencia/`, conserva
los identificadores de las imágenes y modifica únicamente la semilla JSON.
`bun run db:tasks` carga las tareas oficiales que falten en D1 local.
Los tres fixtures sintéticos están reservados a pruebas (`BEBRAS_E2E=1`) y
requieren una configuración D1 aislada explícita.
El reemplazo explícito conserva intactos colegios, usuarios y solicitudes de
maestros. El respaldo verificado queda en `.wrangler/backup-*/database.sql`;
también se puede indicar otra ubicación con
`--backup <ruta>`. Detén el backend antes de ejecutarlo.

## Autoría de arrastre

En **Editar posiciones**, agrega todos los destinos permitidos y ajusta su
posición y radio. **Agregar pieza** y **Agregar destino** son independientes:
puede haber más destinos que piezas.

En **Definir solución**, coloca las piezas en la solución principal y usa
**Otra solución** para registrar otros acomodos correctos. Puedes arrastrar,
usar el teclado o elegir el destino de cada pieza en su selector. Cada pieza
debe quedar colocada y cada destino admite una sola pieza; los demás pueden
quedar vacíos. Si quitas un destino utilizado, repara las soluciones indicadas
antes de guardar.

Para piezas intercambiables, escribe el mismo grupo en **Piezas equivalentes**
(por ejemplo, `B`), incluso si sus imágenes provienen de archivos distintos.
Sin grupo explícito se conserva la equivalencia histórica por imagen.

La bandeja de objetos conserva el hueco de cada pieza aunque esté colocada, así
que su lugar de partida no se mueve. El hueco va vacío, con marco punteado: solo
indica que ahí había algo, sin delatar cuál, porque las piezas se intercambian
entre sí. Tocarlo devuelve la pieza que salió de ahí; con una pieza
seleccionada, cualquier hueco la reclama para sí. Arrastrar una pieza fuera de
la imagen también la devuelve a la bandeja, al lugar donde se suelte; soltarla
dentro pero lejos de un destino la deja donde estaba.

El estudiante acomoda la fila a su gusto: arrastrar una pieza sobre el lugar de
otra intercambia sus posiciones. Tocar otra pieza solo mueve la selección, para
no perder el gesto de elegir. El orden es solo visual: la respuesta viaja como
`{ pieza: destino }` y no depende de la bandeja. Las instrucciones de
arrastre ya no ocupan el enunciado: viven en el «?» que está sobre la bandeja.

La semilla incluye las tareas 14 y 34. La segunda ruta ilustrada para la 14
en la guía termina fuera del tablero; solo se acepta el recorrido que llega a
la meta, incluyendo el intercambio de sus dos flechas iguales.

## Fin del intento

El equipo llega a la pantalla final por dos caminos y tiene que distinguirlos.
Si entrega, ve «¡Desafío terminado!»; si se le acaba el plazo, ve «Se acabó el
tiempo» y el aviso de que sus respuestas se entregaron tal como estaban. El
servidor marca la diferencia con `finishedAt`, que al cerrar por plazo queda
igual a `endsAt`, así que el mensaje sobrevive a recargar la página.

El plazo del equipo es `min(inicio + duración, cierre de la rendición)`: cuando
termina la ventana del desafío no queda ningún intento abierto. Puntaje,
correcciones y soluciones solo aparecen si los resultados están publicados y el
desafío los habilita, cada uno por su cuenta.

## Contrato de respuestas y probador

El probador, el concurso y la práctica comparten `TaskPlayContent` y
`PlayTaskFields`. El probador de tareas guardadas usa los endpoints exclusivos
de administradores `GET /api/tasks/:id/preview` y `POST /api/tasks/:id/check`
(cuerpo `{ "payload": ... }`). La comprobación devuelve `correct` y
`explanationBlocks`; las tareas privadas no se habilitan en la práctica pública.
Cambiar o reiniciar una respuesta descarta su resultado y cualquier comprobación
pendiente.

«Probar» desde el editor prueba lo que hay en pantalla, guardado o no: el
borrador viaja por `sessionStorage` y se corrige con `POST
/api/tasks/draft/preview` y `POST /api/tasks/draft/check` (cuerpo
`{ "task": ..., "payload": ... }`), que reciben la tarea entera y no tocan la
base. Si al borrador le falta algo obligatorio, el probador muestra el mismo
mensaje que daría al guardar. El probador vuelve al editor con «Volver a la
edición».

La configuración, validación, presencia de respuesta, corrección y proyección
pública están en `backend/src/lib/task-answers/`. Para incorporar una familia,
ampliar esos módulos y el reproductor compartido. Las zonas activas usan
configuración y solución versionadas, descritas abajo. En `answerConfig`, la opción
múltiple guarda `multipleChoiceLayout` (`vertical` u `horizontal`, la única
clave que acepta) para elegir si las opciones se ven una debajo de otra o una al
lado de otra; texto y arrastre siguen con `{}` y sus campos históricos. Las
opciones con imagen se achican y agrandan con los mismos tiradores que los
bloques de contenido (`ImageWidthResizer`). Cada familia nueva debe
validar su versión y proyectar explícitamente su configuración pública; nunca
enviar `answerKey` al estudiante. Las reglas de presencia del cliente y del
servidor se verifican con los mismos casos en las pruebas unitarias.

Para actualizar D1, respaldar la base y ejecutar desde la raíz `bun run db:generate`
y `bun x --no-install wrangler d1 migrations apply DB --local` (remoto: seleccionar
`--env staging|production --remote`). El parche
`backend/prisma/patches/20260906-task-answer-contract.sql` es una referencia del
flujo SQLite legado, no una alternativa al historial de migraciones D1.

## Zonas sobre la imagen: tareas 04 y 11

Elige **Zonas sobre la imagen** en el tipo de respuesta. Sube la figura y usa
**Añadir punto** o **Dibujar camino**. Todo se ajusta sobre la misma imagen:
arrastra los centros o vértices, o usa las flechas del teclado. Cierra el camino
tocando su primer vértice o con **Cerrar camino**. Al seleccionar una zona,
puedes cambiar su nombre y marcar **Respuesta válida**. **Otro tramo** añade
otra superficie al mismo camino. El editor avisa si dos zonas se superponen y
no permite guardar una configuración ambigua.

El estudiante toca la figura o usa Tab y Enter/Espacio. Una selección sustituye
la anterior y **Borrar** la quita. Las tareas 04 y 11 están en la semilla y en
la base local: cuatro caminos en 04 (B correcto) y nueve puntos en 11 (punta de
la vela y centro superior del casco correctos). El centro compartido del bosque
no pertenece a ningún camino seleccionable.

`image_hotspot` guarda `{ version: 1, image, imageWidth, imageHeight, regions }`
en `answerConfig`; cada región tiene `id`, `label` y `shapes` (círculos o
polígonos). Las posiciones son porcentajes de la imagen; el radio se mide contra
su lado menor. `answerKey` contiene `{ version: 1, acceptedRegionIds }` y nunca
se envía al estudiante. La respuesta es `{ version: 1, regionId }`, con `null`
al borrar. Se validan versiones, geometría, colisiones, IDs y solución antes de
guardar. Las funciones geométricas de cliente y servidor tienen pruebas comunes.

Las versiones finales de estas dos tareas se mantienen en el JSON canónico;
no se regeneran desde el PDF. El flujo de actualización se describe abajo.

## Estados por casilla y huecos en el texto: tareas 09, 19, 31, 37 y 40

Dos tipos que comparten el mismo gesto: un banco de opciones arriba y posiciones
que llenar abajo. Elige una opción y toca la posición, o arrástrala hasta ella.
Con el teclado, las flechas cambian la opción de la posición enfocada y Supr la
vacía; cada cambio se anuncia para lectores de pantalla. **Borrar** deja la
selección vacía, y desde ahí tocar una posición la desocupa.

**Estados por casilla** (`state_grid`) arma una rejilla de hasta 12 filas por 12
columnas. Se define el rótulo de cada casilla y los estados disponibles, con
imagen si hace falta. Sirve para construir una configuración final, como las
tres canicas de la 09 o las ocho pelotas de la 31. Una casilla vacía no es un
estado: si «blanca» es una respuesta posible, tiene que existir como estado.

**Huecos en el texto** (`text_cloze`) mete la respuesta dentro del enunciado.
En la barra del editor de texto, **Insertar hueco** deja un nodo con su propio
identificador: copiarlo crea uno nuevo, moverlo conserva el suyo y deshacer lo
restaura. Los botones de sangría mantienen la forma del pseudocódigo de la 40
sin guardarlo como imagen. Cada hueco elige qué opciones del banco acepta, así
la 37 y la 40 conservan sus dos grupos separados.

En ambos, la casilla de cantidad limita cuántas veces se usa una opción (vacía
es ilimitada) y se admiten varias soluciones completas: **Respuesta correcta**
y las **Alternativas** que se agreguen. Solo una configuración completa puntúa;
una a medias se guarda y se recupera, pero cuenta como incorrecta.

`answerConfig` guarda `{ version: 1, rows, columns, cells, states }` o
`{ version: 1, options, blanks }`; `answerKey`, `{ version: 1,
acceptedAssignments }` con cada solución completa. La respuesta del estudiante
es `{ version: 1, cells: { casilla: estado } }` o
`{ version: 1, blanks: { hueco: opción } }`, y un objeto vacío la borra. El
documento del enunciado es la única fuente de la posición de un hueco:
`answerConfig` no guarda una segunda copia del texto y el nodo nunca lleva la
solución. Se validan versión, identificadores, opciones permitidas, inventario
y soluciones repetidas antes de guardar. `answerKey` no sale en la proyección
pública.

La 19 usa huecos sobre su mismo identificador, nunca una variante adicional.

## Catálogo canónico

La fuente final es `backend/prisma/seed/bebras-tasks.json`: exactamente 43 tareas
en orden de cuadernillo, todas habilitadas para práctica. Las siete conversiones
manuales son 04/11 `image_hotspot`, 09/31 `state_grid` y 19/37/40 `text_cloze`.
Las 14/34 siguen siendo de arrastre. El validador rechaza IDs alternativos,
tareas adicionales, tipos incorrectos y cualquier tarea en cuarentena.

Se retiraron `seed-hotspot-tasks.py` y `seed-assignment-tasks.py`: sus plantillas
anteriores añadían IDs no canónicos y reemplazaban tareas enteras, perdiendo
metadatos, explicaciones e imágenes de solución revisadas. Mantener otra copia
de la autoría en Python no aporta una regeneración segura.

1. Edita el JSON canónico conservando IDs, metadatos verificados, explicaciones y
   las 25 imágenes de solución. Las imágenes van embebidas como
   `data:image/png;base64,...`, también en `answerConfig`; no dependen de rutas
   locales ni del PDF privado. Revisa visualmente cualquier imagen nueva.
2. Desde `backend/`, ejecuta `bun run catalog:validate` para validar la semilla,
   o `bun run catalog:validate -- <ruta-json>` para revisar una candidata sin
   escribir archivos ni conectar a la base. Ejecuta `bun run test:catalog`.
3. Desde la raíz, `bun run db:tasks` valida e inserta solo IDs faltantes. No
   actualiza tareas existentes ni elimina variantes antiguas o ediciones locales.
4. Solo si quieres descartar esos datos, detén el backend y ejecuta explícitamente
   `bun run db:tasks:replace -- --confirm-replace`, opcionalmente con
   `--backup <ruta-nueva.sql>`. Crea un export SQL D1 verificado antes del reemplazo;
   no sobrescribe respaldos existentes. Borra tareas y el grafo de concursos
   (incluidas respuestas y resultados), conservando colegios, usuarios y
   solicitudes. No es el flujo habitual de edición.

`catalog:migrate <legacy-json> <current-json> <output-json>` conserva el contrato
histórico de argumentos. Si el catálogo actual tiene 43 tareas, lo valida y
copia íntegro, sin reconstruir ninguna tarea `non-master` ni sustituir imágenes
con las del legado. El archivo legado debe ser JSON legible, pero su contenido
no se usa en ese caso. Un catálogo final inválido falla antes de escribir: no
hay recuperación silenciosa mediante placeholders. La importación antigua de
21 tareas no basta para publicar el catálogo final sin las siete autorías
interactivas. `--check` nunca escribe el archivo de salida.

## Pruebas

### E2E sobre Worker/D1 local

```bash
bun run test:e2e
```

`tests/run-e2e.ts` prepara migraciones y semillas en un D1 temporal bajo
`tests/.wrangler`, levanta el Worker en el puerto 3100 y limpia el estado al
terminar. `tests/wrangler.e2e.jsonc` mantiene aislados los bindings E2E; las
pruebas no abren archivos SQLite directamente.

### Por módulo

La suite completa tarda unos diez minutos, así que está partida en módulos y se
corre solo el que se está tocando:

```bash
bun run test:e2e:tareas     # autoría, probador, arrastre, zonas de imagen
bun run test:e2e:desafios   # ciclo de vida, puntajes, publicación de resultados
bun run test:e2e:grupos     # grupos, inscripción y entrada del estudiante
bun run test:e2e:juego      # rendición: empezar, responder, entregar, cierre
bun run test:e2e:practica   # prácticas del maestro y su reproductor
bun run test:e2e:cuentas    # registro y acceso
bun run test:e2e:interfaz   # navegación y tarjetas responsivas
```

Cada archivo de `tests/` pertenece a un módulo, declarado en
`playwright.config.ts`. **Al agregar un archivo nuevo hay que listarlo ahí**, o
no lo corre ningún proyecto.

### Modo rápido

```bash
bun run test:e2e:servidores            # en otra terminal, se quedan arriba
bun run test:e2e:rapido -- --project=juego
```

`test:e2e:servidores` prepara el D1 aislado y deja levantados Firebase Auth
Emulator, Wrangler y Astro en los puertos 9099, 3100 y 4421. El modo rápido
conserva la base sembrada entre corridas y aprovecha esos servidores; el reloj de
pruebas sí se borra siempre, porque una hora vieja rompe cualquier ventana de
desafío. Con los servidores arriba, un módulo baja de unos 40 s a unos 25 s.

La lógica del contrato, la geometría de las zonas, los huecos del documento y
las asignaciones se comprueban sin navegador:

```bash
bun run test:unidad
```

El comando incluye las reglas unitarias del frontend, pero no
`scripts/cloudflare-seed.test.ts`; las pruebas D1 tienen su comando explícito en
la guía de bootstrap.

## Operación Cloudflare

| Entorno | Rama local | Build | Flags de registro (build / runtime) |
| --- | --- | --- | --- |
| Local | `develop` | `bun run build:local` | `PUBLIC_REGISTRATION_ONLY=false` / `REGISTRATION_ONLY=false` |
| Staging | `staging` | `bun run build:staging` | `false` / `false` |
| Producción | `master` | `bun run build:production` | `true` / `true` |

Todos los builds fijan `PUBLIC_API_BASE_URL=""` (API en el mismo origen). El flag
`PUBLIC_REGISTRATION_ONLY` se incorpora al build; cambiar sólo la variable runtime
no reconstruye los assets. Preparar y empaquetar cada entorno consecutivamente,
porque comparten `frontend/dist`:

```bash
bun run build:staging
bun x --no-install wrangler deploy --env staging --dry-run
bun run build:production
bun x --no-install wrangler deploy --env production --dry-run
```

Con los recursos remotos provisionados, `bun run deploy:staging` y
`bun run deploy:production` aplican las migraciones D1 pendientes, verifican el
historial, reconstruyen el modo correcto y despliegan con su `--env`. Antes de la
primera escritura exigen un worktree limpio y la rama exacta: `staging` para
staging y `master` para producción. También se pueden ejecutar por separado para
diagnóstico desde esas mismas ramas:

```bash
bun run db:migrations:apply:staging
bun run db:migrations:check:staging
bun run db:bootstrap:staging
bun run db:migrations:apply:production
bun run db:migrations:check:production
bun run db:bootstrap:production
```

`SEED_ADMIN_PASSWORD` es obligatorio en el entorno del script; véase su entrada
privada en la [guía](docs/cloudflare-bootstrap.md#bootstrap-de-admins-y-colegios).
La autenticación no usa secretos propios: `FIREBASE_PROJECT_ID` es una `var`
pública de `wrangler.jsonc` y los ID Token se verifican contra las claves públicas
de Google, sin Service Account. `.dev.vars` sólo sirve en local
([documentación de secretos](https://developers.cloudflare.com/workers/configuration/secrets/)).

### Configuración reproducible de Workers Builds

Usa la raíz del repositorio (`/`) como **Root directory**. La instalación
automática del paquete raíz no instala `backend` ni `frontend`:

| Worker / rama | Build command | Deploy command |
| --- | --- | --- |
| Staging / `staging` | `bun run setup && bun run db:migrations:apply:staging && bun run db:migrations:check:staging && bun run build:staging` | `bun x --no-install wrangler deploy --env staging` |
| Producción / `master` | `bun run setup && bun run db:migrations:apply:production && bun run db:migrations:check:production && bun run build:production` | `bun x --no-install wrangler deploy --env production` |

Opcionalmente fija `BUN_VERSION=1.3.5`, `NODE_VERSION=22` y
`SKIP_DEPENDENCY_INSTALL=1` si se necesita aislar el build de cambios en la imagen
predeterminada de Cloudflare. Los tres lockfiles deben estar en el checkout. El
build genera Prisma antes de Astro y fija sus variables públicas por entorno; no
necesita archivos `.env` personales.
El build aplica únicamente las migraciones versionadas que todavía estén
pendientes y luego comprueba el historial. Wrangler crea un backup y revierte la
migración que falle; el Worker no se construye ni despliega en ese caso. Los seeds
y el bootstrap siguen siendo operaciones separadas. Los secretos runtime no se
guardan en el repositorio. La conexión GitHub y los ajustes remotos de Builds son
independientes de estos comandos locales.

Referencia: [configuración de Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/).

### Estado (2026-09-12)

- Las ramas `develop`, `staging` y `master` comparten la configuración versionada;
  el entorno de despliegue determina las funcionalidades habilitadas.
- **Workers Builds**: producción y staging están conectados a GitHub y despliegan
  automáticamente desde `master` y `staging`, respectivamente. Configuración y
  verificación en [Workers Builds](docs/workers-builds.md).
- **Desplegados**: [producción](https://bebras-contest.bebrasbolivia.workers.dev) y
  [staging](https://bebras-contest-staging.bebrasbolivia.workers.dev), con bases D1 y
  buckets R2 Standard privados separados. Ambas bases tienen 3 administradores,
  16.099 colegios, 0 maestros y 0 tareas al finalizar el bootstrap.
- Credenciales iniciales en `.wrangler/credentials/production.json` y
  `.wrangler/credentials/staging.json`, excluidas de Git. `SEED_ADMIN_PASSWORD`
  corresponde a los tres admins (`marko@bebras.bo`, `steven@bebras.bo`, `vladimir@bebras.bo`).
  El bootstrap es aditivo y no restablece contraseñas existentes.
  Desde otro equipo, recuperar esas credenciales mediante un respaldo privado;
  no subirlas al Worker ni al repositorio. Los comandos normales de build/deploy
  no necesitan los archivos privados locales.
- La autenticación actual usa Firebase ID Tokens. Se retiraron la comprobación
  remota y el smoke que dependían de `/api/auth/login` y JWT propios, porque ya no
  representaban el sistema desplegado.
- `PasswordService` y su binding Durable Object se retiraron al dejar de existir
  consumidores después de migrar la autenticación. `wrangler.jsonc` conserva el
  historial de creación y añade la migración de borrado de la clase.
- Runtime: Prisma usa `@prisma/adapter-d1` y los PDF usan `pdf-lib`. Se retiraron
  `@prisma/adapter-better-sqlite3`, `better-sqlite3`, `pdfkit` y `@types/pdfkit`
  mediante `bun remove`.
  El lockfile activo es `backend/bun.lock`; `backend/package-lock.json` es legado.
