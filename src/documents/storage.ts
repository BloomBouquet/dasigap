import { createHash, createHmac, randomBytes } from "node:crypto";

export type PutPrivateObjectInput = {
  storageKey: string;
  bytes: Uint8Array;
  contentType: string;
};

type StorageConfiguration = {
  endpoint: URL;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

const memoryObjects = new Map<string, Buffer>();
const memoryTokens = new Map<string, { storageKey: string; expiresAt: number }>();

export class ObjectStorageConfigurationError extends Error {
  constructor() {
    super("Private object storage is not configured");
    this.name = "ObjectStorageConfigurationError";
  }
}

export class ObjectStorageOperationError extends Error {
  constructor(message = "Private object storage operation failed") {
    super(message);
    this.name = "ObjectStorageOperationError";
  }
}

function useMemoryStorage() {
  if (process.env.NODE_ENV === "production") return false;
  return process.env.OBJECT_STORAGE_MODE === "memory" || process.env.NODE_ENV === "test";
}

function requireConfiguration(): StorageConfiguration {
  const endpoint = process.env.OBJECT_STORAGE_ENDPOINT;
  const region = process.env.OBJECT_STORAGE_REGION;
  const bucket = process.env.OBJECT_STORAGE_BUCKET;
  const accessKeyId = process.env.OBJECT_STORAGE_ACCESS_KEY_ID;
  const secretAccessKey = process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY;

  if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) {
    throw new ObjectStorageConfigurationError();
  }

  return {
    endpoint: new URL(endpoint),
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
  };
}

function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: Buffer | string, value: string) {
  return createHmac("sha256", key).update(value).digest();
}

function signingKey(secret: string, date: string, region: string) {
  const kDate = hmac(`AWS4${secret}`, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, "s3");
  return hmac(kService, "aws4_request");
}

function awsTimestamp(date: Date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function encodePath(value: string) {
  return value
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function bucketUrl(config: StorageConfiguration) {
  const url = new URL(config.endpoint.toString());
  const base = url.pathname.replace(/\/$/, "");
  url.pathname = `${base}/${encodeURIComponent(config.bucket)}`;
  return url;
}

function objectUrl(config: StorageConfiguration, storageKey: string) {
  const url = bucketUrl(config);
  url.pathname = `${url.pathname}/${encodePath(storageKey)}`;
  return url;
}

function signedHeadersForRequest(
  method: "PUT" | "DELETE" | "HEAD",
  url: URL,
  body: Uint8Array,
  contentType?: string,
) {
  const config = requireConfiguration();
  const now = new Date();
  const amzDate = awsTimestamp(now);
  const date = amzDate.slice(0, 8);
  const payloadHash = sha256(body);
  const headerPairs: Array<[string, string]> = [
    ["host", url.host],
    ["x-amz-content-sha256", payloadHash],
    ["x-amz-date", amzDate],
  ];
  if (contentType) headerPairs.push(["content-type", contentType]);
  headerPairs.sort(([a], [b]) => a.localeCompare(b));
  const canonicalHeaders = `${headerPairs.map(([key, value]) => `${key}:${value.trim()}`).join("\n")}\n`;
  const signedHeaders = headerPairs.map(([key]) => key).join(";");
  const canonicalRequest = [
    method,
    url.pathname,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const scope = `${date}/${config.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
  const signature = createHmac("sha256", signingKey(config.secretAccessKey, date, config.region))
    .update(stringToSign)
    .digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return Object.fromEntries([
    ...headerPairs.map(([key, value]) => [key, value]),
    ["authorization", authorization],
  ]);
}

async function putS3(input: PutPrivateObjectInput) {
  const config = requireConfiguration();
  const url = objectUrl(config, input.storageKey);
  const headers = signedHeadersForRequest("PUT", url, input.bytes, input.contentType);
  const response = await fetch(url, { method: "PUT", headers, body: Buffer.from(input.bytes) });
  if (!response.ok) throw new ObjectStorageOperationError();
}

async function deleteS3(storageKey: string) {
  const config = requireConfiguration();
  const url = objectUrl(config, storageKey);
  const empty = new Uint8Array();
  const headers = signedHeadersForRequest("DELETE", url, empty);
  const response = await fetch(url, { method: "DELETE", headers });
  if (!response.ok && response.status !== 404) throw new ObjectStorageOperationError();
}

function presignS3(storageKey: string, ttlSeconds: number) {
  const config = requireConfiguration();
  const url = objectUrl(config, storageKey);
  const now = new Date();
  const amzDate = awsTimestamp(now);
  const date = amzDate.slice(0, 8);
  const scope = `${date}/${config.region}/s3/aws4_request`;
  const params = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${config.accessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(ttlSeconds),
    "X-Amz-SignedHeaders": "host",
  });
  const canonicalQuery = [...params.entries()]
    .sort(([a, av], [b, bv]) => (a === b ? av.localeCompare(bv) : a.localeCompare(b)))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  const canonicalRequest = [
    "GET",
    url.pathname,
    canonicalQuery,
    `host:${url.host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
  const signature = createHmac("sha256", signingKey(config.secretAccessKey, date, config.region))
    .update(stringToSign)
    .digest("hex");
  params.set("X-Amz-Signature", signature);
  url.search = params.toString();
  return url.toString();
}

export async function checkObjectStorageReadiness(signal?: AbortSignal): Promise<void> {
  const config = requireConfiguration();
  const url = bucketUrl(config);
  const empty = new Uint8Array();
  const headers = signedHeadersForRequest("HEAD", url, empty);
  const response = await fetch(url, { method: "HEAD", headers, signal });
  if (!response.ok) throw new ObjectStorageOperationError();
}

export async function putPrivateObject(input: PutPrivateObjectInput): Promise<{ storageKey: string }> {
  if (useMemoryStorage()) {
    memoryObjects.set(input.storageKey, Buffer.from(input.bytes));
  } else {
    await putS3(input);
  }
  return { storageKey: input.storageKey };
}

export async function createSignedReadUrl(storageKey: string, ttlSeconds: number): Promise<string> {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 3600) {
    throw new ObjectStorageOperationError("Invalid signed URL TTL");
  }

  if (useMemoryStorage()) {
    const token = randomBytes(24).toString("base64url");
    memoryTokens.set(token, { storageKey, expiresAt: Date.now() + ttlSeconds * 1000 });
    const base = process.env.PRIVATE_DOCUMENT_BASE_URL ?? "http://127.0.0.1:3000";
    return `${base}/api/private-documents/${token}`;
  }

  return presignS3(storageKey, ttlSeconds);
}

export async function deletePrivateObject(storageKey: string): Promise<void> {
  if (useMemoryStorage()) {
    memoryObjects.delete(storageKey);
    return;
  }
  await deleteS3(storageKey);
}

export async function readMemorySignedObject(token: string): Promise<Buffer | null> {
  if (!useMemoryStorage()) return null;
  const record = memoryTokens.get(token);
  if (!record || record.expiresAt <= Date.now()) {
    memoryTokens.delete(token);
    return null;
  }
  return memoryObjects.get(record.storageKey) ?? null;
}

export async function readPrivateObjectForTest(storageKey: string): Promise<Buffer | null> {
  if (!useMemoryStorage()) throw new ObjectStorageOperationError("Test reader is unavailable");
  return memoryObjects.get(storageKey) ?? null;
}
