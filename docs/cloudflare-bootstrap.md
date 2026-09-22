# Herramientas locales y bootstrap D1

Ejecutar desde raíz con las dependencias instaladas. El **bootstrap esencial** (`scripts/cloudflare-seed.ts`) requiere `--target local|staging|production`. Sólo este flujo aditivo de admins y colegios admite remoto. Las herramientas de tareas, reset de admins, reemplazo de colegios y limpieza requieren `--target local`. Local usa `getPlatformProxy` del Wrangler instalado, con `remoteBindings: false`, y el binding **DB** de Miniflare/workerd. No usan el cliente Prisma del Worker, `DATABASE_URL` ni better-sqlite3.

`bun run setup` instala con lockfile congelado los tres paquetes independientes
(raíz, backend y frontend); consulta [Workers Builds](../README.md#configuración-reproducible-de-workers-builds)
para los comandos CI. Los temporales de pruebas usan `os.tmpdir()` y directorios
únicos; no requieren carpetas del editor ni rutas de un usuario específico.

## Esquema y estado compartido

`backend/migrations/0001_initial.sql` es el baseline para una D1 vacía. Las
migraciones aplicadas quedan registradas por Wrangler y se pueden reejecutar sin
recrear tablas. Una base preexistente con tablas y sin historial de migraciones
requiere reconciliar su esquema/historial antes de aplicar el baseline; no se
resuelve borrando la base. Los builds aplican las migraciones versionadas
pendientes antes de desplegar, pero nunca ejecutan semillas.

La configuración `wrangler.jsonc` ya está disponible. Aplicar sus migraciones D1 antes de las semillas:

```powershell
bun x --no-install wrangler d1 migrations apply DB --local --config wrangler.jsonc
```

Los ejemplos usan el `wrangler.jsonc` existente en raíz. `--config` se resuelve desde la raíz del repositorio, incluso al invocar un script desde backend. Sin ese argumento se usa esa configuración raíz. El proxy recibe una ruta absoluta `<directorio-config>/.wrangler/state/v3`, compartida con `wrangler dev` y `wrangler d1 export --local`. Si root agrega soporte de `--persist-to`, debe pasar al proxy la misma ruta **con `/v3` añadido**. Las pruebas usan configuraciones y estado aislados.

## Bootstrap de admins y colegios

```powershell
$env:SEED_ADMIN_PASSWORD = Read-Host 'Contraseña inicial de admins' -MaskInput
try {
  bun scripts/cloudflare-seed.ts --target local --check
  bun scripts/cloudflare-seed.ts --target local
} finally {
  Remove-Item Env:SEED_ADMIN_PASSWORD
}
```

Inserta Marko, Steven y Vladimir, y el snapshot `backend/prisma/seed/schools.ndjson.gz`. Conserva por completo usuarios/colegios existentes, incluso roles y contraseñas. La contraseña es obligatoria sin valor predeterminado y se convierte con el **bcryptjs actual, coste 10**, fuera del Worker. No se imprime el secreto. Esos hashes se conservan para el bootstrap y la migración de cuentas; el login actual usa Firebase Authentication.

El entorno local de `wrangler.jsonc` usa Firebase staging y `bun run dev` lo
fuerza también por CLI; `.dev.vars` solo sirve como override al invocar Wrangler
directamente (ver [Firebase Authentication](./firebase-auth.md)).
`bun scripts/cloudflare-credentials.ts local prepare` genera credenciales aleatorias
sin sobrescribir archivos existentes; `local seed` reutiliza la contraseña guardada
para el bootstrap. El helper resuelve las rutas desde el
repositorio, verifica exclusión Git y protege archivos/directorios con permisos
POSIX o ACL Windows. `.wrangler/` está excluido por el `.gitignore` versionado.
`SEED_ADMIN_PASSWORD` se inyecta al proceso de bootstrap como en el ejemplo y no
es un secreto de runtime del Worker.

Con los IDs remotos configurados y el secreto inyectado, los comandos del operador son:

```powershell
bun scripts/cloudflare-seed.ts --target staging --check
bun scripts/cloudflare-seed.ts --target staging
bun scripts/cloudflare-seed.ts --target production --check
bun scripts/cloudflare-seed.ts --target production
```

El bootstrap remoto ejecuta exclusivamente `wrangler d1 execute DB --env staging|production --remote --file ...`, usando el CLI instalado y `--config` explícito. Serializa únicamente INSERT aditivos de `User`/`School`, escapa literales y valida el límite de 100 KB antes de crear temporales. Los SQL temporales se crean en `.wrangler/seed-*`, con modo `0600` y directorio `0700` en POSIX, o ACL privada en Windows; la ruta debe estar ignorada por Git. Se eliminan al finalizar, también si falla un lote. Una terminación forzada puede dejar restos privados para limpiar. La contraseña se excluye del entorno del proceso hijo, no se pasa como argumento, y la salida/logs de Wrangler se suprimen para no exponer SQL o hashes. Estas operaciones remotas no forman parte de las pruebas de integración.

Las fechas siguen `@prisma/adapter-d1`: `YYYY-MM-DDTHH:mm:ss.sss+00:00`. Local usa parámetros y lotes D1 de 50; remoto usa archivos con hasta 250 sentencias y conflictos dirigidos por clave. El bootstrap completo no promete atomicidad entre lotes y permite reintentos. `--check` valida entradas y límites sin abrir D1 ni comprobar el esquema, también para staging/production.

## Las 43 tareas completas

```powershell
bun scripts/cloudflare-seed-tasks.ts --target local --check
bun scripts/cloudflare-seed-tasks.ts --target local
```

Carga las 43 tareas conservando las existentes por ID. Las imágenes se envían como parámetros de `DB.prepare(sql).bind(...params)` y no cuentan para el límite de **100.000 bytes de SQL**. El catálogo actual tiene 32 filas de más de 100 KB, pero el SQL preparado máximo es de **415 bytes**; la fila máxima estimada ocupa **470.859 bytes**, incluyendo margen de cabecera SQLite, muy por debajo de **2.000.000 bytes por fila/valor**. Se comprueban todas las filas antes de escribir. Ya no existe `--skip-oversized`: no se necesita omitir tareas ni externalizar imágenes para este catálogo.

## Herramientas adaptadas

Todas aceptan `--target local --config wrangler.jsonc` y `--check`:

| Entrada | Comportamiento |
| --- | --- |
| `backend/prisma/seed-tasks.ts` | Alias del catálogo completo, conserva tareas existentes. |
| `backend/prisma/seed.ts` | Colegios: conserva el comportamiento anterior de omitir si coincide el conteo; carga incompleta o `--force` reemplaza el snapshot en un único batch atómico. |
| `backend/scripts/seed-admins.ts` | Reset explícito: actualiza nombre, hash y rol de los tres admins; conserva estado y fecha de creación existentes. Contraseña obligatoria, no se imprime. |
| `backend/scripts/clear-teams.ts` | Elimina respuestas, resultados, intentos y equipos en un único batch atómico. |
| `backend/prisma/seed-test-tasks.ts` | Conserva las tres fixtures/upserts; exige además `BEBRAS_E2E=1`. |
| `backend/prisma/replace-tasks.ts` | Reemplazo destructivo local con exportación de respaldo verificado y `--confirm-replace`. |

`migrate-catalog.ts`, `fetch-schools.ts` y herramientas de transformación de archivos siguen operando sobre archivos.

## Reemplazo local del catálogo con respaldo

Detener los escritores locales mientras se exporta y reemplaza, para que el respaldo corresponda al estado sustituido:

```powershell
bun backend/prisma/replace-tasks.ts --target local --confirm-replace --check
bun backend/prisma/replace-tasks.ts --target local --confirm-replace
# Ruta personalizada: el directorio debe existir y el destino estar ignorado por Git.
bun backend/prisma/replace-tasks.ts --target local --confirm-replace --backup .wrangler/catalog-before.sql
```

El flujo valida las 43 filas, ejecuta **`wrangler d1 export DB --local --output ...`** y conserva el dump completo (esquema y datos). La ruta por defecto es `.wrangler/backup-*/database.sql`, privada e ignorada. `--backup` se resuelve desde el directorio de invocación y nunca sobrescribe un archivo existente.

Antes de borrar, restaura ese archivo en D1 efímero, parametrizando los INSERT grandes mediante `scripts/cloudflare-d1-restore.ts`; comprueba `PRAGMA quick_check`, `foreign_key_check` y compara esquema, todas las filas y secuencias AUTOINCREMENT contra la fuente. `quick_check` es el control de integridad permitido por D1. Una exportación o verificación fallida bloquea el reemplazo. Los dumps ya exportados se conservan ante fallos posteriores; un archivo parcial de exportación fallida se elimina.

Después verifica el esquema vigente (incluido el retiro de `ContestGroup.scheduledAt`) y que la fuente siga coincidiendo con el respaldo. Un único batch D1 elimina resultados, respuestas, intentos, equipos, grupos, relaciones de tareas, concursos y catálogo anterior, e inserta exactamente las 43 tareas completas con parámetros. Aserciones dentro del batch comprueban IDs, conteos y referencias; guardas transaccionales impiden alterar `School`, `User` o `TeacherSchool`, incluso por triggers/cascadas. Cualquier fallo revierte el batch completo. `--check` no exporta ni abre la base.

## Estado de aliases y pruebas legadas

- `db:push`/`prisma:push` aplican migraciones D1 locales. `db:setup` genera Prisma, aplica migraciones y ejecuta bootstrap y catálogo con `--target local` explícito.
- Los aliases `db:seed`, `db:tasks`, `db:admins` y `db:clear-teams` fijan `--target local --config wrangler.jsonc`; `DATABASE_URL` ya no selecciona la base. El reset de admins es distinto del bootstrap idempotente.
- `db:tasks:replace` vuelve a estar operativo sobre D1 local; el alias pasa target/config explícitos y el usuario debe conservar `--confirm-replace`. Los respaldos ahora son exports SQL D1, no archivos SQLite de `VACUUM INTO`.
- `bun run test:cloudflare:d1` incluye semillas y reemplazo. La auditoría retiró `@prisma/adapter-better-sqlite3`, `better-sqlite3`, `pdfkit` y sus tipos con `bun remove`; no hay un runtime SQLite alternativo al Worker/D1.
- `tests/run-e2e.ts` prepara un D1 temporal y aislado en `tests/.wrangler` con `tests/wrangler.e2e.jsonc`. Las suites no abren archivos SQLite directamente.

## Pruebas

La suite específica de semillas y reemplazo se ejecuta con:

```powershell
bun run test:cloudflare:d1
```

La última revisión de reproducibilidad registró **20 pruebas aprobadas, 1 omitida
y 0 fallidas**. La omitida requiere `BEBRAS_LEGACY_JSON`, un archivo legado
opcional. Este resultado no valida servicios remotos ni la autenticación Firebase.

Las pruebas D1 se ejecutan siempre con workerd local y configuración temporal: insertan y leen las 43 tareas comparando todos los campos, repiten la carga, verifican preservación de contraseña/rol/fecha/colegio, texto con intento de inyección, conflictos no ignorados y rollback de limpieza ante una FK. También cargan el snapshot completo de colegios y comprueban la omisión por conteo y `--force`. El reemplazo prueba exportación real, restauración del catálogo grande, conservación del backup, esquema antiguo, grafo vacío e identidades conservadas, y rollback ante constraints/triggers. Los targets remotos se prueban con un ejecutor simulado: argumentos, escape, limpieza ante errores y ausencia de ejecución con `--check`.

Referencias: [getPlatformProxy y persistencia](https://developers.cloudflare.com/workers/wrangler/api/#getplatformproxy), [límites D1](https://developers.cloudflare.com/d1/platform/limits/), [import/export](https://developers.cloudflare.com/d1/best-practices/import-export-data/), [PRAGMA soportados](https://developers.cloudflare.com/d1/sql-api/sql-statements/).
