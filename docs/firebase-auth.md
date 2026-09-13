# Firebase Authentication

Firebase es el sistema de identidad de Bebras: decide **quién es** la persona.
Bebras sigue siendo dueño de **sus datos** (rol, estado de aprobación, colegios,
documentos). La relación entre ambos es `User.firebaseUid`, nunca el correo.

```text
Frontend (Astro/React en Cloudflare)
        ↓  Firebase Web SDK
Firebase Authentication  →  ID Token (RS256)
        ↓  Authorization: Bearer <id-token>
Worker en Cloudflare  →  verificación por JWKS
        ↓
D1 (User.firebaseUid)
```

No se usa Firestore, Realtime Database, Storage, Functions ni Hosting.

## Proyecto y proveedores

Producción usa un proyecto independiente. Desarrollo local comparte únicamente
las identidades de Firebase con staging; sus datos de aplicación siguen en D1/R2
locales:

| | Producción | Staging y desarrollo local |
| --- | --- | --- |
| Project ID | `bebras-bo` | `bebras-bo-staging` |
| Alias en `.firebaserc` | `production` | `staging` |
| App Web | `1:1026208753397:web:652dd936ef213b6bab87bc` | `1:88239195646:web:044edbc9ca41c429286caf` |
| Proveedores | Email/Password y Google | Email/Password y Google |
| D1 | `bebras-prod` | `bebras-staging` (staging) / D1 local (desarrollo) |

Los dos habilitan **solo** Email/Password y Google.

Los proveedores se declaran en `firebase.json` y se aplican por CLI:

```powershell
npx firebase deploy --only auth --project production
npx firebase deploy --only auth --project staging
```

`authorizedRedirectUris` no se declara: el proyecto ya registra
`https://bebras-bo.firebaseapp.com/__/auth/handler` y repetirlo hace fallar el
despliegue con `OAuth 2 redirect URLs have duplicate`.

### Dominios autorizados

Google sign-in solo funciona desde un dominio autorizado; si falta, el navegador
responde `auth/unauthorized-domain`. El CLI no tiene un comando para esto, pero
sí el módulo interno que usa `hosting:channel:deploy`, con la misma sesión de
`firebase login`:

```powershell
bun scripts/firebase-authorized-domains.ts
bun scripts/firebase-authorized-domains.ts --add bebras-contest.bebrasbolivia.workers.dev
```

Autorizados hoy:

- **producción**: `bebras-bo.firebaseapp.com`, `bebras-bo.web.app` y
  `bebras-contest.bebrasbolivia.workers.dev`;
- **staging**: los suyos, `bebras-contest-staging.bebrasbolivia.workers.dev` y
  `localhost`.

Para desarrollar en local conviene apuntar a **staging**, que ya autoriza
`localhost`; producción no lo autoriza a propósito.

## Verificación de tokens en el Worker

`backend/src/lib/firebase-auth.ts` valida los ID Token con **jose** y Web Crypto,
sin Admin SDK ni Service Account: el Admin SDK no corre sobre workerd y una
Service Account seria una credencial privada mas que custodiar.

Se comprueba, siguiendo el procedimiento oficial de Firebase:

- firma RS256 contra `https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com`;
- `iss` = `https://securetoken.google.com/<FIREBASE_PROJECT_ID>`;
- `aud` = `<FIREBASE_PROJECT_ID>`;
- `sub` presente y `auth_time` ya ocurrido.

El JWKS se cachea en el isolate; `jose` lo revalida solo ante un `kid` nuevo.

## Correo verificado

Solo el proveedor `password` puede llegar con el correo sin confirmar; Google lo
verifica por si mismo. La regla vive en `needsEmailVerification`:

- **entrar**: correo sin verificar → `403 EMAIL_NOT_VERIFIED`, con opción de
  reenviar el enlace desde el formulario;
- **registrarse**: permitido sin verificar (`allowUnverified`), porque Firebase
  manda el correo *después* de crear la cuenta. El perfil se guarda, pero no se
  entra al sistema hasta verificar.

La instancia de Auth usa `languageCode = "es"`. El primer envío y los reenvíos
incluyen una URL de continuación construida desde el origen actual:
`/login?verified=1`. Así local vuelve a local, staging a staging y producción a
producción sin compartir URLs entre entornos.

Después del registro se mantiene abierta la sesión Firebase. Mientras se muestra
la pantalla de verificación, el navegador ejecuta `user.reload()` al recuperar el
foco y cada dos segundos si la pestaña está visible. Cuando Firebase confirma
el correo, fuerza `getIdToken(true)`, abre la sesión Bebras y redirige según el
rol. El botón **Ya verifiqué mi correo** ejecuta la misma comprobación de forma
manual.

Si el enlace vuelve a `/login?verified=1`, el login actualiza primero el usuario
y el token antes de abrir la sesión. Esto permite continuar automáticamente en
el mismo navegador. En otro dispositivo, donde no existe esa sesión Firebase,
la persona debe identificarse normalmente.

Firebase entrega primero el enlace a `/auth/action`. Esa página aplica
`oobCode` al cargar, elimina el código de la URL visible y redirige inmediatamente
a `/login?verified=1`, sin botón ni espera intermedia. Solo acepta esa ruta en el
origen actual o en `localhost`/`127.0.0.1` por HTTP para desarrollo, por lo que el
`continueUrl` no puede convertirse en un redirect abierto. Si el enlace está
vencido o ya fue usado, muestra una pantalla Bebras con acceso al reenvío.

Un fallo del primer envío ya no se presenta como éxito: la cuenta queda creada,
la pantalla explica el problema y permite reenviar. Los reenvíos están
bloqueados mientras hay otro envío en curso.

### Configuración del correo de verificación

El repositorio es dueño únicamente de estos campos de Firebase Authentication:

- `notification.defaultLocale` (`es`);
- `notification.sendEmail.callbackUri`, distinto por entorno;
- asunto, cuerpo HTML y formato de `verifyEmailTemplate`.

El script usa la sesión activa de `firebase login`, muestra solo esos campos y el
indicador informativo `customized`, y no modifica nada salvo con `--apply`. La
máscara de actualización es deliberadamente estrecha: remitente, `replyTo`, SMTP
y el resto de la configuración remota quedan fuera de su propiedad.

Inspección de solo lectura (también se puede agregar `--check`):

```powershell
bun scripts/firebase-email-config.ts --project staging
bun scripts/firebase-email-config.ts --project production
```

La inspección termina con código distinto de cero si detecta diferencias. Para
aplicar, primero debe estar desplegada y operativa la ruta `/auth/action` del
Worker correspondiente; Firebase enviará allí los enlaces:

```powershell
bun scripts/firebase-email-config.ts --project staging --apply
bun scripts/firebase-email-config.ts --project production --apply
```

Siempre se aplica primero staging y se valida el correo real antes de producción.
El script aplica cada campo con una petición independiente, vuelve a consultar
Firebase después del cambio y falla si queda alguna diferencia. Esto permite
conservar los cambios aceptados y señalar con precisión un campo bloqueado. En
algunos proyectos Firebase rechaza asunto, cuerpo o URL de acción con
`EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED`, incluso cuando el dominio está autorizado;
ese bloqueo también afecta al editor de la consola en algunos casos y requiere
resolverlo con soporte de Firebase, SMTP personalizado o envío propio. El campo
`customized` es informativo y de solo lectura, por lo que no puede desbloquearse
desde el payload. `auth.languageCode = "es"` selecciona el idioma de plantillas
predeterminadas, pero **no traduce** asunto ni cuerpo cuando la plantilla remota
está explícitamente personalizada (`customized: true`); por eso el texto español
se administra aquí.

## Rutas

| Ruta | Qué hace |
| --- | --- |
| `POST /api/auth/session` | Cambia el ID Token por el perfil Bebras. Enlaza por correo si el UID aún no está asociado. `404 PROFILE_REQUIRED` cuando falta registrarse. |
| `POST /api/auth/register` | Crea el perfil Bebras para la identidad del token. Sin contraseña: la guarda Firebase. |
| Resto | `requireAuth` / `requireAdmin` resuelven el usuario por `firebaseUid`. |

`POST /api/auth/login` y el JWT propio (HS256) fueron retirados.

## Sin usuarios duplicados

`/api/auth/session` busca primero por `firebaseUid`. Si no hay coincidencia y
existe una fila con ese correo, la enlaza en vez de crear otra: es el caso de los
admins migrados y el de quien ya tenía cuenta y ahora entra con Google. Un correo
ya enlazado a otro UID responde `409 UID_CONFLICT` en lugar de reasignarse.

En el navegador, cuando Firebase responde
`auth/account-exists-with-different-credential`, el formulario guarda la
credencial de Google, pide la contraseña existente y hace `linkWithCredential`:
es el flujo oficial de vinculación, sin identidades paralelas.

## Variables

Worker (`wrangler.jsonc` → `vars`):

```text
FIREBASE_PROJECT_ID   production = bebras-bo
                      staging/local = bebras-bo-staging
```

Frontend (`PUBLIC_*`, públicas por diseño, viajan en el bundle). Los builds las
inyectan desde `scripts/firebase-config.ts`; `bun run dev` inyecta staging:

```text
PUBLIC_FIREBASE_API_KEY
PUBLIC_FIREBASE_AUTH_DOMAIN
PUBLIC_FIREBASE_PROJECT_ID
PUBLIC_FIREBASE_APP_ID
PUBLIC_FIREBASE_MESSAGING_SENDER_ID
```

Vacío = entorno sin Firebase: los formularios lo dicen y no dejan entrar.

`bun run dev` siempre levanta Astro y Wrangler local con Firebase staging. No
selecciona bindings remotos ni permite producción. La cuenta y su UID existen en
Firebase staging; el perfil Bebras asociado se crea o enlaza independientemente
en D1 local. Para probar staging con su D1/R2, se abre el sitio desplegado.

`REGISTRATION_ONLY` es independiente de todo esto: `true` solo en producción, que
por eso oculta las secciones que no son inscripción. Staging lo tiene en `false`
y muestra todo.

## Migración de cuentas existentes

```powershell
bun scripts/firebase-migrate-users.ts --target production --check
bun scripts/firebase-migrate-users.ts --target production
# staging usa su propio proyecto y su propia D1
bun scripts/firebase-migrate-users.ts --target staging
```

Sube a Firebase las filas de D1 con `passwordHash` y sin `firebaseUid`,
**conservando la contraseña**: bcrypt viaja tal cual con `--hash-algo=BCRYPT`.
El UID es `bebras-d1-<id>`, derivado del id de D1, así que reejecutar no duplica
identidades. Después guarda ese UID en `User.firebaseUid`.

`emailVerified` se importa en `false`: no se afirma una verificación que nunca
ocurrió. Esas cuentas deben verificar su correo antes de poder entrar.

### Excepción: `--mark-verified`

```powershell
bun scripts/firebase-migrate-users.ts --target production --mark-verified --user admin@ejemplo.org --check
bun scripts/firebase-migrate-users.ts --target production --mark-verified --user admin@ejemplo.org
```

Reimporta únicamente las cuentas **ya migradas** seleccionadas con uno o más
`--user <correo-o-uid>`, usando `emailVerified: true` y conservando su contraseña.
El comando falla si falta un selector o si alguno no corresponde a una cuenta
migrada. Es una decisión del operador y solo tiene sentido cuando esas
direcciones no pueden recibir el enlace de Firebase.

Se aplicó a los tres administradores: `bebras.bo` no existe en DNS (`NXDOMAIN`,
sin registros MX), así que la verificación normal era imposible y sin esto
habrían quedado sin acceso a producción. Si algún día esas cuentas pasan a
direcciones reales, lo correcto es cambiar el correo y verificarlo de verdad.

> Reimportar **sin** el hash borra la contraseña de la cuenta. El script siempre
> reenvía el hash existente junto con `--hash-algo=BCRYPT`.

## Estado en local

```powershell
bun run db:push          # aplica 0002_user_firebase_uid.sql
bun run dev
```

## Pruebas pendientes

`tests/email-verification.unit.ts` cubre el idioma español, las URLs de retorno
de local/staging/producción, la actualización de `emailVerified`, la renovación
forzada del ID Token y los fallos de red o renovación.

Las suites Playwright antiguas firmaban su propio JWT o llamaban a
`/api/auth/login`. Con Firebase necesitan tokens reales:

- `tests/support/helpers.ts` ya pide el token a Identity Toolkit y requiere
  `E2E_FIREBASE_API_KEY` (emulador de Auth o un proyecto de pruebas, **nunca**
  `bebras-bo`).

El smoke heredado de Cloudflare se eliminó en lugar de conservar una prueba
desactivada que ya no representaba la autenticación desplegada.

Lo ya comprobado de extremo a extremo contra el Worker: token ausente e
inválido, bloqueo por correo sin verificar, registro con correo sin verificar,
registro duplicado, entrada tras verificar, rechazo de rutas de admin a un
maestro y enlace por correo sin duplicar la fila.
