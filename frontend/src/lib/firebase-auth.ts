import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  getAdditionalUserInfo,
  getRedirectResult,
  linkWithCredential,
  onIdTokenChanged,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type AuthError,
  type User,
  type UserCredential,
} from "firebase/auth";

import { clearToken, setToken } from "@/lib/auth";
import { emailVerificationActionSettings } from "@/lib/email-verification";
import { firebaseAuth, isFirebaseConfigured } from "@/lib/firebase";
import { idTokenFrom } from "@/lib/firebase-token";

/** Estado unico de Firebase Authentication para todo el frontend (§16). */
export interface FirebaseSession {
  loading: boolean;
  user: User | null;
  uid: string | null;
  email: string | null;
  emailVerified: boolean;
  /** `password`, `google.com`, … del proveedor con el que entro. */
  provider: string | null;
  /** Foto de la cuenta de Google, si entró o vinculó Google. */
  photoURL: string | null;
}

const SIGNED_OUT: FirebaseSession = {
  loading: false,
  user: null,
  uid: null,
  email: null,
  emailVerified: false,
  provider: null,
  photoURL: null,
};

const GOOGLE_PROFILE_KEY = "bebras_google_profile";

let snapshot: FirebaseSession = isFirebaseConfigured()
  ? { ...SIGNED_OUT, loading: true }
  : SIGNED_OUT;
let started = false;
const listeners = new Set<() => void>();

function publish(next: FirebaseSession) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

function describe(user: User): FirebaseSession {
  return {
    loading: false,
    user,
    uid: user.uid,
    email: user.email,
    emailVerified: user.emailVerified,
    provider: user.providerData[0]?.providerId ?? null,
    // Con una cuenta de contraseña vinculada después a Google, la foto queda en
    // el proveedor de Google y no en el usuario.
    photoURL:
      user.photoURL ??
      user.providerData.find((profile) => profile.photoURL)?.photoURL ??
      null,
  };
}

/**
 * Un unico observador para toda la aplicacion. `onIdTokenChanged` tambien salta
 * cuando Firebase renueva el ID Token (cada hora), asi que el token guardado
 * para las llamadas a la API se mantiene fresco sin tocar el perfil Bebras.
 */
function start() {
  if (started || typeof window === "undefined" || !isFirebaseConfigured()) {
    return;
  }
  started = true;

  const auth = firebaseAuth();
  // No se toca la persistencia: `getAuth()` ya guarda en IndexedDB con respaldo
  // en localStorage, y cambiarla aqui competiria con la restauracion en curso.
  // Consume el resultado del flujo por redireccion (respaldo de los popups).
  void getRedirectResult(auth).catch(() => undefined);

  onIdTokenChanged(auth, (user) => {
    if (!user) {
      clearToken();
      publish(SIGNED_OUT);
      return;
    }

    publish(describe(user));
    void user
      .getIdToken()
      .then((token) => setToken(token))
      .catch(() => undefined);
  });
}

export function subscribeFirebase(listener: () => void) {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function firebaseSnapshot() {
  start();
  return snapshot;
}

export function firebaseServerSnapshot() {
  return SIGNED_OUT;
}

/**
 * ID Token vigente; Firebase lo renueva solo si esta por expirar.
 *
 * Espera a `authStateReady()`: al cargar una pagina la sesion persistida se
 * restaura de forma asincrona y hasta que termina `currentUser` es null, asi que
 * las primeras peticiones salian sin cabecera y el backend las rechazaba.
 */
export async function currentIdToken(): Promise<string | null> {
  if (!isFirebaseConfigured()) return null;
  // Deja instalado el observador aunque ningun componente se haya suscrito: asi
  // la copia del token en localStorage tambien se mantiene al dia.
  start();
  return idTokenFrom(firebaseAuth());
}

let ending = false;

/**
 * El backend rechazo el token. Cerrar tambien en Firebase evita que /login
 * retome la sesion al instante y se quede yendo y viniendo. Varias peticiones
 * en vuelo pueden fallar a la vez, asi que solo la primera cierra.
 */
export async function endRejectedSession() {
  if (ending) return;
  ending = true;
  await signOutFirebase();
  if (typeof window !== "undefined") {
    window.location.replace("/login");
  }
}

export async function authorizationHeaders(): Promise<Record<string, string>> {
  const token = await currentIdToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function signOutFirebase() {
  if (isFirebaseConfigured()) {
    await signOut(firebaseAuth()).catch(() => undefined);
  }
  clearToken();
}

// --- Correo y contraseña -------------------------------------------------

export async function registerWithEmail(email: string, password: string) {
  const credential = await createUserWithEmailAndPassword(
    firebaseAuth(),
    email,
    password,
  );
  return credential.user;
}

export async function signInWithEmail(email: string, password: string) {
  const credential = await signInWithEmailAndPassword(
    firebaseAuth(),
    email,
    password,
  );
  return credential.user;
}

export async function sendVerificationEmail(user: User) {
  await sendEmailVerification(
    user,
    emailVerificationActionSettings(window.location.origin),
  );
}

// --- Google ---------------------------------------------------------------

export interface GoogleProfile {
  email: string;
  firstName: string;
  lastName: string;
}

function googleProvider() {
  const provider = new GoogleAuthProvider();
  // Obliga a elegir cuenta en vez de reutilizar la sesion de Google del navegador.
  provider.setCustomParameters({ prompt: "select_account" });
  return provider;
}

/**
 * Nombre y apellido: Google los entrega separados en `given_name`/`family_name`
 * cuando estan disponibles. No siempre lo estan, asi que se cae a partir el
 * `displayName` y, en ultimo caso, se deja vacio para que la persona lo escriba.
 */
export function readGoogleProfile(credential: UserCredential): GoogleProfile {
  const claims = getAdditionalUserInfo(credential)?.profile as
    | { given_name?: unknown; family_name?: unknown }
    | undefined;
  const given =
    typeof claims?.given_name === "string" ? claims.given_name.trim() : "";
  const family =
    typeof claims?.family_name === "string" ? claims.family_name.trim() : "";

  const parts = (credential.user.displayName ?? "")
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
  const fallbackFirst = parts.length ? parts[0] : "";
  const fallbackLast = parts.length > 1 ? parts.slice(1).join(" ") : "";

  return {
    email: credential.user.email ?? "",
    firstName: given || fallbackFirst,
    lastName: family || fallbackLast,
  };
}

export function rememberGoogleProfile(profile: GoogleProfile) {
  try {
    window.sessionStorage.setItem(GOOGLE_PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // Sin sessionStorage el formulario simplemente no se precarga.
  }
}

export function recallGoogleProfile(): GoogleProfile | null {
  try {
    const raw = window.sessionStorage.getItem(GOOGLE_PROFILE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const profile = value as GoogleProfile;
    return typeof profile.email === "string" ? profile : null;
  } catch {
    return null;
  }
}

export function forgetGoogleProfile() {
  try {
    window.sessionStorage.removeItem(GOOGLE_PROFILE_KEY);
  } catch {
    // Nada que limpiar.
  }
}

const POPUP_UNAVAILABLE = new Set([
  "auth/popup-blocked",
  "auth/operation-not-supported-in-this-environment",
  "auth/cancelled-popup-request",
]);

export class GoogleRedirectStarted extends Error {
  constructor() {
    super("Continuando con Google en esta misma pestaña.");
  }
}

/**
 * Popup como camino principal y redireccion como respaldo: los navegadores
 * moviles y algunos bloqueadores no permiten abrir la ventana emergente.
 */
export async function continueWithGoogle(): Promise<UserCredential> {
  const auth = firebaseAuth();

  try {
    return await signInWithPopup(auth, googleProvider());
  } catch (error) {
    const code = (error as AuthError)?.code ?? "";
    if (!POPUP_UNAVAILABLE.has(code)) throw error;
    await signInWithRedirect(auth, googleProvider());
    throw new GoogleRedirectStarted();
  }
}

// --- Vinculación de proveedores ------------------------------------------

let pendingGoogleCredential: ReturnType<
  typeof GoogleAuthProvider.credentialFromError
> = null;
let pendingGoogleEmail = "";

/**
 * Mismo correo con dos proveedores. Firebase pide resolverlo entrando primero
 * con el proveedor que ya existe y enlazando despues la credencial pendiente;
 * es la via oficial y evita crear una segunda identidad para la misma persona.
 */
export function rememberPendingGoogleCredential(error: unknown) {
  const authError = error as AuthError;
  if (authError?.code !== "auth/account-exists-with-different-credential") {
    return null;
  }
  pendingGoogleCredential = GoogleAuthProvider.credentialFromError(authError);
  pendingGoogleEmail = (
    (authError.customData?.email as string | undefined) ?? ""
  ).toLowerCase();
  return pendingGoogleCredential ? pendingGoogleEmail : null;
}

export function pendingGoogleLinkEmail() {
  return pendingGoogleCredential ? pendingGoogleEmail : "";
}

/** Enlaza la credencial de Google guardada a la sesión recién iniciada. */
export async function linkPendingGoogleCredential(user: User) {
  if (!pendingGoogleCredential) return;
  const credential = pendingGoogleCredential;
  pendingGoogleCredential = null;
  pendingGoogleEmail = "";
  await linkWithCredential(user, credential).catch(() => undefined);
}

// --- Mensajes -------------------------------------------------------------

const MESSAGES: Record<string, string> = {
  "auth/invalid-credential": "Correo o contraseña incorrectos.",
  "auth/invalid-email": "Ingresa un correo válido.",
  "auth/user-disabled": "Esta cuenta está deshabilitada.",
  "auth/user-not-found": "Correo o contraseña incorrectos.",
  "auth/wrong-password": "Correo o contraseña incorrectos.",
  "auth/email-already-in-use": "Ya existe una cuenta con ese correo.",
  "auth/weak-password": "La contraseña debe tener al menos 6 caracteres.",
  "auth/too-many-requests":
    "Demasiados intentos. Espera unos minutos y vuelve a probar.",
  "auth/network-request-failed": "No se pudo conectar con el servidor.",
  "auth/popup-closed-by-user":
    "Cerraste la ventana de Google antes de terminar.",
  "auth/unauthorized-domain":
    "Este dominio no está autorizado en Firebase Authentication.",
};

export function firebaseErrorMessage(error: unknown, fallback: string) {
  const code = (error as AuthError)?.code ?? "";
  return MESSAGES[code] ?? fallback;
}
