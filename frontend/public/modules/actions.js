import { createApi } from "./api.js";
import { FLASH_MESSAGE_TIMEOUT_MS, applyBootstrap, resetPreviewState, resetSelectionState, resetSessionState, state } from "./state.js";
import { guessMimeType, persistSidebarPreference, readFileAsDataUrl, readSidebarPreference } from "./utils.js";
import { configureRenderer, findResourceById, isTextPreviewResource, render, renderMarkdownDocument, syncPendingFilePreviewUI } from "./render.js";

let flashMessageTimer = null;
let api = null;

export function initializeApp({ appElement, apiBaseUrl }) {
  api = createApi(apiBaseUrl);
  configureRenderer({ appElement, apiClient: api });
  state.sidebarCollapsed = readSidebarPreference();
  bindGlobalEvents();
}

export async function boot() {
  const me = await api.apiGet("/api/auth/me").catch(() => ({ user: null }));
  state.me = me.user;
  if (state.me) {
    state.activePage = state.me.role === "admin" ? "admin" : "student";
    await loadBootstrap();
  }
  render();
}

export async function loadBootstrap() {
  const data = await api.apiGet("/api/bootstrap");
  applyBootstrap(data);
}

export function setFlashMessage(message, timeoutMs = FLASH_MESSAGE_TIMEOUT_MS) {
  state.message = message ? String(message) : "";
  if (flashMessageTimer) {
    window.clearTimeout(flashMessageTimer);
    flashMessageTimer = null;
  }
  if (!state.message || timeoutMs <= 0) {
    return;
  }
  flashMessageTimer = window.setTimeout(() => {
    state.message = "";
    flashMessageTimer = null;
    render();
  }, timeoutMs);
}

function bindGlobalEvents() {
  document.addEventListener("submit", async (event) => {
    const form = event.target;
    if (form instanceof HTMLFormElement && form.id === "loginForm") {
      event.preventDefault();
      await runAction(() => login());
    }
  });

  document.addEventListener("change", async (event) => {
    const element = event.target;
    if (element instanceof HTMLInputElement && element.type === "file" && element.id.startsWith("file-")) {
      const match = element.id.match(/^file-(video|handout)-(.+)$/);
      if (!match) {
        return;
      }
      const [, kind, lessonId] = match;
      const file = element.files?.[0] || null;
      state.pendingFileNameMap[buildPendingFileKey(kind, lessonId)] = file?.name || "";
      syncPendingFilePreviewUI(element, kind, file?.name || "");
      if (!file) {
        return;
      }
      await runAction(() => uploadResource(lessonId, kind), `${kind === "video" ? "视频" : "课件"}上传失败`);
    }
  });

  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");
    if (!(button instanceof HTMLElement)) return;
    const action = button.dataset.action;
    await dispatchAction(event, button, action);
  });
}

async function dispatchAction(event, button, action) {
  const handlers = {
    login: () => login(),
    logout: () => logout(),
    "switch-page": () => {
      state.activePage = button.dataset.page;
      render();
    },
    "select-lesson": () => {
      state.activeLessonId = button.dataset.lessonId;
      resetSelectionState();
      render();
    },
    "select-admin-lesson": () => {
      state.adminLessonId = button.dataset.lessonId;
      resetSelectionState();
      render();
    },
    "switch-student-tab": () => {
      state.studentTab = button.dataset.tab;
      render();
    },
    "toggle-sidebar": () => {
      state.sidebarCollapsed = !state.sidebarCollapsed;
      persistSidebarPreference(state.sidebarCollapsed);
      render();
    },
    "trigger-file-input": () => {
      event.preventDefault();
      const inputId = button.dataset.inputId;
      const input = inputId ? document.getElementById(inputId) : null;
      if (input instanceof HTMLInputElement) {
        input.click();
      }
    },
    "upload-resource": () => {
      event.preventDefault();
      return uploadResource(button.dataset.lessonId, button.dataset.kind);
    },
    "delete-resource": () => {
      event.preventDefault();
      return deleteResource(button.dataset.lessonId, button.dataset.resourceId);
    },
    "publish-assignment": () => {
      event.preventDefault();
      return publishAssignment(button.dataset.lessonId);
    },
    "delete-assignment": () => {
      event.preventDefault();
      return deleteAssignment(button.dataset.lessonId);
    },
    "submit-homework": () => {
      event.preventDefault();
      return submitHomework(button.dataset.lessonId);
    },
    "add-user-permission": () => {
      event.preventDefault();
      return addUserPermission();
    },
    refresh: () => {
      event.preventDefault();
      return refreshBootstrap();
    },
    "preview-resource": () => {
      event.preventDefault();
      return openPreview(button.dataset.resourceId || null);
    },
    "download-resource": () => {
      window.open(button.dataset.url, "_blank", "noopener,noreferrer");
    },
    "close-preview": () => {
      event.preventDefault();
      resetPreviewState();
      render();
    }
  };

  const handler = handlers[action];
  if (!handler) {
    return;
  }
  await runAction(handler);
}

async function runAction(callback, fallbackMessage = "操作失败") {
  try {
    await callback();
  } catch (error) {
    console.error(error);
    setFlashMessage(error.message || fallbackMessage);
    render();
  }
}

async function login() {
  const username = document.querySelector("#loginUsername")?.value.trim();
  const password = document.querySelector("#loginPassword")?.value;
  if (!username || !password) {
    setFlashMessage("请输入账号和密码");
    render();
    return;
  }
  const result = await api.apiPost("/api/auth/login", { username, password });
  state.me = result.user;
  await loadBootstrap();
  state.activePage = state.me.role === "admin" ? "admin" : "student";
  setFlashMessage("登录成功");
  render();
}

async function logout() {
  await api.apiPost("/api/auth/logout", {});
  resetSessionState();
  setFlashMessage("已退出登录");
  render();
}

async function addUserPermission() {
  const username = window.prompt("请输入要添加权限的用户名");
  const trimmedUsername = username?.trim();
  if (username == null) {
    return;
  }
  if (!trimmedUsername) {
    setFlashMessage("请输入用户名");
    render();
    return;
  }
  const result = await api.apiPost("/api/admin/users", { username: trimmedUsername });
  window.alert(`用户已添加\n用户名：${result.user.username}\n默认密码：${result.defaultPassword}`);
  setFlashMessage(`用户已添加，默认密码为 ${result.defaultPassword}`);
  render();
}

async function uploadResource(lessonId, kind) {
  const input = document.querySelector(`#file-${kind}-${lessonId}`);
  const labelInput = document.querySelector(`#label-${kind}-${lessonId}`);
  if (!(input instanceof HTMLInputElement) || !input.files?.length) {
    setFlashMessage("请选择要上传的文件");
    render();
    return;
  }
  const file = input.files[0];
  const base64Data = await readFileAsDataUrl(file);
  await api.apiPost(`/api/admin/lessons/${lessonId}/resources`, {
    kind,
    label: labelInput?.value?.trim() || (kind === "video" ? "课程视频" : "课程讲义"),
    originalName: file.name,
    mimeType: resolveUploadMimeType(file),
    base64Data
  });
  input.value = "";
  if (labelInput) {
    labelInput.value = "";
  }
  state.pendingFileNameMap[buildPendingFileKey(kind, lessonId)] = "";
  await loadBootstrap();
  state.activeLessonId = lessonId;
  state.adminLessonId = lessonId;
  setFlashMessage(`${kind === "video" ? "视频" : "课件"}上传成功`);
  render();
}

async function deleteResource(lessonId, resourceId) {
  if (!resourceId) {
    return;
  }
  if (!window.confirm("确定删除这个资源吗？删除后无法恢复。")) {
    return;
  }
  await api.apiDelete(`/api/admin/resources/${resourceId}`);
  await loadBootstrap();
  state.activeLessonId = lessonId;
  state.adminLessonId = lessonId;
  resetSelectionState();
  setFlashMessage("资源已删除");
  render();
}

async function publishAssignment(lessonId) {
  const content = document.querySelector(`#assignment-content-${lessonId}`)?.value.trim();
  const lesson = state.bootstrap?.lessons?.find((item) => item.id === lessonId);
  const title = lesson?.assignmentTitle?.trim() || `第${lesson?.lessonNo || ""}节作业`;
  const deadlineAt = lesson?.assignmentDeadlineAt || null;
  if (!content) {
    setFlashMessage("请填写作业内容");
    render();
    return;
  }
  await api.apiPost(`/api/admin/lessons/${lessonId}/assignment`, {
    title,
    content,
    deadlineAt
  });
  await loadBootstrap();
  state.activeLessonId = lessonId;
  state.adminLessonId = lessonId;
  setFlashMessage("作业已发布");
  render();
}

async function deleteAssignment(lessonId) {
  if (!window.confirm("确定删除当前作业吗？")) {
    return;
  }
  await api.apiDelete(`/api/admin/lessons/${lessonId}/assignment`);
  await loadBootstrap();
  state.activeLessonId = lessonId;
  state.adminLessonId = lessonId;
  setFlashMessage("作业已删除");
  render();
}

async function submitHomework(lessonId) {
  const content = document.querySelector(`#submission-content-${lessonId}`)?.value.trim();
  const fileInput = document.querySelector(`#submission-file-${lessonId}`);
  let attachment = null;
  if (fileInput instanceof HTMLInputElement && fileInput.files?.length) {
    const file = fileInput.files[0];
    attachment = {
      originalName: file.name,
      mimeType: resolveUploadMimeType(file),
      base64Data: await readFileAsDataUrl(file),
      label: "作业附件"
    };
  }
  if (!content && !attachment) {
    setFlashMessage("请填写作业内容或上传附件");
    render();
    return;
  }
  await api.apiPost(`/api/lessons/${lessonId}/submissions`, { content, attachment });
  await loadBootstrap();
  state.activeLessonId = lessonId;
  setFlashMessage("作业提交成功");
  render();
}

async function refreshBootstrap() {
  await loadBootstrap();
  resetSelectionState();
  render();
}

function buildPendingFileKey(kind, lessonId) {
  return `${kind}:${lessonId}`;
}

function resolveUploadMimeType(file) {
  const mimeType = String(file?.type || "").trim().toLowerCase();
  if (!mimeType || mimeType === "application/octet-stream") {
    return guessMimeType(file?.name || "");
  }
  return file.type;
}

async function openPreview(resourceId) {
  if (!resourceId) {
    return;
  }
  const resource = findResourceById(resourceId);
  if (!resource) {
    return;
  }
  state.previewResourceId = resourceId;
  state.previewContentHtml = "";
  state.previewError = "";
  const needsTextRender = isTextPreviewResource(resource);
  state.previewLoading = needsTextRender;
  render();
  if (!needsTextRender) {
    return;
  }
  try {
    const text = await api.fetchResourceText(resource.id);
    if (state.previewResourceId !== resource.id) {
      return;
    }
    state.previewContentHtml = renderMarkdownDocument(text);
    state.previewLoading = false;
    render();
  } catch (error) {
    if (state.previewResourceId !== resource.id) {
      return;
    }
    state.previewLoading = false;
    state.previewError = error.message || "预览加载失败";
    render();
  }
}
