export const FLASH_MESSAGE_TIMEOUT_MS = 2600;
export const SIDEBAR_PREFERENCE_KEY = "training_platform_sidebar_collapsed";

export const state = {
  me: null,
  bootstrap: null,
  activeLessonId: null,
  activePage: "student",
  studentTab: "handout",
  sidebarCollapsed: false,
  message: "",
  submitting: false,
  adminLessonId: null,
  previewResourceId: null,
  previewContentHtml: "",
  previewLoading: false,
  previewError: "",
  pendingFileNameMap: {}
};

export function resetPreviewState() {
  state.previewResourceId = null;
  state.previewContentHtml = "";
  state.previewLoading = false;
  state.previewError = "";
}

export function resetSelectionState() {
  resetPreviewState();
  state.pendingFileNameMap = {};
}

export function resetSessionState() {
  state.me = null;
  state.bootstrap = null;
  state.activeLessonId = null;
  state.adminLessonId = null;
  state.studentTab = "handout";
  resetSelectionState();
}

export function applyBootstrap(data) {
  state.bootstrap = data;
  state.activeLessonId = state.activeLessonId || data.currentLessonId || data.lessons[0]?.id || null;
  state.adminLessonId = state.adminLessonId || state.activeLessonId;
}
