import { createReadStream } from "node:fs";
import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { extname, resolve } from "node:path";
import { Readable } from "node:stream";

const R2_REGION = "auto";
const R2_SERVICE = "s3";

export async function ensureDirectory(path) {
  await mkdir(path, { recursive: true });
}

export async function createFileStore(config) {
  if (config.storageProvider === "r2") {
    return createR2FileStore(config);
  }
  return createLocalFileStore(config);
}

export function normalizeBase64Payload(base64Data) {
  const value = String(base64Data);
  const commaIndex = value.indexOf(",");
  if (commaIndex >= 0) {
    return value.slice(commaIndex + 1);
  }
  return value;
}

export function normalizeStoredFilePath(filePath) {
  const parts = String(filePath || "").split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) || "";
}

export function resolveStoredFilePath(storageDir, filePath) {
  return resolve(storageDir, normalizeStoredFilePath(filePath));
}

function createLocalFileStore(config) {
  const storageRoot = resolve(process.cwd(), config.storageDir);

  return {
    provider: "local",
    async init() {
      await ensureDirectory(storageRoot);
    },
    async saveBase64Upload(payload) {
      const {
        originalName,
        mimeType,
        base64Data
      } = payload;
      if (!originalName || !base64Data) {
        throw new Error("缺少文件名或文件内容");
      }
      const buffer = Buffer.from(normalizeBase64Payload(base64Data), "base64");
      return this.saveContent({
        originalName,
        mimeType,
        buffer
      });
    },
    async saveContent(payload) {
      const {
        originalName,
        mimeType,
        buffer
      } = payload;
      const resolvedMimeType = resolveMimeType(originalName, mimeType);
      const extension = extname(originalName) || guessExtension(resolvedMimeType);
      const fileId = randomUUID();
      const fileName = `${fileId}${extension}`;
      const absolutePath = resolve(storageRoot, fileName);
      await writeFile(absolutePath, buffer);
      const fileStat = await stat(absolutePath);
      return {
        fileId,
        filePath: fileName,
        originalName,
        mimeType: resolvedMimeType,
        size: fileStat.size
      };
    },
    async removeStoredFile(filePath) {
      if (!filePath) {
        return;
      }
      const resolvedPath = resolveStoredFilePath(storageRoot, filePath);
      try {
        await unlink(resolvedPath);
      } catch (error) {
        if (error?.code !== "ENOENT") {
          throw error;
        }
      }
    },
    async openStoredFile(filePath) {
      const resolvedPath = resolveStoredFilePath(storageRoot, filePath);
      const fileStat = await stat(resolvedPath);
      return {
        stream: createReadStream(resolvedPath),
        size: fileStat.size
      };
    }
  };
}

function createR2FileStore(config) {
  const r2Config = validateR2Config(config);

  return {
    provider: "r2",
    async init() {
      return undefined;
    },
    async saveBase64Upload(payload) {
      const {
        originalName,
        mimeType,
        base64Data
      } = payload;
      if (!originalName || !base64Data) {
        throw new Error("缺少文件名或文件内容");
      }
      const buffer = Buffer.from(normalizeBase64Payload(base64Data), "base64");
      return this.saveContent({
        originalName,
        mimeType,
        buffer
      });
    },
    async saveContent(payload) {
      const {
        originalName,
        mimeType,
        buffer
      } = payload;
      const resolvedMimeType = resolveMimeType(originalName, mimeType);
      const extension = extname(originalName) || guessExtension(resolvedMimeType);
      const fileId = randomUUID();
      const objectKey = `${fileId}${extension}`;
      const response = await signedR2Request(r2Config, {
        method: "PUT",
        objectKey,
        body: buffer,
        headers: {
          "content-type": resolvedMimeType,
          "content-length": String(buffer.length)
        }
      });
      if (!response.ok) {
        throw new Error(`R2 上传失败：${response.status}`);
      }
      return {
        fileId,
        filePath: objectKey,
        originalName,
        mimeType: resolvedMimeType,
        size: buffer.length
      };
    },
    async removeStoredFile(filePath) {
      if (!filePath) {
        return;
      }
      const response = await signedR2Request(r2Config, {
        method: "DELETE",
        objectKey: normalizeStoredFilePath(filePath)
      });
      if (!response.ok && response.status !== 404) {
        throw new Error(`R2 删除失败：${response.status}`);
      }
    },
    async openStoredFile(filePath) {
      const response = await signedR2Request(r2Config, {
        method: "GET",
        objectKey: normalizeStoredFilePath(filePath)
      });
      if (response.status === 404) {
        throw new Error("资源文件不存在");
      }
      if (!response.ok || !response.body) {
        throw new Error(`R2 读取失败：${response.status}`);
      }
      return {
        stream: Readable.fromWeb(response.body),
        size: Number(response.headers.get("content-length") || 0)
      };
    }
  };
}

function validateR2Config(config) {
  const required = {
    accountId: config.r2AccountId,
    accessKeyId: config.r2AccessKeyId,
    secretAccessKey: config.r2SecretAccessKey,
    bucket: config.r2Bucket
  };
  for (const [key, value] of Object.entries(required)) {
    if (!value) {
      throw new Error(`缺少 R2 配置：${key}`);
    }
  }
  return required;
}

async function signedR2Request(config, options) {
  const method = options.method || "GET";
  const objectKey = normalizeStoredFilePath(options.objectKey);
  const body = options.body || Buffer.alloc(0);
  const timestamp = buildAmzTimestamp(new Date());
  const datestamp = timestamp.slice(0, 8);
  const host = `${config.accountId}.r2.cloudflarestorage.com`;
  const path = `/${config.bucket}/${encodeR2Key(objectKey)}`;
  const payloadHash = sha256Hex(body);
  const headers = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": timestamp,
    ...normalizeHeaderRecord(options.headers)
  };
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((key) => `${key}:${String(headers[key]).trim()}\n`)
    .join("");
  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalRequest = [
    method,
    path,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join("\n");
  const credentialScope = `${datestamp}/${R2_REGION}/${R2_SERVICE}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    timestamp,
    credentialScope,
    sha256Hex(canonicalRequest)
  ].join("\n");
  const signingKey = buildSigningKey(config.secretAccessKey, datestamp);
  const signature = hmacHex(signingKey, stringToSign);
  const authorization = [
    `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`
  ].join(", ");

  return fetch(`https://${host}${path}`, {
    method,
    headers: {
      ...headers,
      authorization
    },
    body: ["PUT", "POST"].includes(method) ? body : undefined
  });
}

function normalizeHeaderRecord(headers = {}) {
  return Object.fromEntries(
    Object.entries(headers)
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .map(([key, value]) => [String(key).toLowerCase(), String(value)])
  );
}

function encodeR2Key(key) {
  return key.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

function buildAmzTimestamp(date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function buildSigningKey(secretAccessKey, datestamp) {
  const kDate = hmacBuffer(`AWS4${secretAccessKey}`, datestamp);
  const kRegion = hmacBuffer(kDate, R2_REGION);
  const kService = hmacBuffer(kRegion, R2_SERVICE);
  return hmacBuffer(kService, "aws4_request");
}

function hmacBuffer(key, value) {
  return createHmac("sha256", key).update(value).digest();
}

function hmacHex(key, value) {
  return createHmac("sha256", key).update(value).digest("hex");
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function guessExtension(mimeType) {
  switch (mimeType) {
    case "video/mp4":
      return ".mp4";
    case "application/pdf":
      return ".pdf";
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "text/markdown":
      return ".md";
    case "text/plain":
      return ".txt";
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return ".docx";
    default:
      return "";
  }
}

function resolveMimeType(originalName, mimeType) {
  const normalizedMimeType = String(mimeType || "").trim().toLowerCase();
  if (!normalizedMimeType || normalizedMimeType === "application/octet-stream") {
    const extension = extname(String(originalName || "")).toLowerCase();
    switch (extension) {
      case ".mp4":
        return "video/mp4";
      case ".pdf":
        return "application/pdf";
      case ".png":
        return "image/png";
      case ".jpg":
      case ".jpeg":
        return "image/jpeg";
      case ".md":
        return "text/markdown";
      case ".txt":
        return "text/plain";
      case ".docx":
        return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      default:
        return "application/octet-stream";
    }
  }
  return mimeType;
}
