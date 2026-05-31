import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function loadAppConfig() {
  await loadEnvFile();
  const configPath = resolve(process.cwd(), "config", "local-config.json");
  const fileConfig = existsSync(configPath)
    ? JSON.parse(await readFile(configPath, "utf8"))
    : {};

  return {
    port: readNumberEnv("PORT", fileConfig.port, 3230),
    sessionDays: readNumberEnv("SESSION_DAYS", fileConfig.sessionDays, 7),
    databaseFile: process.env.DATABASE_FILE || fileConfig.databaseFile || "runtime/training-course-platform.sqlite",
    databaseUrl: process.env.DATABASE_URL || fileConfig.databaseUrl || "",
    databaseSslMode: process.env.DATABASE_SSL_MODE || fileConfig.databaseSslMode || "require",
    storageDir: process.env.STORAGE_DIR || fileConfig.storageDir || "runtime/storage",
    storageProvider: resolveStorageProvider(process.env.STORAGE_PROVIDER || fileConfig.storageProvider || ""),
    appBaseUrl: process.env.APP_BASE_URL || fileConfig.appBaseUrl || "",
    courseTitle: process.env.COURSE_TITLE || fileConfig.courseTitle || "上岸包 · 工程师能力训练",
    courseSubtitle: process.env.COURSE_SUBTITLE || fileConfig.courseSubtitle || "课程列表、视频、课件、作业提交的统一收录平台",
    r2AccountId: process.env.R2_ACCOUNT_ID || fileConfig.r2AccountId || "",
    r2AccessKeyId: process.env.R2_ACCESS_KEY_ID || fileConfig.r2AccessKeyId || "",
    r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY || fileConfig.r2SecretAccessKey || "",
    r2Bucket: process.env.R2_BUCKET || fileConfig.r2Bucket || "",
    r2PublicBaseUrl: process.env.R2_PUBLIC_BASE_URL || fileConfig.r2PublicBaseUrl || ""
  };
}

async function loadEnvFile() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) {
    return;
  }
  const raw = await readFile(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith("#")) {
      continue;
    }
    const equalIndex = trimmedLine.indexOf("=");
    if (equalIndex <= 0) {
      continue;
    }
    const key = trimmedLine.slice(0, equalIndex).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }
    const rawValue = trimmedLine.slice(equalIndex + 1).trim();
    process.env[key] = stripEnvQuotes(rawValue);
  }
}

function stripEnvQuotes(value) {
  const normalizedValue = String(value || "");
  if (
    (normalizedValue.startsWith("\"") && normalizedValue.endsWith("\"")) ||
    (normalizedValue.startsWith("'") && normalizedValue.endsWith("'"))
  ) {
    return normalizedValue.slice(1, -1);
  }
  return normalizedValue;
}

function readNumberEnv(envName, fileValue, fallbackValue) {
  const raw = process.env[envName];
  if (raw !== undefined && raw !== "") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  if (fileValue !== undefined && fileValue !== null) {
    const parsed = Number(fileValue);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallbackValue;
}

function resolveStorageProvider(rawValue) {
  const normalizedValue = String(rawValue || "").trim().toLowerCase();
  if (normalizedValue) {
    return normalizedValue;
  }
  if (process.env.R2_BUCKET && process.env.R2_ACCOUNT_ID) {
    return "r2";
  }
  return "local";
}
