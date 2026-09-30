"""Borra de la D1 local los desafíos creados por la prueba de estrés.

    python tests/estres/limpiar.py

Solo toca desafíos cuyo nombre empieza con «Prueba de estrés». Borra en orden
(respuestas, resultados, intentos, estudiantes, grupos, preguntas, desafío)
para no depender de que SQLite tenga activadas las claves foráneas.
"""

import glob
import sqlite3

databases = [
    path
    for path in glob.glob(".wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite")
    if not path.endswith("metadata.sqlite")
]

for path in databases:
    connection = sqlite3.connect(path)
    ids = [
        row[0]
        for row in connection.execute(
            "SELECT id FROM Contest WHERE title LIKE 'Prueba de estrés%'"
        )
    ]
    for contest_id in ids:
        teams = "SELECT t.id FROM Team t JOIN ContestGroup g ON g.id = t.groupId WHERE g.contestId = ?"
        attempts = f"SELECT id FROM Attempt WHERE teamId IN ({teams})"
        connection.execute(f"DELETE FROM AttemptAnswer WHERE attemptId IN ({attempts})", (contest_id,))
        connection.execute(f"DELETE FROM Result WHERE attemptId IN ({attempts})", (contest_id,))
        connection.execute(f"DELETE FROM Attempt WHERE teamId IN ({teams})", (contest_id,))
        connection.execute(f"DELETE FROM Team WHERE id IN ({teams})", (contest_id,))
        connection.execute("DELETE FROM ContestGroup WHERE contestId = ?", (contest_id,))
        connection.execute("DELETE FROM ContestTask WHERE contestId = ?", (contest_id,))
        connection.execute('DELETE FROM "RosterImportLock" WHERE contestId = ?', (contest_id,))
        connection.execute("DELETE FROM Contest WHERE id = ?", (contest_id,))
    connection.commit()
    print(f"{path}: {len(ids)} desafío(s) de prueba borrados")
