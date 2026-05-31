import { SIDEBAR_PREFERENCE_KEY } from "./state.js";

export function resolveApiUrl(path, apiBaseUrl) {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  return `${apiBaseUrl}${path}`;
}

export function getApiBaseUrl() {
  if (window.location.protocol === "file:") {
    return "http://127.0.0.1:3230";
  }
  return window.location.origin;
}

export function readSidebarPreference() {
  try {
    return window.localStorage.getItem(SIDEBAR_PREFERENCE_KEY) === "1";
  } catch {
    return false;
  }
}

export function persistSidebarPreference(collapsed) {
  try {
    window.localStorage.setItem(SIDEBAR_PREFERENCE_KEY, collapsed ? "1" : "0");
  } catch {
    // Ignore storage failures so the UI stays usable in restricted environments.
  }
}

export function handleResponse(response) {
  return response.json()
    .catch(() => ({}))
    .then((payload) => {
      if (!response.ok) {
        throw new Error(payload.error || `请求失败：${response.status}`);
      }
      return payload;
    });
}

export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("文件读取失败"));
    reader.readAsDataURL(file);
  });
}

export function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  return date.toLocaleString("zh-CN", { hour12: false });
}

export function formatDatetimeLocal(value) {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function guessMimeType(name) {
  const extension = name.split(".").pop()?.toLowerCase();
  switch (extension) {
    case "mp4": return "video/mp4";
    case "pdf": return "application/pdf";
    case "png": return "image/png";
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "md": return "text/markdown";
    case "txt": return "text/plain";
    case "docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    default: return "application/octet-stream";
  }
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function escapeAttr(value) {
  return escapeHtml(value).replaceAll("\n", " ");
}
