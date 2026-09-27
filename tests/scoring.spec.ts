import { test, expect, request } from "@playwright/test";
import {
  API,
  SCORING_TASKS,
  loginAdmin,
  createContest,
  joinContest,
  createScoringTask,
  submitScoringAttempt,
} from "./support/helpers";

test("applies the easy, medium and hard Bebras scoring scales", async () => {
  const api = await request.newContext();
  const headers = await loginAdmin(api);
  const contest = await createContest(api, headers, {
    tasks: SCORING_TASKS.map(({ taskId }) => ({ taskId })),
  });

  expect(contest.initialScores[contest.categories[0]]).toBe(9);
  expect(
    contest.tasks.map(
      (task: {
        taskId: string;
        difficulty: string;
        minScore: number;
        noAnswerScore: number;
        maxScore: number;
      }) => ({
        taskId: task.taskId,
        difficulty: task.difficulty,
        minScore: task.minScore,
        noAnswerScore: task.noAnswerScore,
        maxScore: task.maxScore,
      }),
    ),
  ).toEqual(SCORING_TASKS);

  const attempts = [
    {
      firstName: "Correctas",
      selected: "B",
      totalScore: 36,
      correctCount: 3,
      answeredCount: 3,
    },
    {
      firstName: "Incorrectas",
      selected: "A",
      totalScore: 0,
      correctCount: 0,
      answeredCount: 3,
    },
    {
      firstName: "Omitidas",
      selected: null,
      totalScore: 9,
      correctCount: 0,
      answeredCount: 0,
    },
  ] as const;

  for (const attempt of attempts) {
    const personalCode = await joinContest(
      api,
      headers,
      contest.id,
      contest.picked.grade,
      attempt.firstName,
    );
    const start = await api.post(`${API}/api/play/start`, {
      data: { personalCode },
    });
    expect(start.ok(), await start.text()).toBe(true);

    if (attempt.selected) {
      for (const task of SCORING_TASKS) {
        const answer = await api.post(`${API}/api/play/answer`, {
          data: {
            personalCode,
            taskId: task.taskId,
            payload: { selected: [attempt.selected] },
          },
        });
        expect(answer.status(), await answer.text()).toBe(204);
      }
    }

    const submit = await api.post(`${API}/api/play/submit`, {
      data: { personalCode },
    });
    expect(submit.ok(), await submit.text()).toBe(true);
  }

  const resultsResponse = await api.get(
    `${API}/api/contests/${contest.id}/results`,
    { headers },
  );
  expect(resultsResponse.ok(), await resultsResponse.text()).toBe(true);
  const results = await resultsResponse.json();

  for (const attempt of attempts) {
    const row = results.rows.find(
      (result: { memberOneFirstName: string }) =>
        result.memberOneFirstName === attempt.firstName,
    );
    expect(row).toMatchObject({
      totalScore: attempt.totalScore,
      correctCount: attempt.correctCount,
      answeredCount: attempt.answeredCount,
    });
  }

  await api.dispose();
});

test("scores the standard 15-task Bebras distribution from zero to 180", async () => {
  const api = await request.newContext();
  const headers = await loginAdmin(api);
  const standardTasks = [];

  for (const scoring of SCORING_TASKS) {
    standardTasks.push(scoring);
    for (let copy = 1; copy < 5; copy += 1) {
      standardTasks.push(
        await createScoringTask(api, headers, scoring.difficulty, copy),
      );
    }
  }

  const contest = await createContest(api, headers, {
    tasks: standardTasks.map(({ taskId }) => ({ taskId })),
  });
  expect(contest.initialScores[contest.categories[0]]).toBe(45);
  expect(contest.tasks).toHaveLength(15);
  expect(
    contest.tasks.reduce(
      (counts: Record<string, number>, task: { difficulty: string }) => ({
        ...counts,
        [task.difficulty]: (counts[task.difficulty] ?? 0) + 1,
      }),
      {},
    ),
  ).toEqual({ easy: 5, medium: 5, hard: 5 });

  await submitScoringAttempt(
    api,
    headers,
    contest.id,
    standardTasks,
    "Maximo",
    () => "B",
  );
  await submitScoringAttempt(
    api,
    headers,
    contest.id,
    standardTasks,
    "Piso",
    () => "A",
  );
  await submitScoringAttempt(
    api,
    headers,
    contest.id,
    standardTasks,
    "Mixto",
    (index) => {
      const positionWithinDifficulty = index % 5;
      return positionWithinDifficulty < 2
        ? "B"
        : positionWithinDifficulty < 4
          ? "A"
          : null;
    },
  );

  const resultsResponse = await api.get(
    `${API}/api/contests/${contest.id}/results`,
    { headers },
  );
  expect(resultsResponse.ok(), await resultsResponse.text()).toBe(true);
  const results = await resultsResponse.json();
  const expectedResults = [
    { memberOneFirstName: "Maximo", totalScore: 180, answeredCount: 15 },
    { memberOneFirstName: "Piso", totalScore: 0, answeredCount: 15 },
    { memberOneFirstName: "Mixto", totalScore: 81, answeredCount: 12 },
  ];

  for (const expectedResult of expectedResults) {
    expect(results.rows).toContainEqual(
      expect.objectContaining(expectedResult),
    );
  }

  await api.dispose();
});

test("breaks equal-score ties by elapsed time", async () => {
  const api = await request.newContext();
  const headers = await loginAdmin(api);
  const contest = await createContest(api, headers);
  const slowerCode = await joinContest(
    api,
    headers,
    contest.id,
    contest.picked.grade,
    "Lento",
  );
  const fasterCode = await joinContest(
    api,
    headers,
    contest.id,
    contest.picked.grade,
    "Rapido",
  );

  const slowerStart = await api.post(`${API}/api/play/start`, {
    data: { personalCode: slowerCode },
  });
  expect(slowerStart.ok(), await slowerStart.text()).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 250));

  const fasterStart = await api.post(`${API}/api/play/start`, {
    data: { personalCode: fasterCode },
  });
  expect(fasterStart.ok(), await fasterStart.text()).toBe(true);
  const fasterSubmit = await api.post(`${API}/api/play/submit`, {
    data: { personalCode: fasterCode },
  });
  expect(fasterSubmit.ok(), await fasterSubmit.text()).toBe(true);

  const slowerSubmit = await api.post(`${API}/api/play/submit`, {
    data: { personalCode: slowerCode },
  });
  expect(slowerSubmit.ok(), await slowerSubmit.text()).toBe(true);

  const resultsResponse = await api.get(
    `${API}/api/contests/${contest.id}/results`,
    { headers },
  );
  expect(resultsResponse.ok(), await resultsResponse.text()).toBe(true);
  const results = await resultsResponse.json();
  const faster = results.rows.find(
    (row: { memberOneFirstName: string }) =>
      row.memberOneFirstName === "Rapido",
  );
  const slower = results.rows.find(
    (row: { memberOneFirstName: string }) => row.memberOneFirstName === "Lento",
  );

  expect(faster.totalScore).toBe(slower.totalScore);
  expect(faster.elapsedSeconds).toBeLessThanOrEqual(slower.elapsedSeconds);
  expect(faster.rankPosition).toBe(1);
  expect(slower.rankPosition).toBe(2);

  await api.dispose();
});
