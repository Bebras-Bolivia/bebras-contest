import json
import hashlib
import pathlib
import re
import sqlite3
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
MIGRATIONS = sorted((ROOT / 'backend/migrations').glob('*.sql'))
CLEANUP = [file for file in MIGRATIONS if file.name.startswith(('0014_', '0015_'))]


def baseline():
    db = sqlite3.connect(':memory:')
    db.execute('PRAGMA foreign_keys = ON')
    for file in MIGRATIONS:
        if file.name < '0014':
            db.executescript(file.read_text(encoding='utf-8'))
    return db


def insert(db, table, **values):
    for column in db.execute(f'PRAGMA table_info("{table}")'):
        _, name, kind, required, default, primary = column
        if name not in values and default is None and (required or primary):
            values[name] = 1 if kind == 'INTEGER' else '2026-10-05' if kind == 'DATETIME' else 'fixture'
    columns = ', '.join('"' + key + '"' for key in values)
    db.execute(f'INSERT INTO "{table}" ({columns}) VALUES ({", ".join("?" for _ in values)})', tuple(values.values()))


def fixtures(db):
    insert(db, 'User', id=1, email='admin@example.test', role='admin')
    insert(db, 'User', id=2, email='teacher@example.test', role='maestro', status='suspended')
    insert(db, 'User', id=100, email='deleted@example.test')
    db.execute('DELETE FROM User WHERE id=100')
    insert(db, 'TeacherSchool', id='school', userId=2, status='rejected')
    insert(db, 'TaskDraft', id='task', answers='[]', category='["Algoritmos"]', answerConfig='{}', answerKey='{}')
    insert(db, 'Contest', id='contest', createdById=1, categories='["8–10"]', scoring='{"custom":true}', questionDisplayMode='all')
    insert(db, 'ContestTask', id='question', contestId='contest', taskDraftId='task', position=1)
    insert(db, 'RosterImportLock', contestId='contest', owner='owner')
    insert(db, 'ContestGroup', id='group', contestId='contest', createdById=2, accessCode='GROUP', category='8–10')
    insert(db, 'ContestGroup', id='unowned', contestId='contest', createdById=None, accessCode='NULL')
    for i, (status, mode) in enumerate([('pending', 'online'), ('in_progress', 'online'), ('finished', 'online'), ('finished', 'paper')]):
        insert(db, 'Team', id=f'team{i}', groupId='group', participationMode='pareja' if i % 2 else 'individual', personalCode=f'CODE{i}')
        insert(db, 'Attempt', id=f'attempt{i}', teamId=f'team{i}', status=status, mode=mode)
        insert(db, 'AttemptAnswer', id=f'answer{i}', attemptId=f'attempt{i}', taskDraftId='task', responsePayload='{"selected":["A"]}', score=12, isCorrect=1)
        insert(db, 'Result', id=f'result{i}', attemptId=f'attempt{i}', totalScore=12, rankPosition=i+1)
    db.commit()


def snapshot(db):
    tables = [row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
    return {table: sorted(db.execute(f'SELECT * FROM "{table}"').fetchall(), key=repr) for table in tables}


def apply(db, file):
    try:
        db.executescript('BEGIN;\n' + file.read_text(encoding='utf-8') + '\nCOMMIT;')
    except sqlite3.IntegrityError:
        db.rollback()
        raise


class CleanupMigrationTest(unittest.TestCase):
    def test_populated_database_and_constraints(self):
        db = baseline()
        fixtures(db)
        before = snapshot(db)
        indexes = set(db.execute("SELECT name, sql FROM sqlite_master WHERE type='index'"))
        columns = {table: db.execute(f'PRAGMA table_info("{table}")').fetchall() for table in before}
        foreign_keys = {table: db.execute(f'PRAGMA foreign_key_list("{table}")').fetchall() for table in before}
        for file in CLEANUP:
            apply(db, file)
            self.assertEqual(snapshot(db), before)
            self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(), [])
            self.assertTrue(indexes <= set(db.execute("SELECT name, sql FROM sqlite_master WHERE type='index'")))
            for table in before:
                self.assertEqual(db.execute(f'PRAGMA table_info("{table}")').fetchall(), columns[table])
                current_keys = db.execute(f'PRAGMA foreign_key_list("{table}")').fetchall()
                self.assertTrue({key[1:] for key in foreign_keys[table]} <= {key[1:] for key in current_keys})
        self.assertEqual(db.execute("SELECT seq FROM sqlite_sequence WHERE name='User'").fetchone()[0], 100)
        valid = {
            ('User', 'role'): ['admin', 'maestro'],
            ('User', 'status'): ['pending', 'approved', 'rejected', 'suspended'],
            ('TeacherSchool', 'status'): ['pending', 'approved', 'rejected'],
            ('Team', 'status'): ['registered'],
            ('Team', 'participationMode'): ['individual', 'pareja'],
            ('Attempt', 'status'): ['pending', 'in_progress', 'finished'],
            ('Attempt', 'mode'): ['online', 'paper'],
            ('Contest', 'questionDisplayMode'): ['one_by_one', 'all'],
        }
        for (table, column), values in valid.items():
            for value in values:
                db.execute(f'UPDATE "{table}" SET "{column}"=?', (value,))
            with self.assertRaises(sqlite3.IntegrityError):
                db.execute(f'UPDATE "{table}" SET "{column}"=?', ('invalid',))
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute('UPDATE ContestGroup SET createdById=999')
        db.execute('DELETE FROM User WHERE id=2')
        self.assertEqual(db.execute("SELECT createdById FROM ContestGroup WHERE id='group'").fetchone(), (None,))
        for table in ['ContestGroup', 'Team', 'Attempt', 'AttemptAnswer', 'Result']:
            self.assertEqual(db.execute(f'SELECT count(*) FROM "{table}"').fetchone()[0], len(before[table]))
        self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(), [])

    def test_invalid_domain_rolls_back(self):
        db = baseline()
        fixtures(db)
        db.execute("UPDATE User SET role='teacher'")
        db.commit()
        before = snapshot(db)
        with self.assertRaises(sqlite3.IntegrityError):
            apply(db, next(file for file in MIGRATIONS if file.name.startswith('0014')))
        self.assertEqual(snapshot(db), before)

    def test_empty_user_table_retains_autoincrement(self):
        db = baseline()
        insert(db, 'User', id=100, email='deleted@example.test')
        db.execute('DELETE FROM User')
        db.commit()
        for file in CLEANUP:
            apply(db, file)
        db.execute("INSERT INTO User (email, updatedAt) VALUES ('new@example.test', CURRENT_TIMESTAMP)")
        self.assertEqual(db.execute('SELECT id FROM User').fetchone()[0], 101)

    def test_orphan_creator_rolls_back(self):
        db = baseline()
        fixtures(db)
        apply(db, next(file for file in MIGRATIONS if file.name.startswith('0014')))
        db.execute('UPDATE ContestGroup SET createdById=999')
        db.commit()
        before = snapshot(db)
        with self.assertRaises(sqlite3.IntegrityError):
            apply(db, next(file for file in MIGRATIONS if file.name.startswith('0015')))
        self.assertEqual(snapshot(db), before)


if __name__ == '__main__':
    if len(sys.argv) == 4 and sys.argv[1] == '--local-snapshot':
        db = sqlite3.connect(sys.argv[2])
        rows = snapshot(db)
        rows.pop('d1_migrations', None)
        rows.pop('_cf_METADATA', None)
        hashes = {table: {'count': len(data), 'sha256': hashlib.sha256(repr(data).encode()).hexdigest()} for table, data in rows.items()}
        pathlib.Path(sys.argv[3]).write_text(json.dumps(hashes, sort_keys=True, indent=2), encoding='utf-8')
    elif len(sys.argv) == 3 and sys.argv[1] == '--fixture-sql':
        db = baseline()
        fixtures(db)
        db.execute('UPDATE User SET id=90001 WHERE id=1')
        db.execute('UPDATE User SET id=90002 WHERE id=2')
        db.execute('UPDATE ContestGroup SET createdById=90002 WHERE createdById=2')
        order = ['User', 'TeacherSchool', 'TaskDraft', 'Contest', 'ContestTask', 'RosterImportLock', 'ContestGroup', 'Team', 'Attempt', 'AttemptAnswer', 'Result']
        lines = [line for line in db.iterdump() if line.startswith('INSERT INTO') and 'sqlite_sequence' not in line]
        lines.sort(key=lambda line: order.index(re.search(r'INSERT INTO "([^"]+)"', line)[1]))
        pathlib.Path(sys.argv[2]).write_text('\n'.join(lines), encoding='utf-8')
    elif len(sys.argv) == 3:
        assert len(CLEANUP) == 2
        db = baseline()
        tasks = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
        for task in tasks:
            insert(db, 'TaskDraft', **task)
        db.commit()
        before = snapshot(db)
        for file in CLEANUP:
            apply(db, file)
            assert snapshot(db) == before
        db.row_factory = sqlite3.Row
        pathlib.Path(sys.argv[2]).write_text(json.dumps([dict(row) for row in db.execute('SELECT * FROM TaskDraft ORDER BY id')]), encoding='utf-8')
    else:
        unittest.main()
