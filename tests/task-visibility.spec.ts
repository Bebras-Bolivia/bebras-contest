import { test, expect } from "@playwright/test";
import {
  API,
  createApprovedTeacher,
  createPracticeTask,
  loginAdmin,
} from "./support/helpers";

test("cada nivel de visibilidad decide quién ve la tarea", async ({ request }) => {
  const adminHeaders = await loginAdmin(request);
  const teacher = await createApprovedTeacher(request, adminHeaders);
  const task = await createPracticeTask(request, adminHeaders, "multiple_choice");

  const setVisibility = async (visibility: string) => {
    const response = await request.patch(`${API}/api/tasks/${task.id}/visibility`, {
      headers: adminHeaders,
      data: { visibility },
    });
    return response;
  };
  const inPublicPractice = async () =>
    (await request.get(`${API}/api/practice/tasks/${task.id}`)).status() === 200;
  const forTeacherPractices = async () => {
    const list = (await request
      .get(`${API}/api/practices/tasks?category=Titi`, { headers: teacher.headers })
      .then((r) => r.json())) as { tasks: Array<{ id: string }> };
    return list.tasks.some((item) => item.id === task.id);
  };

  expect((await setVisibility("cualquiera")).status()).toBe(400);

  const practice = await setVisibility("practica");
  expect(await practice.json()).toMatchObject({ isPractice: true, forTeachers: false });
  expect(await inPublicPractice()).toBe(true);
  expect(await forTeacherPractices()).toBe(true);

  const teachers = await setVisibility("maestros");
  expect(await teachers.json()).toMatchObject({ isPractice: false, forTeachers: true });
  expect(await inPublicPractice()).toBe(false);
  expect(await forTeacherPractices()).toBe(true);

  const privateOnly = await setVisibility("privada");
  expect(await privateOnly.json()).toMatchObject({ isPractice: false, forTeachers: false });
  expect(await inPublicPractice()).toBe(false);
  expect(await forTeacherPractices()).toBe(false);

  const asTeacher = await request.patch(`${API}/api/tasks/${task.id}/visibility`, {
    headers: teacher.headers,
    data: { visibility: "practica" },
  });
  expect(asTeacher.status()).toBe(403);
});

test("las prácticas del maestro solo ofrecen tareas con dificultad para la categoría", async ({
  request,
}) => {
  const adminHeaders = await loginAdmin(request);
  const teacher = await createApprovedTeacher(request, adminHeaders);
  const titiOnly = await createPracticeTask(request, adminHeaders, "short_text", {
    difficulties: { "10–12": "hard" },
  });

  const titi = (await request
    .get(`${API}/api/practices/tasks?category=Titi`, { headers: teacher.headers })
    .then((r) => r.json())) as { ageRange: string; tasks: Array<{ id: string; difficulty: string }> };
  expect(titi.ageRange).toBe("10–12");
  expect(titi.tasks.find((item) => item.id === titiOnly.id)?.difficulty).toBe("hard");

  const kuntur = (await request
    .get(`${API}/api/practices/tasks?category=Kuntur`, { headers: teacher.headers })
    .then((r) => r.json())) as { tasks: Array<{ id: string }> };
  expect(kuntur.tasks.some((item) => item.id === titiOnly.id)).toBe(false);

  const invalid = await request.get(`${API}/api/practices/tasks?category=Nadie`, {
    headers: teacher.headers,
  });
  expect(invalid.status()).toBe(400);
});
