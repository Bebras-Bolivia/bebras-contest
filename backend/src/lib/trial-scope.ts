type Args = Record<string, unknown>;

const scopedModels: Record<string, (id: string | null) => Args> = {
  contest: (trialSessionId) => ({ trialSessionId }),
  taskDraft: (trialSessionId) => ({ trialSessionId }),
  user: (trialSessionId) => ({ trialSessionId }),
  teacherSchool: (trialSessionId) => ({ user: { trialSessionId } }),
  contestTask: (trialSessionId) => ({ contest: { trialSessionId } }),
  contestGroup: (trialSessionId) => ({ contest: { trialSessionId } }),
  team: (trialSessionId) => ({ group: { contest: { trialSessionId } } }),
  attempt: (trialSessionId) => ({
    team: { group: { contest: { trialSessionId } } },
  }),
  attemptAnswer: (trialSessionId) => ({
    attempt: { team: { group: { contest: { trialSessionId } } } },
  }),
  result: (trialSessionId) => ({
    attempt: { team: { group: { contest: { trialSessionId } } } },
  }),
  practiceResult: (trialSessionId) => ({ contest: { trialSessionId } }),
};

export type TrialScope = string | null | false;

export function trialQueryArgs(
  model: string,
  operation: string,
  args: Args,
  scope: TrialScope,
): Args {
  if (scope === false) return args;
  if (model === "siteSetting" && typeof scope === "string") {
    const prefix = `trial:${scope}:`;
    const keyData = (data: unknown) => {
      const row = data as Args | undefined;
      return row && typeof row.key === "string"
        ? { ...row, key: prefix + row.key }
        : row;
    };
    const where = args.where as Args | undefined;
    if (operation.startsWith("create"))
      return { ...args, data: keyData(args.data) };
    return {
      ...args,
      where:
        typeof where?.key === "string"
          ? { ...where, key: prefix + where.key }
          : { AND: [where ?? {}, { key: { startsWith: prefix } }] },
      ...(args.data ? { data: keyData(args.data) } : {}),
      ...(args.create ? { create: keyData(args.create) } : {}),
    };
  }
  const filter = scopedModels[model];
  if (!filter) return args;
  if (operation.startsWith("create")) {
    if (!["contest", "taskDraft", "user"].includes(model)) return args;
    const stamp = (data: unknown) => ({
      ...(data as Args),
      trialSessionId: scope,
    });
    return {
      ...args,
      data: Array.isArray(args.data) ? args.data.map(stamp) : stamp(args.data),
    };
  }
  const where = args.where as Args | undefined;
  return {
    ...args,
    where: {
      ...where,
      AND: [
        ...(Array.isArray(where?.AND) ? where.AND : [where?.AND ?? {}]),
        filter(scope),
      ],
    },
    ...(operation === "upsert" &&
    ["contest", "taskDraft", "user"].includes(model)
      ? { create: { ...(args.create as Args), trialSessionId: scope } }
      : {}),
  };
}
