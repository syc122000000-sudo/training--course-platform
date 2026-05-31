import { initializeApp, boot } from "./modules/actions.js";
import { renderError } from "./modules/render.js";
import { getApiBaseUrl } from "./modules/utils.js";

const appElement = document.getElementById("app");

initializeApp({
  appElement,
  apiBaseUrl: getApiBaseUrl()
});

document.addEventListener("DOMContentLoaded", () => {
  boot().catch((error) => {
    console.error(error);
    renderError(error.message || "页面加载失败");
  });
});
