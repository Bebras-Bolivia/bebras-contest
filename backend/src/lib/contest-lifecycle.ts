import type { Express } from "express";
import type { Prisma } from "../generated/prisma/client";
import { db, prisma } from "./prisma";
import {
  SCHOOL_GRADES,
  contestCategories,
  contestStateAt,
  parseCategorySchedules,
  serializeCategorySchedules,
} from "./contest-rules";

export const FAVORITE_CONTEST_KEY = "favoriteContestId";
export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const managementInclude = {
  tasks: {
    include: {
      taskDraft: {
        select: {
          id: true,
          title: true,
          country: true,
          year: true,
          sourceTaskCode: true,
          category: true,
          difficulties: true,
        },
      },
    },
  },
} as const;

type ManagedContest = Prisma.ContestGetPayload<{
  include: typeof managementInclude;
}>;

export async function favoriteContestId() {
  return (
    (
      await prisma.siteSetting.findUnique({
        where: { key: FAVORITE_CONTEST_KEY },
      })
    )?.value ?? null
  );
}

export async function purgeExpiredContests(now = new Date()) {
  const threshold = new Date(now.getTime() - TRASH_RETENTION_MS);
  const expired = `((typeof("trashedAt") = 'text' AND strftime('%Y-%m-%dT%H:%M:%fZ', "trashedAt") <= ?)
    OR (typeof("trashedAt") IN ('integer', 'real') AND "trashedAt" <= ?))`;
  await db().batch([
    db()
      .prepare(
        `DELETE FROM "SiteSetting" WHERE "key" = ? AND "value" IN
      (SELECT "id" FROM "Contest" WHERE ${expired})`,
      )
      .bind(FAVORITE_CONTEST_KEY, threshold.toISOString(), threshold.getTime()),
    db()
      .prepare(`DELETE FROM "Contest" WHERE ${expired}`)
      .bind(threshold.toISOString(), threshold.getTime()),
  ]);
}

function dateInput(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`Indica ${label}.`);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()))
    throw new Error(`La fecha de ${label} no es válida.`);
  return date;
}

export function registerContestLifecycle(
  app: Express,
  now: () => Date,
  serialize: (contest: ManagedContest) => unknown,
) {
  const load = (id: string) =>
    prisma.contest.findUniqueOrThrow({
      where: { id },
      include: managementInclude,
    });

  app.use("/api/contests/:id", async (req, res, next) => {
    if (req.params.id === "trash") return next();
    const contest = await prisma.contest.findUnique({
      where: { id: String(req.params.id) },
      select: { trashedAt: true },
    });
    if (
      contest?.trashedAt &&
      !(req.method === "POST" && req.path === "/restore")
    ) {
      res.status(404).json({ message: "El desafío está en la papelera." });
      return;
    }
    next();
  });

  app.get("/api/contests/trash", async (_req, res) => {
    await purgeExpiredContests();
    const contests = await prisma.contest.findMany({
      where: { trashedAt: { not: null } },
      select: {
        id: true,
        title: true,
        trashedAt: true,
        _count: { select: { groups: true } },
      },
      orderBy: { trashedAt: "desc" },
    });
    res.json(
      contests.map((contest) => ({
        id: contest.id,
        title: contest.title,
        groupCount: contest._count.groups,
        trashedAt: contest.trashedAt!.toISOString(),
        deletesAt: new Date(
          contest.trashedAt!.getTime() + TRASH_RETENTION_MS,
        ).toISOString(),
      })),
    );
  });

  app.post("/api/contests/:id/favorite", async (req, res) => {
    const id = String(req.params.id);
    const contest = await prisma.contest.findFirst({
      where: { id, trashedAt: null, isPractice: false },
      select: { id: true },
    });
    if (!contest) {
      res.status(404).json({ message: "Desafío no encontrado." });
      return;
    }
    if (req.body?.favorite === false) {
      await prisma.siteSetting.deleteMany({
        where: { key: FAVORITE_CONTEST_KEY, value: id },
      });
    } else {
      await prisma.siteSetting.upsert({
        where: { key: FAVORITE_CONTEST_KEY },
        create: { key: FAVORITE_CONTEST_KEY, value: id },
        update: { value: id },
      });
    }
    res.json({ favoriteContestId: await favoriteContestId() });
  });

  app.delete("/api/contests/:id", async (req, res) => {
    const id = String(req.params.id);
    const contest = await prisma.contest.findUnique({ where: { id } });
    if (!contest) {
      res.status(404).json({ message: "Desafío no encontrado." });
      return;
    }
    if (contestStateAt(now(), contest).state === "abierta") {
      res.status(409).json({
        message:
          "El desafío se está rindiendo. Detenlo antes de enviarlo a la papelera.",
      });
      return;
    }
    const stamp = new Date().toISOString();
    const result = await db().batch([
      db()
        .prepare(
          `UPDATE "Contest" SET "trashedAt" = ?, "updatedAt" = ? WHERE "id" = ? AND "trashedAt" IS NULL AND (strftime('%Y-%m-%dT%H:%M:%fZ', "updatedAt") = ? OR "updatedAt" = ?)`,
        )
        .bind(
          stamp,
          stamp,
          id,
          contest.updatedAt.toISOString(),
          contest.updatedAt.getTime(),
        ),
      db()
        .prepare(
          `UPDATE "Team" SET "sessionToken" = NULL, "sessionSeenAt" = NULL
        WHERE "groupId" IN (SELECT g."id" FROM "ContestGroup" g JOIN "Contest" c ON c."id" = g."contestId"
          WHERE c."id" = ? AND c."trashedAt" = ?)`,
        )
        .bind(id, stamp),
      db()
        .prepare(
          `DELETE FROM "SiteSetting" WHERE "key" = ? AND "value" = ?
        AND EXISTS (SELECT 1 FROM "Contest" WHERE "id" = ? AND "trashedAt" = ?)`,
        )
        .bind(FAVORITE_CONTEST_KEY, id, id, stamp),
    ]);
    if (!result[0].meta.changes) {
      res.status(409).json({
        message: "El desafío cambió. Actualiza la página e inténtalo otra vez.",
      });
      return;
    }
    res.status(204).end();
  });

  app.post("/api/contests/:id/restore", async (req, res) => {
    const id = String(req.params.id);
    const threshold = new Date(Date.now() - TRASH_RETENTION_MS);
    const restored = await db()
      .prepare(
        `UPDATE "Contest" SET "trashedAt" = NULL, "updatedAt" = ?
      WHERE "id" = ? AND ((typeof("trashedAt") = 'text' AND strftime('%Y-%m-%dT%H:%M:%fZ', "trashedAt") > ?)
      OR (typeof("trashedAt") IN ('integer', 'real') AND "trashedAt" > ?))`,
      )
      .bind(
        new Date().toISOString(),
        id,
        threshold.toISOString(),
        threshold.getTime(),
      )
      .run();
    if (!restored.meta.changes) {
      res.status(410).json({
        message:
          "El plazo de recuperación terminó o el desafío no está en la papelera.",
      });
      return;
    }
    res.json(serialize(await load(id)));
  });

  app.post("/api/contests/:id/stop", async (req, res) => {
    const id = String(req.params.id);
    const contest = await prisma.contest.findUnique({ where: { id } });
    if (!contest?.publishedAt || contest.stoppedAt) {
      res.status(409).json({
        message:
          "Solo se puede detener un desafío publicado que no esté ya detenido.",
      });
      return;
    }
    const stamp = now().toISOString();
    const result = await db().batch([
      db()
        .prepare(
          `UPDATE "Contest" SET "stoppedAt" = ?, "suspendedAt" = NULL,
        "consolidatedAt" = NULL, "resultsPublishedAt" = NULL, "resultsReleasedAt" = NULL, "updatedAt" = ?
        WHERE "id" = ? AND "trashedAt" IS NULL AND (strftime('%Y-%m-%dT%H:%M:%fZ', "updatedAt") = ? OR "updatedAt" = ?)`,
        )
        .bind(
          stamp,
          stamp,
          id,
          contest.updatedAt.toISOString(),
          contest.updatedAt.getTime(),
        ),
      db()
        .prepare(
          `DELETE FROM "Attempt" WHERE "teamId" IN
        (SELECT t."id" FROM "Team" t JOIN "ContestGroup" g ON g."id" = t."groupId"
         JOIN "Contest" c ON c."id" = g."contestId" WHERE c."id" = ? AND c."stoppedAt" = ?)`,
        )
        .bind(id, stamp),
      db()
        .prepare(
          `INSERT INTO "Attempt" ("id", "teamId", "status", "mode", "createdAt", "updatedAt")
        SELECT lower(hex(randomblob(16))), t."id", 'pending', 'online', ?, ?
        FROM "Team" t JOIN "ContestGroup" g ON g."id" = t."groupId"
        JOIN "Contest" c ON c."id" = g."contestId" WHERE c."id" = ? AND c."stoppedAt" = ?`,
        )
        .bind(stamp, stamp, id, stamp),
      db()
        .prepare(
          `UPDATE "Team" SET "status" = 'registered', "updatedAt" = ? WHERE "groupId" IN
        (SELECT g."id" FROM "ContestGroup" g JOIN "Contest" c ON c."id" = g."contestId"
         WHERE c."id" = ? AND c."stoppedAt" = ?)`,
        )
        .bind(stamp, id, stamp),
      db()
        .prepare(
          `UPDATE "ContestGroup" SET "firstUsedAt" = NULL, "expiresAt" = NULL, "updatedAt" = ?
        WHERE "contestId" = ? AND EXISTS (SELECT 1 FROM "Contest" WHERE "id" = ? AND "stoppedAt" = ?)`,
        )
        .bind(stamp, id, id, stamp),
    ]);
    if (!result[0].meta.changes) {
      res.status(409).json({
        message: "El desafío cambió. Actualiza la página e inténtalo otra vez.",
      });
      return;
    }
    res.json(serialize(await load(id)));
  });

  app.post("/api/contests/:id/restart", async (req, res) => {
    const id = String(req.params.id);
    const contest = await load(id);
    if (!contest.stoppedAt) {
      res.status(409).json({ message: "El desafío no está detenido." });
      return;
    }
    const categories = contestCategories(contest);
    if (
      !contest.title.trim() ||
      categories.length === 0 ||
      categories.some(
        (category) => !contest.tasks.some((task) => task.category === category),
      )
    ) {
      res.status(400).json({
        message:
          "Cada categoría necesita preguntas antes de reprogramar el desafío.",
      });
      return;
    }
    const schedules = parseCategorySchedules(contest.schedules);
    const ends = Object.keys(schedules).length
      ? Object.values(schedules).map((window) => window.endsAt)
      : [contest.endsAt];
    if (ends.some((end) => end && end <= now())) {
      res.status(400).json({
        message:
          "Actualiza las fechas: el cierre de cada categoría debe quedar en el futuro.",
      });
      return;
    }
    await prisma.contest.update({ where: { id }, data: { stoppedAt: null } });
    res.json(serialize(await load(id)));
  });

  app.patch("/api/contests/:id/closing", async (req, res) => {
    const id = String(req.params.id);
    const contest = await prisma.contest.findUnique({ where: { id } });
    if (!contest?.publishedAt) {
      res.status(404).json({ message: "Desafío no encontrado." });
      return;
    }
    const instant = now();
    const state = contestStateAt(instant, contest).state;
    try {
      if (
        Object.keys(req.body ?? {}).some(
          (key) =>
            !["registrationEndsAt", "endsAt", "categoryEndsAt"].includes(key),
        )
      ) {
        throw new Error(
          "Solo puedes ampliar el cierre. Detén el desafío para reprogramar el inicio o las preguntas.",
        );
      }
      if (req.body?.registrationEndsAt !== undefined) {
        if (state !== "inscripcion" && state !== "preparacion")
          throw new Error(
            "Solo puedes ampliar la inscripción antes de que empiece la rendición.",
          );
        const end = dateInput(
          req.body.registrationEndsAt,
          "el cierre de inscripción",
        );
        const oldEnd = contest.registrationEndsAt ?? contest.startsAt;
        if ((oldEnd && end < oldEnd) || end <= instant)
          throw new Error(
            "El nuevo cierre debe ampliar el plazo actual y quedar en el futuro.",
          );
        if (contest.startsAt && end > contest.startsAt)
          throw new Error(
            "Para mover también el inicio de la rendición, detén el desafío y reprograma sus fechas.",
          );
        const changed = await db()
          .prepare(
            `UPDATE "Contest" SET "registrationStartsAt" = ?,
          "registrationEndsAt" = ?, "updatedAt" = ? WHERE "id" = ? AND "stoppedAt" IS NULL
          AND "trashedAt" IS NULL AND (strftime('%Y-%m-%dT%H:%M:%fZ', "updatedAt") = ? OR "updatedAt" = ?)`,
          )
          .bind(
            (
              contest.registrationStartsAt ?? contest.publishedAt!
            ).toISOString(),
            end.toISOString(),
            instant.toISOString(),
            id,
            contest.updatedAt.toISOString(),
            contest.updatedAt.getTime(),
          )
          .run();
        if (!changed.meta.changes)
          throw new Error(
            "El desafío cambió. Actualiza la página antes de ampliar el cierre.",
          );
      } else {
        if (state !== "abierta")
          throw new Error(
            "Solo puedes ampliar la rendición mientras está en curso.",
          );
        const schedules = parseCategorySchedules(contest.schedules);
        const windows = Object.keys(schedules).length
          ? schedules
          : { "": { startsAt: contest.startsAt!, endsAt: contest.endsAt! } };
        const updates: D1PreparedStatement[] = [];
        for (const [category, window] of Object.entries(windows)) {
          const end = dateInput(
            category ? req.body?.categoryEndsAt?.[category] : req.body?.endsAt,
            "el cierre de rendición",
          );
          if (end < window.endsAt)
            throw new Error(
              "El cierre solo se puede ampliar. Para reprogramar, detén el desafío.",
            );
          if (
            window.endsAt <= instant &&
            end.getTime() !== window.endsAt.getTime()
          )
            throw new Error(
              `La categoría ${category} ya terminó. Detén el desafío para reprogramarla.`,
            );
          if (end > window.endsAt) {
            const grades = SCHOOL_GRADES.filter(
              (grade) => !category || grade.category === category,
            ).map((grade) => grade.value);
            const naturalEnd = `CASE WHEN typeof("startedAt") IN ('integer','real')
              THEN strftime('%Y-%m-%dT%H:%M:%fZ', "startedAt" / 1000, 'unixepoch', ?)
              ELSE strftime('%Y-%m-%dT%H:%M:%fZ', "startedAt", ?) END`;
            updates.push(
              db()
                .prepare(
                  `UPDATE "Attempt" SET "endsAt" = min((${naturalEnd}), ?), "updatedAt" = ?
              WHERE "status" = 'in_progress' AND "startedAt" IS NOT NULL AND "mode" = 'online'
              AND EXISTS (SELECT 1 FROM "Contest" c WHERE c."id" = ? AND c."stoppedAt" IS NULL AND c."trashedAt" IS NULL AND (strftime('%Y-%m-%dT%H:%M:%fZ', c."updatedAt") = ? OR c."updatedAt" = ?))
              AND "teamId" IN (SELECT t."id" FROM "Team" t JOIN "ContestGroup" g ON g."id" = t."groupId"
                WHERE g."contestId" = ? AND t."grade" IN (${grades.map(() => "?").join(",")}))`,
                )
                .bind(
                  `+${contest.durationMinutes} minutes`,
                  `+${contest.durationMinutes} minutes`,
                  end.toISOString(),
                  instant.toISOString(),
                  id,
                  contest.updatedAt.toISOString(),
                  contest.updatedAt.getTime(),
                  id,
                  ...grades,
                ),
            );
          }
          window.endsAt = end;
        }
        const end = new Date(
          Math.max(
            ...Object.values(windows).map((window) => window.endsAt.getTime()),
          ),
        );
        const oldRelease =
          contest.resultsAt && contest.resultsAt > contest.endsAt!
            ? contest.resultsAt
            : contest.endsAt!;
        const release = oldRelease > end ? oldRelease : end;
        const until =
          contest.resultsUntil && contest.resultsUntil <= release
            ? new Date(
                contest.resultsUntil.getTime() +
                  release.getTime() -
                  oldRelease.getTime(),
              )
            : contest.resultsUntil;
        updates.push(
          db()
            .prepare(
              `UPDATE "Contest" SET "endsAt" = ?, "schedules" = ?, "resultsAt" = ?, "resultsUntil" = ?, "updatedAt" = ? WHERE "id" = ? AND "stoppedAt" IS NULL AND "trashedAt" IS NULL AND (strftime('%Y-%m-%dT%H:%M:%fZ', "updatedAt") = ? OR "updatedAt" = ?)`,
            )
            .bind(
              end.toISOString(),
              Object.keys(schedules).length
                ? serializeCategorySchedules(schedules)
                : "{}",
              release.toISOString(),
              until?.toISOString() ?? null,
              instant.toISOString(),
              id,
              contest.updatedAt.toISOString(),
              contest.updatedAt.getTime(),
            ),
        );
        const changed = await db().batch(updates);
        if (!changed.at(-1)?.meta.changes)
          throw new Error(
            "El desafío cambió. Actualiza la página antes de ampliar el cierre.",
          );
      }
      res.json(serialize(await load(id)));
    } catch (error) {
      res.status(400).json({
        message:
          error instanceof Error
            ? error.message
            : "No se pudo ampliar el cierre.",
      });
    }
  });
}
