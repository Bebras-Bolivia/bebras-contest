SELECT 'User.role' AS field, CAST(id AS TEXT) AS id, role AS value FROM User WHERE role NOT IN ('admin', 'maestro');
SELECT 'User.status' AS field, CAST(id AS TEXT) AS id, status AS value FROM User WHERE status NOT IN ('pending', 'approved', 'rejected', 'suspended');
SELECT 'TeacherSchool.status' AS field, id, status AS value FROM TeacherSchool WHERE status NOT IN ('pending', 'approved', 'rejected');
SELECT 'Team.status' AS field, id, status AS value FROM Team WHERE status NOT IN ('registered');
SELECT 'Team.participationMode' AS field, id, participationMode AS value FROM Team WHERE participationMode NOT IN ('individual', 'pareja');
SELECT 'Attempt.status' AS field, id, status AS value FROM Attempt WHERE status NOT IN ('pending', 'in_progress', 'finished');
SELECT 'Attempt.mode' AS field, id, mode AS value FROM Attempt WHERE mode NOT IN ('online', 'paper');
SELECT 'Contest.questionDisplayMode' AS field, id, questionDisplayMode AS value FROM Contest WHERE questionDisplayMode NOT IN ('one_by_one', 'all');
SELECT 'ContestGroup.createdById' AS field, id, CAST(createdById AS TEXT) AS value FROM ContestGroup WHERE createdById IS NOT NULL AND NOT EXISTS (SELECT 1 FROM User WHERE User.id = ContestGroup.createdById);

PRAGMA foreign_key_check;
