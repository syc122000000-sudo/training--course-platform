import { createServer } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { extname, resolve } from "node:path";
import { verifyPassword } from "../backend/auth.mjs";
import { loadAppConfig } from "../backend/config.mjs";
import { createDatabaseStore } from "../backend/database.mjs";
import { createFileStore, resolveStoredFilePath } from "../backend/storage.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const publicRoot = resolve(projectRoot, "frontend", "public");
const config = await loadAppConfig();
const localStorageRoot = resolve(projectRoot, config.storageDir);
const fileStore = await createFileStore(config);
await fileStore.init();
const store = await createDatabaseStore(config, { fileStore });

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

const server = createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    console.error(error);
    if (!res.headersSent) {
      sendJson(req, res, 500, { error: error.message || "服务异常" });
    } else {
      res.end();
    }
  });
});

const port = Number(process.env.PORT || config.port || 3230);
server.listen(port, () => {
  console.log(`Training course platform running at http://127.0.0.1:${port}`);
});

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

async function shutdown() {
  server.close();
  try {
    await store.close?.();
  } catch {
    // Ignore shutdown errors.
  }
  process.exit(0);
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
  const pathname = decodeURIComponent(url.pathname);

  if (pathname.startsWith("/api/")) {
    return handleApi(req, res, url, pathname);
  }

  return serveStatic(req, res, pathname);
}

async function handleApi(req, res, url, pathname) {
  const user = await getCurrentUser(req);

  if (req.method === "OPTIONS") {
    return sendCorsPreflight(res, req);
  }

  if (req.method === "GET" && pathname === "/api/health") {
    return sendJson(req, res, 200, { ok: true });
  }

  if (req.method === "GET" && pathname === "/api/auth/me") {
    return sendJson(req, res, 200, { user: sanitizeUser(user) });
  }

  if (req.method === "POST" && pathname === "/api/auth/login") {
    const body = await readJsonBody(req);
    const { username, password } = body;
    const account = await store.findUserByUsername(String(username || "").trim());
    if (!account || !verifyPassword(String(password || ""), account.password_hash)) {
      return sendJson(req, res, 401, { error: "账号或密码错误" });
    }
    const expiresAt = new Date(Date.now() + Number(config.sessionDays || 7) * 24 * 60 * 60 * 1000).toISOString();
    const token = await store.createSession(account.id, expiresAt);
    setCookie(res, "training_platform_session", token, {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: Number(config.sessionDays || 7) * 24 * 60 * 60
    });
    return sendJson(req, res, 200, { user: sanitizeUser(account) });
  }

  if (req.method === "POST" && pathname === "/api/auth/logout") {
    const token = getCookie(req, "training_platform_session");
    if (token) {
      await store.deleteSession(token);
    }
    setCookie(res, "training_platform_session", "", { httpOnly: true, sameSite: "Lax", path: "/", maxAge: 0 });
    return sendJson(req, res, 200, { ok: true });
  }

  if (req.method === "GET" && pathname === "/api/bootstrap") {
    if (!user) {
      return sendJson(req, res, 401, { error: "未登录" });
    }
    return sendJson(req, res, 200, await enrichBootstrap(await store.getBootstrap(user.id), user));
  }

  if (req.method === "GET" && pathname === "/api/courses/current") {
    if (!user) {
      return sendJson(req, res, 401, { error: "未登录" });
    }
    return sendJson(req, res, 200, await enrichBootstrap(await store.getBootstrap(user.id), user));
  }

  if (req.method === "POST" && pathname === "/api/admin/users") {
    if (!isAdmin(user)) {
      return sendJson(req, res, 403, { error: "无管理员权限" });
    }
    const body = await readJsonBody(req);
    const username = String(body.username || "").trim();
    if (!username) {
      return sendJson(req, res, 400, { error: "请输入用户名" });
    }
    const created = await store.createUserAccount({ username, role: "student" });
    return sendJson(req, res, 200, {
      user: {
        id: created.id,
        username: created.username,
        displayName: created.display_name,
        role: created.role
      },
      defaultPassword: `${username}123`
    });
  }

  const lessonMatch = pathname.match(/^\/api\/lessons\/([^/]+)$/);
  if (req.method === "GET" && lessonMatch) {
    if (!user) {
      return sendJson(req, res, 401, { error: "未登录" });
    }
    const lesson = await enrichLesson(await store.getLessonById(lessonMatch[1]), user);
    if (!lesson) {
      return sendJson(req, res, 404, { error: "课节不存在" });
    }
    return sendJson(req, res, 200, lesson);
  }

  const resourceMatch = pathname.match(/^\/api\/resources\/([^/]+)$/);
  if (req.method === "GET" && resourceMatch) {
    if (!user) {
      return sendJson(req, res, 401, { error: "未登录" });
    }
    const resource = await store.getResourceById(resourceMatch[1]);
    if (!resource) {
      return sendJson(req, res, 404, { error: "资源不存在" });
    }
    return streamResource(req, res, user, resource, url.searchParams.get("download") === "1");
  }

  const lessonResourceUploadMatch = pathname.match(/^\/api\/admin\/lessons\/([^/]+)\/resources$/);
  if (req.method === "POST" && lessonResourceUploadMatch) {
    if (!isAdmin(user)) {
      return sendJson(req, res, 403, { error: "无管理员权限" });
    }
    const lessonId = lessonResourceUploadMatch[1];
    const body = await readJsonBody(req);
    const kind = String(body.kind || "");
    if (!["video", "handout"].includes(kind)) {
      return sendJson(req, res, 400, { error: "资源类型仅支持 video 或 handout" });
    }
    const uploaded = await fileStore.saveBase64Upload({
      originalName: body.originalName,
      mimeType: body.mimeType,
      base64Data: body.base64Data
    });
    const resource = await store.createResource({
      lessonId,
      kind,
      label: String(body.label || (kind === "video" ? "课程视频" : "课程讲义")),
      originalName: uploaded.originalName,
      mimeType: uploaded.mimeType,
      filePath: uploaded.filePath,
      fileSize: uploaded.size,
      uploadedBy: user.id
    });
    await store.updateLessonResource({ lessonId, kind, resourceId: resource.id });
    return sendJson(req, res, 200, { resource, lesson: await store.getLessonById(lessonId) });
  }

  const adminResourceMatch = pathname.match(/^\/api\/admin\/resources\/([^/]+)$/);
  if (req.method === "DELETE" && adminResourceMatch) {
    if (!isAdmin(user)) {
      return sendJson(req, res, 403, { error: "无管理员权限" });
    }
    const resource = await store.deleteResource(adminResourceMatch[1]);
    if (!resource) {
      return sendJson(req, res, 404, { error: "资源不存在" });
    }
    await fileStore.removeStoredFile(resource.file_path).catch((error) => {
      console.warn("Failed to remove file after resource deletion", error);
    });
    return sendJson(req, res, 200, { ok: true, resourceId: resource.id });
  }

  const assignmentMatch = pathname.match(/^\/api\/admin\/lessons\/([^/]+)\/assignment$/);
  if (req.method === "POST" && assignmentMatch) {
    if (!isAdmin(user)) {
      return sendJson(req, res, 403, { error: "无管理员权限" });
    }
    const lessonId = assignmentMatch[1];
    const body = await readJsonBody(req);
    const lesson = await store.upsertAssignment({
      lessonId,
      title: String(body.title || ""),
      content: String(body.content || ""),
      deadlineAt: body.deadlineAt ? String(body.deadlineAt) : null,
      publishedBy: user.id
    });
    return sendJson(req, res, 200, { lesson });
  }
  if (req.method === "DELETE" && assignmentMatch) {
    if (!isAdmin(user)) {
      return sendJson(req, res, 403, { error: "无管理员权限" });
    }
    const lessonId = assignmentMatch[1];
    const lesson = await store.clearAssignment(lessonId);
    return sendJson(req, res, 200, { lesson });
  }

  const submitMatch = pathname.match(/^\/api\/lessons\/([^/]+)\/submissions$/);
  if (req.method === "POST" && submitMatch) {
    if (!user) {
      return sendJson(req, res, 401, { error: "未登录" });
    }
    const lessonId = submitMatch[1];
    const body = await readJsonBody(req);
    const content = String(body.content || "").trim();
    if (!content && !body.attachment) {
      return sendJson(req, res, 400, { error: "提交内容不能为空" });
    }
    let attachmentResourceId = null;
    if (body.attachment?.base64Data) {
      const uploaded = await fileStore.saveBase64Upload({
        originalName: body.attachment.originalName,
        mimeType: body.attachment.mimeType,
        base64Data: body.attachment.base64Data
      });
      const attachment = await store.createResource({
        lessonId,
        kind: "submission_attachment",
        label: body.attachment.label || "作业附件",
        originalName: uploaded.originalName,
        mimeType: uploaded.mimeType,
        filePath: uploaded.filePath,
        fileSize: uploaded.size,
        uploadedBy: user.id
      });
      attachmentResourceId = attachment.id;
    }
    const submission = await store.createSubmission({
      lessonId,
      userId: user.id,
      content,
      attachmentResourceId
    });
    return sendJson(req, res, 200, { submission });
  }

  if (req.method === "GET" && pathname === "/api/me/submissions") {
    if (!user) {
      return sendJson(req, res, 401, { error: "未登录" });
    }
    return sendJson(req, res, 200, { submissions: await store.getSubmissionsByUser(user.id) });
  }

  const adminSubmissionsMatch = pathname.match(/^\/api\/admin\/submissions$/);
  if (req.method === "GET" && adminSubmissionsMatch) {
    if (!isAdmin(user)) {
      return sendJson(req, res, 403, { error: "无管理员权限" });
    }
    const lessonId = url.searchParams.get("lessonId");
    const submissions = lessonId ? await store.getSubmissionsByLesson(lessonId) : await collectAllSubmissions();
    return sendJson(req, res, 200, { submissions });
  }

  if (req.method === "GET" && pathname === "/api/admin/access-logs") {
    if (!isAdmin(user)) {
      return sendJson(req, res, 403, { error: "无管理员权限" });
    }
    return sendJson(req, res, 200, { logs: await store.listAccessLogs(40) });
  }

  return sendJson(req, res, 404, { error: "未找到接口" });
}

async function serveStatic(req, res, pathname) {
  const requestPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = resolve(publicRoot, `.${requestPath}`);
  if (!filePath.startsWith(publicRoot)) {
    return sendJson(req, res, 403, { error: "禁止访问" });
  }
  if (!existsSync(filePath)) {
    return sendJson(req, res, 404, { error: "页面不存在" });
  }
  const extension = extname(filePath).toLowerCase();
  const mimeType = MIME_TYPES[extension] || "application/octet-stream";
  const fileStream = createReadStream(filePath);
  res.writeHead(200, {
    "content-type": mimeType,
    "cache-control": "no-store"
  });
  fileStream.pipe(res);
}

async function enrichBootstrap(bootstrap, user) {
  const lessons = await Promise.all(bootstrap.lessons.map((lesson) => enrichLesson(lesson, user)));
  const currentLessonId = lessons[0]?.id || null;
  const currentLesson = currentLessonId ? lessons[0] : null;
  const submissions = bootstrap.submissions.map((submission) => normalizeSubmission(submission));
  const accessLogs = bootstrap.accessLogs || [];
  return {
    user: sanitizeUser(user),
    course: bootstrap.course,
    lessons,
    currentLessonId,
    currentLesson,
    submissions,
    accessLogs
  };
}

async function enrichLesson(lesson, user) {
  if (!lesson) {
    return null;
  }
  const currentSubmission = user ? await store.getSubmissionByLessonAndUser(lesson.id, user.id) : null;
  const resources = (await store.getLessonResources(lesson.id)).map((resource) => normalizeResource(resource));
  return {
    id: lesson.id,
    courseId: lesson.course_id,
    lessonNo: lesson.lesson_no,
    title: lesson.title,
    dateLabel: lesson.date_label,
    summary: lesson.summary,
    assignmentTitle: lesson.assignment_title,
    assignmentContent: lesson.assignment_content,
    assignmentDeadlineAt: lesson.assignment_deadline_at,
    assignmentPublishedAt: lesson.assignment_published_at,
    videoResourceId: lesson.video_resource_id,
    handoutResourceId: lesson.handout_resource_id,
    videoResource: lesson.video_resource_id ? normalizeResource(await store.getResourceById(lesson.video_resource_id)) : null,
    handoutResource: lesson.handout_resource_id ? normalizeResource(await store.getResourceById(lesson.handout_resource_id)) : null,
    resources,
    mySubmission: currentSubmission ? normalizeSubmission(currentSubmission) : null,
    submissionCount: user && user.role === "admin" ? (await store.getSubmissionsByLesson(lesson.id)).length : null
  };
}

function normalizeSubmission(submission) {
  return {
    id: submission.id,
    lessonId: submission.lesson_id,
    lessonNo: submission.lesson_no || null,
    lessonTitle: submission.lesson_title || null,
    content: submission.content,
    attachmentResourceId: submission.attachment_resource_id,
    attachmentOriginalName: submission.attachment_original_name || null,
    attachmentMimeType: submission.attachment_mime_type || null,
    userDisplayName: submission.user_display_name || null,
    userUsername: submission.user_username || null,
    status: submission.status,
    createdAt: submission.created_at,
    updatedAt: submission.updated_at,
    submittedAt: submission.submitted_at
  };
}

function normalizeResource(resource) {
  if (!resource) {
    return null;
  }
  return {
    id: resource.id,
    lessonId: resource.lesson_id,
    submissionId: resource.submission_id,
    kind: resource.kind,
    label: resource.label,
    originalName: resource.original_name,
    mimeType: resource.mime_type,
    fileSize: resource.file_size,
    uploadedBy: resource.uploaded_by,
    createdAt: resource.created_at
  };
}

async function collectAllSubmissions() {
  return (await store.getAllSubmissions()).map((submission) => normalizeSubmission(submission));
}

async function streamResource(req, res, user, resource, download) {
  const allowed = await canAccessResource(user, resource);
  if (!allowed) {
    return sendJson(req, res, 403, { error: "无权访问该资源" });
  }
  const fileData = await fileStore.openStoredFile(resource.file_path);
  const range = req.headers.range;
  const mimeType = resource.mime_type || "application/octet-stream";
  const headers = {
    "content-type": mimeType,
    "accept-ranges": "bytes",
    "cache-control": "no-store",
    ...corsHeaders(req)
  };

  const dispositionName = encodeRFC5987(resource.original_name);
  headers["content-disposition"] = `${download ? "attachment" : "inline"}; filename*=UTF-8''${dispositionName}`;

  if (range) {
    const [startRaw, endRaw] = range.replace(/bytes=/, "").split("-");
    const start = Number(startRaw);
    const end = endRaw ? Number(endRaw) : fileData.size - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start < 0) {
      res.writeHead(416, {
        "content-range": `bytes */${fileData.size}`
      });
      return res.end();
    }
    headers["content-range"] = `bytes ${start}-${end}/${fileData.size}`;
    headers["content-length"] = end - start + 1;
    if (fileStore.provider !== "local") {
      headers["accept-ranges"] = "none";
      delete headers["content-range"];
      headers["content-length"] = fileData.size;
      res.writeHead(200, headers);
      await store.logAccess({ userId: user.id, resourceId: resource.id, action: "inline_read", detail: "range_downgraded" });
      return fileData.stream.pipe(res);
    }
    res.writeHead(206, headers);
    await store.logAccess({ userId: user.id, resourceId: resource.id, action: "range_read", detail: `${start}-${end}` });
    const resourcePath = resolveStoredFilePath(localStorageRoot, resource.file_path);
    return createReadStream(resourcePath, { start, end }).pipe(res);
  }

  headers["content-length"] = fileData.size;
  res.writeHead(200, headers);
  await store.logAccess({ userId: user.id, resourceId: resource.id, action: download ? "download" : "inline_read", detail: null });
  return fileData.stream.pipe(res);
}

async function canAccessResource(user, resource) {
  if (!user) return false;
  if (user.role === "admin") return true;
  if (resource.kind === "submission_attachment") {
    const submission = await store.getSubmissionByAttachmentResourceId(resource.id);
    return submission?.user_id === user.id;
  }
  return true;
}

function isAdmin(user) {
  return Boolean(user && user.role === "admin");
}

async function getCurrentUser(req) {
  const token = getCookie(req, "training_platform_session");
  if (!token) {
    return null;
  }
  const session = await store.getSession(token);
  if (!session) {
    return null;
  }
  return store.findUserById(session.user_id);
}

function sanitizeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    role: user.role
  };
}

function getCookie(req, key) {
  const raw = req.headers.cookie || "";
  const value = raw.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${key}=`));
  return value ? decodeURIComponent(value.slice(key.length + 1)) : "";
}

function setCookie(res, key, value, options = {}) {
  const segments = [`${key}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) segments.push(`Max-Age=${options.maxAge}`);
  if (options.path) segments.push(`Path=${options.path}`);
  if (options.httpOnly) segments.push("HttpOnly");
  if (options.sameSite) segments.push(`SameSite=${options.sameSite}`);
  if (options.secure) segments.push("Secure");
  res.setHeader("Set-Cookie", segments.join("; "));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8") || "{}";
  return JSON.parse(raw);
}

function sendJson(req, res, statusCode, payload) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...corsHeaders(req)
  });
  res.end(JSON.stringify(payload));
}

function sendCorsPreflight(res, req) {
  res.writeHead(204, {
    ...corsHeaders(req),
    "access-control-max-age": "600"
  });
  res.end();
}

function corsHeaders(req = null) {
  const origin = req?.headers?.origin;
  const headers = {
    "access-control-allow-credentials": "true",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type"
  };
  if (origin) {
    headers["access-control-allow-origin"] = origin;
    headers["vary"] = "origin";
  }
  return headers;
}

function encodeRFC5987(value) {
  return encodeURIComponent(value)
    .replace(/['()]/g, escape)
    .replace(/\*/g, "%2A");
}
