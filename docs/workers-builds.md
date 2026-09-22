# Workers Builds

Repositorio: `Bebras-Bolivia/bebras-contest`. La aplicación GitHub **Cloudflare
Workers and Pages** ya está instalada en la organización con acceso al repositorio.

En cada Worker, abrir **Settings → Builds → Connect** y configurar:

| Ajuste | Producción | Staging |
| --- | --- | --- |
| Worker | `bebras-contest` | `bebras-contest-staging` |
| Rama de producción del build | `master` | `staging` |
| Directorio raíz | `/` | `/` |
| Build command | `bun run setup && bun run db:migrations:apply:production && bun run db:migrations:check:production && bun run build:production` | `bun run setup && bun run db:migrations:apply:staging && bun run db:migrations:check:staging && bun run build:staging` |
| Deploy command | `bunx wrangler deploy --env production` | `bunx wrangler deploy --env staging` |
| Non-production branch builds | Deshabilitado | Deshabilitado |

Variables opcionales para fijar explícitamente las versiones del entorno de build:

```text
BUN_VERSION=1.3.5
NODE_VERSION=22
SKIP_DEPENDENCY_INSTALL=1
```

Los builds comprobados también funcionan sin estas variables usando los valores
actuales por defecto de Cloudflare. `setup` instala los tres paquetes con sus
lockfiles congelados. Wrangler aplica las migraciones pendientes y guarda un
backup; luego el gate ejecuta un `SELECT` sobre `d1_migrations`, compara el
resultado con los archivos locales y bloquea el despliegue si la aplicación falló
o existe un historial divergente. Después el build genera Prisma
para workerd, compila Astro y aplica el recorte sólo a producción. Si
Workers Builds comunica una rama distinta a la esperada o el checkout no está
limpio, falla antes de aplicar migraciones.
`develop` no debe estar conectado a ningún build.

Cloudflare proporciona el token de despliegue elegido en el Dashboard. La
autenticación pasó a Firebase y no requiere secrets de runtime: `FIREBASE_PROJECT_ID`
es una `var` de `wrangler.jsonc` y la configuración Web (`PUBLIC_FIREBASE_*`) la
inyecta `scripts/cloudflare-build.ts` según el entorno. Estos comandos no cargan
tareas, no ejecutan seeds y no borran/recrean D1 ni R2. Los cambios de esquema se
aplican explícitamente con las migraciones versionadas, primero en local.

## Estado: conexión comprobada

Ambos Workers despliegan solos desde GitHub. La conexión se hizo desde el
Dashboard (la autorización de la cuenta de Git no tiene API) y sus triggers se
ajustaron por API, porque **los valores que crea el Dashboard no sirven para este
repositorio**. Los comandos de la tabla siguiente son la configuración versionada;
cualquier cambio requiere volver a ejecutar el script de sincronización.

| | Producción | Staging |
| --- | --- | --- |
| Trigger | `ccea49e5-0176-4f63-b2bf-4d15eaa6a792` | `ebcc05a1-0b7d-487c-beef-10df2e9071f8` |
| Rama | `master` | `staging` |
| Build versionado | `bun run setup && bun run db:migrations:apply:production && bun run db:migrations:check:production && bun run build:production` | `bun run setup && bun run db:migrations:apply:staging && bun run db:migrations:check:staging && bun run build:staging` |
| Deploy | `bunx wrangler deploy --env production` | `bunx wrangler deploy --env staging` |
| Tag del Worker | `4c3e208b37024d22b0bd4b9829cddef7` | `40c913ff795147878d4c502300477ade` |

Repositorio `Bebras-Bolivia/bebras-contest` (id `1195777825`, org `295968330`),
conexión `8c881761-84af-4865-bc97-d4a14b1266b2`, cuenta
`a9ca7f3bfd5ff492721f722856ac79b6`.

### Lo que hubo que corregir

El Dashboard dejó los dos triggers **sin comando de build** y con
`npx wrangler deploy` **sin `--env`**. Eso habría desplegado la configuración
raíz, que es la local: Worker `bebras-contest-local`, D1 `database_id: "local"`
y R2 `bebras-uploads-local`. Además creó en producción un trigger
"Deploy non-production branches" (`*` excepto `master`, con
`wrangler versions upload`) que habría subido versiones del Worker de producción
en cada push a cualquier rama, incluida `staging`. Se retiró;
`previews_enabled` quedó en `false`.

### Variables del build

`environment_variables` aparece en la configuración pero el endpoint de triggers
no la acepta (`12002 Invalid request body`): solo se puede editar desde el
Dashboard. No son obligatorias mientras los valores por defecto sigan siendo
compatibles. Si alguna vez cambia la imagen de build, fijar `BUN_VERSION=1.3.5`,
`NODE_VERSION=22` y `SKIP_DEPENDENCY_INSTALL=1` permite que `setup` controle la
instalación completa.

### Comprobado

Build manual en las dos ramas, con despliegue real y verificación posterior:

| | Build | Resultado |
| --- | --- | --- |
| staging | `665e9828` | correcto en 3m30s, desplegó `536f093e` |
| producción | `7343bb52` | correcto en 3m41s, desplegó `1a5b28e2` |

Después de cada uno: login del administrador, token en todas las llamadas,
ninguna respuesta 401, la sesión sobrevive a recargar, y staging sigue mostrando
lo que producción oculta.

```powershell
$env:CLOUDFLARE_API_TOKEN = '<token de usuario>'
bun scripts/cloudflare-builds-setup.ts --check
# Solo si el check informa diferencias:
bun scripts/cloudflare-builds-setup.ts
```

`--check` lista y compara los triggers remotos sin modificarlos. El modo normal
actualiza el trigger existente por UUID o lo crea cuando falta; si encuentra más
de un trigger activo para un Worker, se detiene para no producir duplicados.
Después de cambiar los comandos versionados en este documento, se debe ejecutar
el modo normal con un token administrativo nuevo para sincronizarlos en Cloudflare.
El token que administra Builds y el que ejecuta el despliegue tienen permisos
distintos. No guardar tokens en el repositorio ni usar OAuth de corta duración
como token persistente del build.

## Publicación con migraciones D1

Workers Builds aplica automáticamente las migraciones pendientes del entorno y
luego verifica el historial. El token de despliegue necesita permiso para
modificar y consultar D1; si la migración o la comprobación falla, el build se
detiene antes de desplegar el Worker.

1. Crear la migración versionada y probarla sobre D1 local.
2. Publicar en `staging`; Workers Builds aplica las migraciones de staging,
   verifica el historial y despliega.
3. Validar el Worker alojado y la funcionalidad que depende del nuevo esquema.
4. Fusionar el mismo commit a `master`; Workers Builds aplica esas migraciones en
   producción, verifica el historial y despliega.

La migración debe ser compatible con el Worker anterior durante el intervalo
entre cambiar D1 y desplegar código. Para retirar o renombrar columnas, usar una
secuencia expandir/migrar/contraer en más de una publicación, no una migración
destructiva junto con el código que empieza a depender de ella.

## Verificación al conectar

1. Sólo `master` y `staging` disparan sus respectivos Workers; previews desactivados.
2. Ejecutar un build para cada rama y comprobar el SHA desplegado.
3. Confirmar login y panel; producción conserva el recorte.
4. Verificar que permanecen administradores/colegios y no se cargaron tareas.

Referencias:
- https://developers.cloudflare.com/workers/ci-cd/builds/
- https://developers.cloudflare.com/workers/ci-cd/builds/configuration/
- https://developers.cloudflare.com/api/resources/workers_builds/subresources/triggers/methods/create/
- https://developers.cloudflare.com/fundamentals/api/reference/permissions/#account-permissions

## Pendientes de cierre

- Adaptar la suite E2E heredada a D1/workerd y Firebase; hoy todavía conserva
  partes del runner SQLite anterior.
- Validar de extremo a extremo en staging el registro de maestro, selección de
  colegio, documentos R2 y persistencia D1/R2 después de un redeploy.
- Incorporar una comprobación operativa postdeploy de logs y acceso directo a
  rutas/endpoints restringidos con un usuario no administrador.
- Medir requests, CPU, lecturas/escrituras D1 y operaciones R2 antes de una
  competencia real; un despliegue correcto no certifica capacidad suficiente.
