import { state } from "./state.js";
import { escapeAttr, escapeHtml, formatTime } from "./utils.js";

let appRoot = null;
let api = null;

export function configureRenderer({ appElement, apiClient }) {
  appRoot = appElement;
  api = apiClient;
}

export function render() {
  if (!state.me) {
    appRoot.innerHTML = renderLogin();
    return;
  }
  if (!state.bootstrap) {
    appRoot.innerHTML = renderLoading();
    return;
  }
  appRoot.innerHTML = renderShell();
}

export function renderError(message) {
  appRoot.innerHTML = `<main class="loading-state error-state">${escapeHtml(message)}</main>`;
}

export function currentLessonData() {
  return state.bootstrap.lessons.find((lesson) => lesson.id === state.activeLessonId) || state.bootstrap.lessons[0];
}

export function adminLessonData() {
  return state.bootstrap.lessons.find((lesson) => lesson.id === state.adminLessonId) || state.bootstrap.lessons[0];
}

export function apiCacheSubmissions(lessonId) {
  return (state.bootstrap.submissions || [])
    .filter((submission) => submission.lessonId === lessonId)
    .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
}

export function findResourceById(resourceId) {
  for (const lesson of state.bootstrap?.lessons || []) {
    for (const resource of lesson.resources || []) {
      if (resource.id === resourceId) {
        return resource;
      }
    }
    if (lesson.videoResource?.id === resourceId) return lesson.videoResource;
    if (lesson.handoutResource?.id === resourceId) return lesson.handoutResource;
  }
  return null;
}

export function isTextPreviewResource(resource) {
  const mimeType = resource.mimeType || "";
  const name = (resource.originalName || "").toLowerCase();
  return mimeType.startsWith("text/") || name.endsWith(".md") || name.endsWith(".txt");
}

export function renderMarkdownDocument(text) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let inList = false;
  let inCode = false;

  const flushList = () => {
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line.startsWith("```")) {
      if (inCode) {
        html.push("</code></pre>");
        inCode = false;
      } else {
        flushList();
        html.push("<pre><code>");
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      html.push(`${escapeHtml(line)}\n`);
      continue;
    }
    if (!line.trim()) {
      flushList();
      html.push("<p></p>");
      continue;
    }
    if (/^#{1,6}\s+/.test(line)) {
      flushList();
      const level = line.match(/^#{1,6}/)?.[0].length || 1;
      html.push(`<h${level}>${formatInlineMarkdown(line.replace(/^#{1,6}\s+/, ""))}</h${level}>`);
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${formatInlineMarkdown(line.replace(/^[-*]\s+/, ""))}</li>`);
      continue;
    }
    flushList();
    html.push(`<p>${formatInlineMarkdown(line)}</p>`);
  }

  flushList();
  if (inCode) {
    html.push("</code></pre>");
  }
  return html.join("").replaceAll("<p></p>", '<p class="preview-empty-line"></p>');
}

function formatInlineMarkdown(text) {
  const escaped = escapeHtml(text);
  return escaped
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>");
}

function renderLogin() {
  return `
    <main class="login-shell">
      <section class="login-card">
        <div class="login-hero">
          <h1 class="login-hero-title">
            <span>上岸仓培训</span>
            <span>课程收录平台</span>
          </h1>
        </div>
        <div class="login-panel">
          <div class="login-panel-head">
            <h2>登录平台</h2>
            <p>请输入账号和密码继续</p>
          </div>
          <form id="loginForm" class="login-form">
            <label class="field">
              <span>账号</span>
              <input id="loginUsername" type="text" autocomplete="username" placeholder="请输入账号" />
            </label>
            <label class="field">
              <span>密码</span>
              <input id="loginPassword" type="password" autocomplete="current-password" placeholder="请输入密码" />
            </label>
            <button class="primary-button" type="submit">登录平台</button>
          </form>
          ${state.message ? `<p class="form-note">${escapeHtml(state.message)}</p>` : ""}
        </div>
      </section>
    </main>
  `;
}

function renderLoading() {
  return `<main class="loading-state">正在加载课程数据...</main>`;
}

function renderShell() {
  return `
    <div class="page-shell">
      <header class="topbar">
        <div class="topbar-left">
          <span class="brand-mark">上</span>
          <div class="title-block title-block-compact">
            <h1>上岸仓培训课程收录平台</h1>
          </div>
        </div>
        <div class="topbar-right">
          <span class="status-pill">${escapeHtml(state.me.displayName)} · ${state.me.role === "admin" ? "管理员" : "学员"}</span>
          ${state.me.role === "admin" ? `<button class="ghost-button" data-action="add-user-permission" type="button">添加用户权限</button>` : ""}
          <button class="ghost-button" data-action="logout" type="button">退出</button>
        </div>
      </header>

      ${state.activePage === "admin" && state.me.role === "admin" ? renderAdminView() : renderStudentView()}
      ${state.message ? `<div class="toast">${escapeHtml(state.message)}</div>` : ""}
      ${renderPreviewModal()}
    </div>
  `;
}

function renderStudentView() {
  const currentLesson = currentLessonData();
  const hasAssignment = Boolean(currentLesson.assignmentTitle?.trim() || currentLesson.assignmentContent?.trim());
  return `
    <main class="portal-grid student-grid ${state.sidebarCollapsed ? "sidebar-collapsed" : ""}">
      <aside class="course-list panel">
        <div class="panel-head">
          <div>
            <h2>课程目录</h2>
          </div>
          <button class="ghost-button small" data-action="toggle-sidebar" type="button">${state.sidebarCollapsed ? "展开" : "收起"}</button>
        </div>
        <div class="lesson-stack">
          ${state.bootstrap.lessons.map((lesson) => {
            const active = lesson.id === state.activeLessonId;
            return `
              <button class="lesson-item ${active ? "active" : ""}" data-action="select-lesson" data-lesson-id="${lesson.id}" title="${escapeAttr(`${lesson.title} · ${lesson.dateLabel}`)}" type="button">
                <span class="lesson-no">${lesson.lessonNo}</span>
                <span class="lesson-copy">
                  <strong>${escapeHtml(lesson.title)}</strong>
                  <span>${escapeHtml(lesson.dateLabel)}</span>
                </span>
              </button>
            `;
          }).join("")}
        </div>
      </aside>

      <section class="center-stage">
        <article class="panel video-panel">
          <div class="panel-head">
            <div>
              <h2>第${escapeHtml(String(currentLesson.lessonNo))}节 · ${escapeHtml(currentLesson.title)}</h2>
            </div>
          </div>
          ${renderVideoBlock(currentLesson)}
        </article>

        <article class="panel tabs-panel">
          <div class="panel-head">
            <div>
              <h2>课程资料</h2>
              <p>在讲义与课后作业之间切换查看</p>
            </div>
          </div>
          <div class="tab-bar">
            <button class="tab-button ${state.studentTab === "handout" ? "active" : ""}" data-action="switch-student-tab" data-tab="handout" type="button">课程讲义</button>
            <button class="tab-button ${state.studentTab === "homework" ? "active" : ""}" data-action="switch-student-tab" data-tab="homework" type="button">课后作业</button>
          </div>
          <div class="tab-panel ${state.studentTab === "handout" ? "active" : ""}">
            ${renderResourceList(currentLesson.handoutResource ? [currentLesson.handoutResource] : [])}
          </div>
          <div class="tab-panel ${state.studentTab === "homework" ? "active" : ""}">
            ${hasAssignment ? `
              <div class="content-head">
                <div>
                  <h3>${escapeHtml(currentLesson.assignmentTitle)}</h3>
                  <p>${currentLesson.assignmentDeadlineAt ? `截止 ${escapeHtml(currentLesson.assignmentDeadlineAt)}` : "无截止时间"}</p>
                </div>
                <div class="meta-chip">作业提交区</div>
              </div>
              <p class="copy-block">${escapeHtml(currentLesson.assignmentContent)}</p>
              <div class="submission-box">
                <label class="field">
                  <span>提交内容</span>
                  <textarea id="submission-content-${currentLesson.id}" rows="6" placeholder="输入作业内容"></textarea>
                </label>
                <label class="field">
                  <span>作业附件</span>
                  <input id="submission-file-${currentLesson.id}" type="file" />
                </label>
                <div class="button-row">
                  <button class="primary-button" data-action="submit-homework" data-lesson-id="${currentLesson.id}" type="button">提交作业</button>
                </div>
              </div>
              ${renderMySubmission(currentLesson)}
            ` : `
              <div class="empty-box">当前课节暂无发布作业</div>
            `}
          </div>
        </article>
      </section>
    </main>
  `;
}

function renderAdminView() {
  const lesson = adminLessonData();
  const submissions = apiCacheSubmissions(lesson.id);
  return `
    <main class="admin-grid submissions-grid ${state.sidebarCollapsed ? "sidebar-collapsed" : ""}">
      <aside class="course-list panel">
        <div class="panel-head">
          <div>
            <h2>课程目录</h2>
          </div>
          <button class="ghost-button small" data-action="toggle-sidebar" type="button">${state.sidebarCollapsed ? "展开" : "收起"}</button>
        </div>
        <div class="lesson-stack">
          ${state.bootstrap.lessons.map((item) => {
            const active = item.id === state.adminLessonId;
            return `
              <button class="lesson-item ${active ? "active" : ""}" data-action="select-admin-lesson" data-lesson-id="${item.id}" title="${escapeAttr(`${item.title} · ${item.dateLabel}`)}" type="button">
                <span class="lesson-no">${item.lessonNo}</span>
                <span class="lesson-copy">
                  <strong>${escapeHtml(item.title)}</strong>
                  <span>${escapeHtml(item.dateLabel)}</span>
                </span>
              </button>
            `;
          }).join("")}
        </div>
      </aside>

      <section class="center-stage">
        <article class="panel admin-workspace">
          <div class="admin-workspace-head">
            <div class="admin-workspace-title">
              <span class="chapter-tag">当前章节</span>
              <h2>第${escapeHtml(String(lesson.lessonNo))}节 · ${escapeHtml(lesson.title)}</h2>
            </div>
          </div>

          <div class="admin-section-stack">
            ${renderAdminVideoSection(lesson)}
            ${renderAdminHandoutSection(lesson)}
            ${renderAdminAssignmentSection(lesson)}
            ${renderAdminSubmissionSection(submissions)}
          </div>
        </article>
      </section>
    </main>
  `;
}

function renderAdminVideoSection(lesson) {
  return `
    <section class="admin-section">
      <div class="admin-section-head">
        <div>
          <h3>上传视频</h3>
        </div>
      </div>
      <div class="admin-video-block">
        <input id="file-video-${lesson.id}" class="hidden-file-input" type="file" accept="video/*" />
        ${renderAdminVideoPicker(lesson)}
        ${lesson.videoResource ? `
          <div class="admin-video-footer">
            <div class="admin-file-caption">
              <span>当前视频</span>
              <strong>${escapeHtml(lesson.videoResource.originalName)}</strong>
            </div>
            <button class="ghost-button small" data-action="delete-resource" data-lesson-id="${lesson.id}" data-resource-id="${lesson.videoResource.id}" type="button">删除</button>
          </div>
        ` : ""}
      </div>
    </section>
  `;
}

function renderAdminHandoutSection(lesson) {
  const handoutResources = (lesson.resources || [])
    .filter((resource) => resource.kind === "handout")
    .slice()
    .sort((left, right) => {
      const leftTime = new Date(left.createdAt || left.created_at || 0).getTime();
      const rightTime = new Date(right.createdAt || right.created_at || 0).getTime();
      return leftTime - rightTime;
    });
  return `
    <section class="admin-section">
      <div class="admin-section-head admin-section-head-stack">
        <div class="admin-section-title-stack">
          <h3>上传课件</h3>
          <input id="file-handout-${lesson.id}" class="hidden-file-input" type="file" />
          <button class="ghost-button admin-file-picker-button" data-action="trigger-file-input" data-input-id="file-handout-${lesson.id}" type="button">选择文件</button>
        </div>
      </div>
      ${renderAdminResourceList(lesson, handoutResources)}
    </section>
  `;
}

function renderAdminAssignmentSection(lesson) {
  return `
    <section class="admin-section">
      <div class="admin-section-head">
        <div>
          <h3>作业发布</h3>
        </div>
      </div>
      <div class="admin-assignment-editor">
        <label class="field full-span">
          <textarea id="assignment-content-${lesson.id}" rows="5" placeholder="请输入作业内容">${escapeHtml(lesson.assignmentContent || "")}</textarea>
        </label>
      </div>
      <div class="button-row compact admin-assignment-actions">
        <button class="primary-button" data-action="publish-assignment" data-lesson-id="${lesson.id}" type="button">保存</button>
        <button class="ghost-button small" data-action="delete-assignment" data-lesson-id="${lesson.id}" type="button">删除</button>
      </div>
    </section>
  `;
}

function renderAdminSubmissionSection(submissions) {
  return `
    <section class="admin-section admin-submission-section">
      <div class="admin-section-head">
        <div>
          <h3>已提交作业</h3>
        </div>
      </div>
      ${renderAdminSubmissionTable(submissions)}
    </section>
  `;
}

function renderAdminSubmissionTable(submissions) {
  return `
    <div class="admin-submission-table">
      <div class="admin-submission-table-head">
        <span>序号</span>
        <span>提交人</span>
        <span>提交内容</span>
        <span>预览 ｜ 下载</span>
      </div>
      ${submissions.length ? submissions.map((submission, index) => {
        const attachmentResource = submission.attachmentResourceId ? findResourceById(submission.attachmentResourceId) : null;
        const submitterLabel = submission.userDisplayName || submission.userUsername || "";
        const submitterMeta = submission.userUsername && submission.userDisplayName && submission.userUsername !== submission.userDisplayName
          ? `@${submission.userUsername}`
          : "";
        return `
          <div class="admin-submission-table-row">
            <span class="admin-submission-seq">${escapeHtml(String(index + 1))}</span>
            <span class="admin-submission-user">
              ${submitterLabel ? `<strong>${escapeHtml(submitterLabel)}</strong>` : ""}
              ${submitterMeta ? `<span>${escapeHtml(submitterMeta)}</span>` : ""}
            </span>
            <span class="admin-submission-content">${escapeHtml(submission.content || "")}</span>
            <span class="admin-submission-actions">
              ${attachmentResource ? `
                <button class="admin-resource-link" data-action="preview-resource" data-resource-id="${attachmentResource.id}" type="button">预览</button>
                <span class="admin-resource-divider">|</span>
                <button class="admin-resource-link" data-action="download-resource" data-url="${api.resolveApiUrl(`/api/resources/${attachmentResource.id}?download=1`)}" type="button">下载</button>
              ` : `<span class="admin-submission-empty">无附件</span>`}
            </span>
          </div>
        `;
      }).join("") : `<div class="admin-submission-empty-row">暂无人提交</div>`}
    </div>
  `;
}

function renderVideoBlock(lesson) {
  if (lesson.videoResource) {
    return `
      <button class="video-frame video-cover-card" data-action="preview-resource" data-resource-id="${lesson.videoResource.id}" type="button">
        <video muted playsinline preload="metadata" src="${api.resolveApiUrl(`/api/resources/${lesson.videoResource.id}`)}"></video>
        <span class="video-cover-overlay">
          <span class="video-icon">▶</span>
        </span>
      </button>
    `;
  }
  return `
    <div class="video-empty">
      <span>暂未上传</span>
    </div>
  `;
}

function renderAdminVideoPicker(lesson) {
  if (lesson.videoResource) {
    return `
      <button class="admin-video-card has-video" data-action="preview-resource" data-resource-id="${lesson.videoResource.id}" type="button">
        <video class="admin-video-cover" muted playsinline preload="metadata" src="${api.resolveApiUrl(`/api/resources/${lesson.videoResource.id}`)}"></video>
        <span class="admin-video-overlay">
          <span class="admin-video-play">▶</span>
          <span>点击播放视频</span>
        </span>
      </button>
    `;
  }
  return `
    <label class="admin-video-card empty" for="file-video-${lesson.id}">
      <span class="admin-video-placeholder">+</span>
      <strong>选择视频</strong>
    </label>
  `;
}

export function syncPendingFilePreviewUI(input, kind, fileName) {
  const block = input.closest(".admin-video-block, .upload-card");
  if (!block) {
    return;
  }
  const caption = block.querySelector(".admin-file-caption strong");
  if (caption) {
    caption.textContent = fileName || "未选择视频";
  }
  if (kind === "video") {
    const prompt = block.querySelector(".admin-video-card.empty p");
    if (prompt) {
      prompt.textContent = fileName || "";
    }
  }
}

function renderAdminResourceList(lesson, resources) {
  if (!resources.length) {
    return `<div class="admin-resource-empty">暂未上传</div>`;
  }
  return `
    <div class="admin-resource-table">
      <div class="admin-resource-table-head">
        <span>序号</span>
        <span>文件名</span>
        <span>文件类型</span>
        <span>操作</span>
      </div>
      ${resources.map((resource, index) => `
        <div class="admin-resource-table-row">
          <span class="admin-resource-seq">${escapeHtml(String(index + 1))}</span>
          <span class="admin-resource-name" title="${escapeAttr(resource.originalName)}">${escapeHtml(resource.originalName)}</span>
          <span class="admin-resource-type">${escapeHtml(getResourceTypeLabel(resource))}</span>
          <span class="admin-resource-links">
            <button class="admin-resource-link" data-action="preview-resource" data-resource-id="${resource.id}" type="button">预览</button>
            <span class="admin-resource-divider">|</span>
            <button class="admin-resource-link danger" data-action="delete-resource" data-lesson-id="${lesson.id}" data-resource-id="${resource.id}" type="button">删除</button>
          </span>
        </div>
      `).join("")}
    </div>
  `;
}

function getResourceTypeLabel(resource) {
  const mimeType = String(resource?.mimeType || "").toLowerCase();
  const extension = String(resource?.originalName || "").split(".").pop()?.toLowerCase() || "";
  if (mimeType === "text/markdown" || extension === "md" || extension === "markdown") return "Markdown";
  if (mimeType === "application/pdf" || extension === "pdf") return "PDF";
  if (mimeType === "text/plain" || extension === "txt") return "TXT";
  if (mimeType.includes("wordprocessingml") || extension === "docx") return "DOCX";
  if (mimeType === "application/msword" || extension === "doc") return "DOC";
  if (mimeType.includes("presentation") || extension === "pptx") return "PPTX";
  if (mimeType === "application/vnd.ms-powerpoint" || extension === "ppt") return "PPT";
  if (mimeType.includes("sheet") || extension === "xlsx") return "XLSX";
  if (mimeType === "application/vnd.ms-excel" || extension === "xls") return "XLS";
  if (mimeType.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp"].includes(extension)) {
    return extension ? extension.toUpperCase() : "图片";
  }
  if (extension) return extension.toUpperCase();
  return "文件";
}

function renderResourceList(resources) {
  if (!resources.length) {
    return `<div class="empty-box">暂无资源</div>`;
  }
  return `
    <div class="resource-table">
      <div class="resource-table-head">
        <span>序号</span>
        <span>名称</span>
        <span>类型</span>
        <span>操作</span>
      </div>
      ${resources.map((resource, index) => `
        <div class="resource-table-row">
          <span class="resource-seq">${escapeHtml(String(index + 1))}</span>
          <span class="resource-name">
            <strong>${escapeHtml(resource.originalName)}</strong>
          </span>
          <span class="resource-type">${escapeHtml(getResourceTypeLabel(resource))}</span>
          <span class="resource-actions">
            <button class="ghost-button small" data-action="preview-resource" data-resource-id="${resource.id}" type="button">查看</button>
            <button class="ghost-button small" data-action="download-resource" data-url="${api.resolveApiUrl(`/api/resources/${resource.id}?download=1`)}" type="button">下载</button>
          </span>
        </div>
      `).join("")}
    </div>
  `;
}

function renderMySubmission(lesson) {
  const submission = state.bootstrap.submissions.find((item) => item.lessonId === lesson.id);
  if (!submission) return "";
  return `
    <div class="submission-history">
      <h3>最近一次提交</h3>
      <p>${escapeHtml(submission.content || "仅附件提交")}</p>
      <span>${formatTime(submission.submittedAt)}</span>
    </div>
  `;
}

function renderPreviewModal() {
  if (!state.previewResourceId) {
    return "";
  }
  const resource = findResourceById(state.previewResourceId);
  if (!resource) {
    return "";
  }
  return `
    <div class="preview-modal" role="dialog" aria-modal="true" aria-label="资源预览">
      <div class="preview-backdrop" data-action="close-preview"></div>
      <div class="preview-panel">
        <div class="preview-head">
          <div>
            <h2>${escapeHtml(resource.label || "资源预览")}</h2>
            <p>${escapeHtml(resource.originalName)}</p>
          </div>
          <div class="resource-actions">
            <button class="ghost-button small" data-action="download-resource" data-url="${api.resolveApiUrl(`/api/resources/${resource.id}`)}" type="button">新窗口打开</button>
            <button class="ghost-button small" data-action="download-resource" data-url="${api.resolveApiUrl(`/api/resources/${resource.id}?download=1`)}" type="button">下载</button>
            <button class="ghost-button small" data-action="close-preview" type="button">关闭</button>
          </div>
        </div>
        <div class="preview-body">
          ${state.previewLoading
            ? `<div class="empty-box preview-empty">正在加载预览...</div>`
            : state.previewError
              ? `<div class="empty-box preview-empty">${escapeHtml(state.previewError)}</div>`
              : state.previewContentHtml
                ? `<article class="preview-markdown">${state.previewContentHtml}</article>`
                : renderPreviewBody(resource)}
        </div>
      </div>
    </div>
  `;
}

function renderPreviewBody(resource) {
  const resourceUrl = api.resolveApiUrl(`/api/resources/${resource.id}`);
  const mimeType = String(resource.mimeType || "").toLowerCase();
  const extension = String(resource.originalName || "").split(".").pop()?.toLowerCase() || "";
  if (mimeType.startsWith("video/") || ["mp4", "webm", "mov"].includes(extension)) {
    return `<video class="preview-video" controls preload="metadata" src="${resourceUrl}"></video>`;
  }
  if (mimeType.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp"].includes(extension)) {
    return `<img class="preview-image" src="${resourceUrl}" alt="${escapeAttr(resource.originalName)}" />`;
  }
  if (mimeType === "application/pdf" || extension === "pdf") {
    return `<iframe class="preview-frame" src="${resourceUrl}" title="${escapeAttr(resource.originalName)}"></iframe>`;
  }
  return `
    <div class="empty-box preview-empty">
      当前文件类型暂不支持站内预览，请使用“新窗口打开”或“下载”查看。
    </div>
  `;
}
