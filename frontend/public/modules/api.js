import { handleResponse, resolveApiUrl } from "./utils.js";

export function createApi(apiBaseUrl) {
  async function apiGet(path) {
    const response = await fetch(resolveApiUrl(path, apiBaseUrl), { credentials: "include" });
    return handleResponse(response);
  }

  async function apiPost(path, body) {
    const response = await fetch(resolveApiUrl(path, apiBaseUrl), {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    });
    return handleResponse(response);
  }

  async function apiDelete(path) {
    const response = await fetch(resolveApiUrl(path, apiBaseUrl), {
      method: "DELETE",
      credentials: "include"
    });
    return handleResponse(response);
  }

  async function fetchResourceText(resourceId) {
    const response = await fetch(resolveApiUrl(`/api/resources/${resourceId}`, apiBaseUrl), { credentials: "include" });
    if (!response.ok) {
      throw new Error("预览加载失败");
    }
    return response.text();
  }

  return {
    apiGet,
    apiPost,
    apiDelete,
    fetchResourceText,
    resolveApiUrl: (path) => resolveApiUrl(path, apiBaseUrl)
  };
}
