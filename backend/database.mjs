import { DatabaseSync } from "node:sqlite";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { courseBlueprint } from "./course-data.mjs";
import { createPasswordHash } from "./auth.mjs";
import { ensureDirectory, normalizeStoredFilePath } from "./storage.mjs";

export async function createDatabaseStore(config, { fileStore } = {}) {
  if (config.databaseUrl) {
    return createPostgresStore(config, { fileStore });
  }
  return createSqliteStore(config, { fileStore });
}

async function createSqliteStore(config, { fileStore }) {
  const databasePath = resolve(configRoot(), config.databaseFile);
  await ensureDirectory(dirname(databasePath));
  await ensureDirectory(resolve(configRoot(), config.storageDir));

  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schemaSql());

  const executor = createSqliteExecutor(db);
  await seedIfNeeded(executor, config, fileStore);
  await migrateStoredResourcePaths(executor);

  return buildStore(executor);
}

async function createPostgresStore(config, { fileStore }) {
  const { Pool } = await import("pg");
  const pool = new Pool({
    connectionString: config.databaseUrl,
    ssl: resolvePgSslMode(config.databaseSslMode)
  });

  const executor = createPostgresExecutor(pool);
  await executor.exec(schemaSql());
  await seedIfNeeded(executor, config, fileStore);
  await migrateStoredResourcePaths(executor);

  return buildStore(executor, async () => pool.end());
}

function buildStore(executor, close = async () => undefined) {
  return {
    db: executor.db,
    close,
    getBootstrap: (userId) => buildBootstrap(executor, userId),
    findUserByUsername: (username) => executor.one("SELECT * FROM users WHERE username = ?", [username]),
    findUserById: (userId) => executor.one("SELECT * FROM users WHERE id = ?", [userId]),
    createSession: async (userId, expiresAt) => {
      const token = randomUUID();
      await executor.run(
        "INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
        [token, userId, expiresAt, nowIso()]
      );
      return token;
    },
    getSession: (token) => executor.one("SELECT * FROM sessions WHERE token = ? AND expires_at > ?", [token, nowIso()]),
    deleteSession: (token) => executor.run("DELETE FROM sessions WHERE token = ?", [token]),
    getCourse: () => executor.one("SELECT * FROM courses LIMIT 1"),
    createUserAccount: async ({ username, role = "student" }) => {
      const trimmedUsername = String(username || "").trim();
      if (!trimmedUsername) {
        throw new Error("用户名不能为空");
      }
      const exists = await executor.one("SELECT id FROM users WHERE username = ?", [trimmedUsername]);
      if (exists) {
        throw new Error("用户名已存在");
      }
      const id = randomUUID();
      const now = nowIso();
      await executor.run(
        "INSERT INTO users (id, username, password_hash, display_name, role, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        [id, trimmedUsername, createPasswordHash(`${trimmedUsername}123`), trimmedUsername, role, now]
      );
      return executor.one("SELECT id, username, display_name, role, created_at FROM users WHERE id = ?", [id]);
    },
    getLessons: () => executor.many("SELECT * FROM lessons ORDER BY lesson_no ASC"),
    getLessonById: (lessonId) => executor.one("SELECT * FROM lessons WHERE id = ?", [lessonId]),
    getLessonResources: (lessonId) => executor.many("SELECT * FROM resources WHERE lesson_id = ? ORDER BY created_at DESC", [lessonId]),
    getResourceById: (resourceId) => executor.one("SELECT * FROM resources WHERE id = ?", [resourceId]),
    getSubmissionByLessonAndUser: (lessonId, userId) => executor.one(
      "SELECT * FROM submissions WHERE lesson_id = ? AND user_id = ? ORDER BY submitted_at DESC LIMIT 1",
      [lessonId, userId]
    ),
    getSubmissionByAttachmentResourceId: (resourceId) => executor.one(
      "SELECT * FROM submissions WHERE attachment_resource_id = ? ORDER BY submitted_at DESC LIMIT 1",
      [resourceId]
    ),
    getAllSubmissions: () => executor.many(submissionListSql()),
    getSubmissionsByLesson: (lessonId) => executor.many(submissionListSql("WHERE submissions.lesson_id = ?"), [lessonId]),
    getSubmissionsByUser: (userId) => executor.many(submissionListSql("WHERE submissions.user_id = ?"), [userId]),
    listAccessLogs: (limit = 24) => executor.many(`
      SELECT access_logs.*, users.display_name AS user_display_name, resources.original_name AS resource_name
      FROM access_logs
      LEFT JOIN users ON users.id = access_logs.user_id
      LEFT JOIN resources ON resources.id = access_logs.resource_id
      ORDER BY access_logs.created_at DESC
      LIMIT ?
    `, [limit]),
    createResource: async ({ lessonId, kind, label, originalName, mimeType, filePath, fileSize, uploadedBy, submissionId = null }) => {
      const id = randomUUID();
      await executor.run(`
        INSERT INTO resources (id, lesson_id, submission_id, kind, label, original_name, mime_type, file_path, file_size, uploaded_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [id, lessonId, submissionId, kind, label, originalName, mimeType, filePath, fileSize, uploadedBy, nowIso()]);
      return executor.one("SELECT * FROM resources WHERE id = ?", [id]);
    },
    updateLessonResource: async ({ lessonId, kind, resourceId }) => {
      if (kind === "video") {
        await executor.run("UPDATE lessons SET video_resource_id = ?, updated_at = ? WHERE id = ?", [resourceId, nowIso(), lessonId]);
      }
      if (kind === "handout") {
        await executor.run("UPDATE lessons SET handout_resource_id = ?, updated_at = ? WHERE id = ?", [resourceId, nowIso(), lessonId]);
      }
    },
    deleteResource: async (resourceId) => {
      const resource = await executor.one("SELECT * FROM resources WHERE id = ?", [resourceId]);
      if (!resource) {
        return null;
      }
      await executor.transaction(async (tx) => {
        await tx.run("DELETE FROM resources WHERE id = ?", [resourceId]);
        if (resource.kind === "video" || resource.kind === "handout") {
          const nextResource = await tx.one(
            `
              SELECT id
              FROM resources
              WHERE lesson_id = ? AND kind = ?
              ORDER BY created_at DESC
              LIMIT 1
            `,
            [resource.lesson_id, resource.kind]
          );
          const fieldName = resource.kind === "video" ? "video_resource_id" : "handout_resource_id";
          await tx.run(`UPDATE lessons SET ${fieldName} = ?, updated_at = ? WHERE id = ?`, [nextResource?.id || null, nowIso(), resource.lesson_id]);
        }
      });
      return resource;
    },
    upsertAssignment: async ({ lessonId, title, content, deadlineAt, publishedBy }) => {
      await executor.run(`
        UPDATE lessons
        SET assignment_title = ?, assignment_content = ?, assignment_deadline_at = ?, assignment_published_by = ?, assignment_published_at = ?, updated_at = ?
        WHERE id = ?
      `, [title, content, deadlineAt || null, publishedBy, nowIso(), nowIso(), lessonId]);
      return executor.one("SELECT * FROM lessons WHERE id = ?", [lessonId]);
    },
    clearAssignment: async (lessonId) => {
      await executor.run(`
        UPDATE lessons
        SET assignment_title = '', assignment_content = '', assignment_deadline_at = NULL, assignment_published_by = NULL, assignment_published_at = NULL, updated_at = ?
        WHERE id = ?
      `, [nowIso(), lessonId]);
      return executor.one("SELECT * FROM lessons WHERE id = ?", [lessonId]);
    },
    createSubmission: async ({ lessonId, userId, content, attachmentResourceId }) => {
      const id = randomUUID();
      await executor.transaction(async (tx) => {
        await tx.run(`
          INSERT INTO submissions (id, lesson_id, user_id, content, attachment_resource_id, status, created_at, updated_at, submitted_at)
          VALUES (?, ?, ?, ?, ?, 'submitted', ?, ?, ?)
        `, [id, lessonId, userId, content, attachmentResourceId || null, nowIso(), nowIso(), nowIso()]);
        if (attachmentResourceId) {
          await tx.run("UPDATE resources SET submission_id = ? WHERE id = ?", [id, attachmentResourceId]);
        }
      });
      return executor.one("SELECT * FROM submissions WHERE id = ?", [id]);
    },
    logAccess: ({ userId, resourceId, action, detail }) => executor.run(`
      INSERT INTO access_logs (id, user_id, resource_id, action, detail, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [randomUUID(), userId || null, resourceId, action, detail || null, nowIso()])
  };
}

function createSqliteExecutor(db) {
  const executor = {
    db,
    async exec(sql) {
      db.exec(sql);
    },
    async one(sql, params = []) {
      return db.prepare(sql).get(...params) || null;
    },
    async many(sql, params = []) {
      return db.prepare(sql).all(...params);
    },
    async run(sql, params = []) {
      return db.prepare(sql).run(...params);
    },
    async transaction(callback) {
      db.exec("BEGIN");
      try {
        const result = await callback(executor);
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }
  };
  return executor;
}

function createPostgresExecutor(pool) {
  const executor = {
    db: pool,
    async exec(sql) {
      await pool.query(sql);
    },
    async one(sql, params = []) {
      const result = await pool.query(convertSql(sql), params);
      return result.rows[0] || null;
    },
    async many(sql, params = []) {
      const result = await pool.query(convertSql(sql), params);
      return result.rows;
    },
    async run(sql, params = []) {
      return pool.query(convertSql(sql), params);
    },
    async transaction(callback) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const tx = {
          db: pool,
          exec: async (sql) => client.query(sql),
          one: async (sql, params = []) => {
            const result = await client.query(convertSql(sql), params);
            return result.rows[0] || null;
          },
          many: async (sql, params = []) => {
            const result = await client.query(convertSql(sql), params);
            return result.rows;
          },
          run: async (sql, params = []) => client.query(convertSql(sql), params),
          transaction: async (nestedCallback) => nestedCallback(tx)
        };
        const result = await callback(tx);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
  };
  return executor;
}

async function seedIfNeeded(executor, config, fileStore) {
  const courseCountRow = await executor.one("SELECT COUNT(*) AS count FROM courses");
  if (Number(courseCountRow?.count || 0) > 0) {
    return;
  }
  if (!fileStore) {
    throw new Error("初始化数据需要可用的文件存储");
  }

  const now = nowIso();
  const course = courseBlueprint.course;

  await executor.transaction(async (tx) => {
    await tx.run(
      "INSERT INTO courses (id, title, subtitle, banner_note, created_at) VALUES (?, ?, ?, ?, ?)",
      [course.id, course.title, course.subtitle, course.bannerNote, now]
    );

    const adminId = randomUUID();
    const studentId = randomUUID();
    await tx.run(
      "INSERT INTO users (id, username, password_hash, display_name, role, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [adminId, "admin", createPasswordHash("admin123"), "课程管理员", "admin", now]
    );
    await tx.run(
      "INSERT INTO users (id, username, password_hash, display_name, role, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [studentId, "student", createPasswordHash("student123"), "示例学员", "student", now]
    );

    for (const lesson of courseBlueprint.lessons) {
      const lessonId = randomUUID();
      await tx.run(`
        INSERT INTO lessons (
          id, course_id, lesson_no, title, date_label, summary,
          assignment_title, assignment_content, assignment_deadline_at,
          assignment_published_by, assignment_published_at,
          video_resource_id, handout_resource_id, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        lessonId,
        course.id,
        lesson.lessonNo,
        lesson.title,
        lesson.dateLabel,
        lesson.summary,
        lesson.assignmentTitle,
        lesson.assignmentContent,
        null,
        adminId,
        now,
        null,
        null,
        now
      ]);

      const uploaded = await fileStore.saveContent({
        originalName: `第${lesson.lessonNo}节-讲义.md`,
        mimeType: "text/markdown",
        buffer: Buffer.from(lesson.handoutBody, "utf8")
      });
      const handoutResourceId = randomUUID();
      await tx.run(`
        INSERT INTO resources (id, lesson_id, submission_id, kind, label, original_name, mime_type, file_path, file_size, uploaded_by, created_at)
        VALUES (?, ?, NULL, 'handout', ?, ?, ?, ?, ?, ?, ?)
      `, [
        handoutResourceId,
        lessonId,
        lesson.handoutTitle,
        `第${lesson.lessonNo}节-讲义.md`,
        uploaded.mimeType,
        uploaded.filePath,
        uploaded.size,
        adminId,
        now
      ]);
      await tx.run("UPDATE lessons SET handout_resource_id = ?, updated_at = ? WHERE id = ?", [handoutResourceId, now, lessonId]);
    }
  });
}

async function migrateStoredResourcePaths(executor) {
  const rows = await executor.many("SELECT id, file_path FROM resources ORDER BY created_at ASC");
  for (const row of rows) {
    const normalizedPath = normalizeStoredFilePath(row.file_path);
    if (normalizedPath && normalizedPath !== row.file_path) {
      await executor.run("UPDATE resources SET file_path = ? WHERE id = ?", [normalizedPath, row.id]);
    }
  }
}

async function buildBootstrap(executor, userId) {
  const course = await executor.one("SELECT * FROM courses LIMIT 1");
  const lessons = await executor.many(`
    SELECT
      lessons.*,
      video.original_name AS video_original_name,
      video.mime_type AS video_mime_type,
      handout.original_name AS handout_original_name,
      handout.mime_type AS handout_mime_type
    FROM lessons
    LEFT JOIN resources AS video ON video.id = lessons.video_resource_id
    LEFT JOIN resources AS handout ON handout.id = lessons.handout_resource_id
    ORDER BY lessons.lesson_no ASC
  `);
  const user = userId ? await executor.one("SELECT id, username, display_name, role FROM users WHERE id = ?", [userId]) : null;
  const submissions = userId
    ? (user?.role === "admin"
      ? await executor.many(submissionListSql())
      : await executor.many(submissionListSql("WHERE submissions.user_id = ?"), [userId]))
    : [];
  const accessLogs = user?.role === "admin"
    ? await executor.many(`
      SELECT access_logs.*, users.display_name AS user_display_name, resources.original_name AS resource_name
      FROM access_logs
      LEFT JOIN users ON users.id = access_logs.user_id
      LEFT JOIN resources ON resources.id = access_logs.resource_id
      ORDER BY access_logs.created_at DESC
      LIMIT 20
    `)
    : [];

  return {
    course,
    lessons: lessons.map((lesson) => ({
      ...lesson,
      videoResource: lesson.video_resource_id ? {
        id: lesson.video_resource_id,
        originalName: lesson.video_original_name,
        mimeType: lesson.video_mime_type
      } : null,
      handoutResource: lesson.handout_resource_id ? {
        id: lesson.handout_resource_id,
        originalName: lesson.handout_original_name,
        mimeType: lesson.handout_mime_type
      } : null
    })),
    user,
    submissions,
    accessLogs
  };
}

function submissionListSql(whereClause = "") {
  return `
    SELECT
      submissions.*,
      users.display_name AS user_display_name,
      users.username AS user_username,
      lessons.lesson_no,
      lessons.title AS lesson_title,
      lessons.date_label,
      attachment.original_name AS attachment_original_name,
      attachment.mime_type AS attachment_mime_type
    FROM submissions
    JOIN users ON users.id = submissions.user_id
    JOIN lessons ON lessons.id = submissions.lesson_id
    LEFT JOIN resources AS attachment ON attachment.id = submissions.attachment_resource_id
    ${whereClause ? `${whereClause}` : ""}
    ORDER BY submissions.submitted_at DESC
  `;
}

function schemaSql() {
  return `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS courses (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      subtitle TEXT NOT NULL,
      banner_note TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS lessons (
      id TEXT PRIMARY KEY,
      course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      lesson_no INTEGER NOT NULL,
      title TEXT NOT NULL,
      date_label TEXT NOT NULL,
      summary TEXT NOT NULL,
      assignment_title TEXT NOT NULL,
      assignment_content TEXT NOT NULL,
      assignment_deadline_at TEXT,
      assignment_published_by TEXT,
      assignment_published_at TEXT,
      video_resource_id TEXT,
      handout_resource_id TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS resources (
      id TEXT PRIMARY KEY,
      lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
      submission_id TEXT,
      kind TEXT NOT NULL,
      label TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      uploaded_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY,
      lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      attachment_resource_id TEXT REFERENCES resources(id) ON DELETE SET NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      submitted_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS access_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      resource_id TEXT NOT NULL,
      action TEXT NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL
    );
  `;
}

function convertSql(sql) {
  let index = 0;
  return String(sql).replace(/\?/g, () => `$${++index}`);
}

function resolvePgSslMode(mode) {
  const normalized = String(mode || "").trim().toLowerCase();
  if (!normalized || normalized === "require") {
    return { rejectUnauthorized: false };
  }
  if (normalized === "disable") {
    return false;
  }
  return { rejectUnauthorized: false };
}

function configRoot() {
  return resolve(import.meta.dirname, "..");
}

function nowIso() {
  return new Date().toISOString();
}
