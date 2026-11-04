import type { NextFunction, Request, Response } from "express";
import { prisma } from "./prisma";
import {
  FirebaseAuthError,
  needsEmailVerification,
  verifyFirebaseIdToken,
  type FirebaseIdentity,
} from "./firebase-auth";

export interface AuthUser {
  id: number;
  email: string;
  role: string;
  firebaseUid: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      firebase?: FirebaseIdentity;
    }
  }
}

export interface AuthFailure {
  status: number;
  body: { message: string; code?: string; email?: string };
}

function bearerToken(req: Request) {
  const header = req.headers.authorization ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

/**
 * Autentica contra Firebase sin exigir todavia un perfil Bebras. La usa el
 * endpoint de sesion, que es justamente quien decide si hay que registrar.
 *
 * `allowUnverified` existe solo para el registro: Firebase manda el correo de
 * verificacion despues de crear la cuenta, asi que el perfil se guarda cuando
 * `email_verified` todavia es falso. Para entrar ya no se permite.
 */
export async function authenticateFirebase(
  req: Request,
  { allowUnverified = false } = {},
): Promise<{ identity: FirebaseIdentity } | { failure: AuthFailure }> {
  const token = bearerToken(req);

  if (!token) {
    return { failure: { status: 401, body: { message: "No autenticado." } } };
  }

  let identity: FirebaseIdentity;
  try {
    identity = await verifyFirebaseIdToken(token);
  } catch (error) {
    const message =
      error instanceof FirebaseAuthError
        ? error.message
        : "Sesión inválida o expirada.";
    return { failure: { status: 401, body: { message } } };
  }

  if (!allowUnverified && needsEmailVerification(identity)) {
    return {
      failure: {
        status: 403,
        body: {
          message:
            "Verifica tu correo para poder entrar. Te reenviamos el enlace desde el inicio de sesión.",
          code: "EMAIL_NOT_VERIFIED",
          email: identity.email,
        },
      },
    };
  }

  req.firebase = identity;
  return { identity };
}

/** Resuelve el perfil Bebras asociado al UID de Firebase. */
export async function resolveAuthUser(
  req: Request,
): Promise<{ user: AuthUser } | { failure: AuthFailure }> {
  if (req.user) return { user: req.user };
  const authenticated = await authenticateFirebase(req);
  if ("failure" in authenticated) return authenticated;

  const { identity } = authenticated;
  const profile = await prisma.user.findUnique({
    where: { firebaseUid: identity.uid },
  });

  if (!profile) {
    return {
      failure: {
        status: 403,
        body: {
          message: "Completa tu registro para continuar.",
          code: "PROFILE_REQUIRED",
          email: identity.email,
        },
      },
    };
  }

  if (profile.status === "rejected") {
    return {
      failure: {
        status: 403,
        body: {
          message: "Tu cuenta fue rechazada. Contacta al administrador.",
          code: "ACCOUNT_REJECTED",
        },
      },
    };
  }

  const actAs = Number(req.headers["x-trial-as"]);
  if (profile.role === "admin" && Number.isInteger(actAs) && actAs > 0) {
    const teacher = await prisma.user.findUnique({ where: { id: actAs } });
    if (
      teacher &&
      teacher.role === "maestro" &&
      teacher.status === "approved" &&
      teacher.email.startsWith("ensayo.") &&
      teacher.email.endsWith("@prueba.bo")
    ) {
      const user: AuthUser = {
        id: teacher.id,
        email: teacher.email,
        role: teacher.role,
        firebaseUid: identity.uid,
      };
      req.user = user;
      return { user };
    }
  }

  const user: AuthUser = {
    id: profile.id,
    email: profile.email,
    role: profile.role,
    firebaseUid: identity.uid,
  };
  req.user = user;
  return { user };
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const resolved = await resolveAuthUser(req);

  if ("failure" in resolved) {
    res.status(resolved.failure.status).json(resolved.failure.body);
    return;
  }

  next();
}

export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  await requireAuth(req, res, () => {
    if (req.user?.role !== "admin") {
      res.status(403).json({ message: "Acceso solo para administradores." });
      return;
    }

    next();
  });
}
