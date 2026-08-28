import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import nextConfig from "../../next.config";
import { DELETE as deleteDocument } from "../../app/api/documents/[id]/route";
import { GET as getSignedDocumentUrl } from "../../app/api/documents/[id]/signed-url/route";
import { GET as getReport } from "../../app/api/report/route";
import { GET as listComponents, PATCH as patchComponent } from "../../app/api/items/[id]/components/route";
import { GET as getItem, PATCH as patchItem } from "../../app/api/items/[id]/route";
import { GET as listMaintenance, POST as createMaintenance } from "../../app/api/items/[id]/maintenance/route";
import { GET as getResale, PATCH as patchResale } from "../../app/api/items/[id]/resale/route";
import { POST as createSale } from "../../app/api/items/[id]/sale/route";
import { AuthConfigurationError, createRequireUser } from "../../src/auth/server-auth";
import { prisma } from "../../src/db/prisma";
import { MAX_DOCUMENT_BYTES, validateDocumentUpload } from "../../src/documents/upload-policy";
import { toApiErrorResponse } from "../../src/shared/api-error";

const DEV_USER_HEADER = "x-dasigap-dev-user";
const USER_A = "security-owner-a";
const USER_B = "security-attacker-b";
const USERS = [USER_A, USER_B];

function request(url: string, init: RequestInit = {}, userId = USER_B) {
  const headers = new Headers(init.headers);
  headers.set(DEV_USER_HEADER, userId);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return new Request(url, { ...init, headers });
}

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("security hardening boundaries", () => {
  beforeEach(async () => {
    vi.stubEnv("AUTH_MODE", "dev");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("OBJECT_STORAGE_MODE", "memory");
    await prisma.item.deleteMany({ where: { userId: { in: USERS } } });
  });

  afterEach(() => vi.unstubAllEnvs());

  afterAll(async () => {
    await prisma.item.deleteMany({ where: { userId: { in: USERS } } });
    await prisma.$disconnect();
  });

  it("publishes restrictive production response headers without unsafe-eval", async () => {
    expect(nextConfig.headers).toBeTypeOf("function");
    const rules = await nextConfig.headers!();
    const allHeaders = rules.flatMap((rule) => rule.headers);
    const header = (key: string) =>
      allHeaders.find((entry) => entry.key.toLowerCase() === key.toLowerCase())?.value;

    expect(header("X-Content-Type-Options")).toBe("nosniff");
    expect(header("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(header("Permissions-Policy")).toContain("camera=()");
    expect(header("Permissions-Policy")).toContain("microphone=()");
    expect(header("Permissions-Policy")).toContain("geolocation=()");
    expect(header("Content-Security-Policy")).toContain("default-src 'self'");
    expect(header("Content-Security-Policy")).not.toContain("'unsafe-eval'");
  });

  it("denies cross-user read and write across every ownership-scoped domain", async () => {
    const item = await prisma.item.create({
      data: {
        userId: USER_A,
        name: "Owner secret item",
        category: "Security",
        purchaseDate: new Date("2026-01-01T00:00:00.000Z"),
        purchasePrice: 200000,
        status: "SOLD",
        components: { create: [{ name: "Owner component", isPresent: true }] },
        maintenance: {
          create: { type: "NOTE", occurredAt: new Date("2026-02-01T00:00:00.000Z"), note: "Owner note" },
        },
        documents: { create: { type: "RECEIPT", storageKey: "users/security-owner-a/private-receipt.pdf" } },
        resaleDraft: {
          create: {
            conditionGrade: "GOOD",
            defectNote: "Owner defect",
            askingPrice: 150000,
            generatedText: "Owner resale text",
            photoChecklist: { front: true, back: true, detail: true, components: true },
          },
        },
        saleRecord: {
          create: { soldAt: new Date("2026-08-01T00:00:00.000Z"), soldPrice: 150000, channel: "Owner channel" },
        },
      },
      include: { components: true, documents: true },
    });

    const itemRead = await getItem(request(`http://localhost/api/items/${item.id}`), context(item.id));
    const itemWrite = await patchItem(
      request(`http://localhost/api/items/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: "attacker edit" }),
      }),
      context(item.id),
    );
    const componentRead = await listComponents(
      request(`http://localhost/api/items/${item.id}/components`),
      context(item.id),
    );
    const componentWrite = await patchComponent(
      request(`http://localhost/api/items/${item.id}/components`, {
        method: "PATCH",
        body: JSON.stringify({ id: item.components[0].id, isPresent: false }),
      }),
      context(item.id),
    );
    const maintenanceRead = await listMaintenance(
      request(`http://localhost/api/items/${item.id}/maintenance`),
      context(item.id),
    );
    const maintenanceWrite = await createMaintenance(
      request(`http://localhost/api/items/${item.id}/maintenance`, {
        method: "POST",
        body: JSON.stringify({ type: "NOTE", occurredAt: "2026-08-02", note: "attacker" }),
      }),
      context(item.id),
    );
    const resaleRead = await getResale(
      request(`http://localhost/api/items/${item.id}/resale`),
      context(item.id),
    );
    const resaleWrite = await patchResale(
      request(`http://localhost/api/items/${item.id}/resale`, {
        method: "PATCH",
        body: JSON.stringify({ askingPrice: 1 }),
      }),
      context(item.id),
    );
    const saleWrite = await createSale(
      request(`http://localhost/api/items/${item.id}/sale`, {
        method: "POST",
        body: JSON.stringify({ soldAt: "2026-08-03", soldPrice: 1 }),
      }),
      context(item.id),
    );
    const documentRead = await getSignedDocumentUrl(
      request(`http://localhost/api/documents/${item.documents[0].id}/signed-url`),
      context(item.documents[0].id),
    );
    const documentWrite = await deleteDocument(
      request(`http://localhost/api/documents/${item.documents[0].id}`, { method: "DELETE" }),
      context(item.documents[0].id),
    );

    for (const response of [
      itemRead,
      itemWrite,
      componentRead,
      componentWrite,
      maintenanceRead,
      maintenanceWrite,
      resaleRead,
      resaleWrite,
      saleWrite,
      documentRead,
      documentWrite,
    ]) {
      expect(response.status).toBe(404);
    }

    const attackerReport = await getReport(request("http://localhost/api/report"));
    expect(attackerReport.status).toBe(200);
    await expect(attackerReport.json()).resolves.toMatchObject({ items: [] });
  });

  it("keeps the upload allowlist at 10 MiB and rejects active-content formats", () => {
    expect(() => validateDocumentUpload({ mimeType: "image/svg+xml", size: 100 })).toThrow();
    expect(() => validateDocumentUpload({ mimeType: "text/html", size: 100 })).toThrow();
    expect(() => validateDocumentUpload({ mimeType: "application/x-msdownload", size: 100 })).toThrow();
    expect(() => validateDocumentUpload({ mimeType: "application/pdf", size: MAX_DOCUMENT_BYTES + 1 })).toThrow();
    expect(validateDocumentUpload({ mimeType: "application/pdf", size: MAX_DOCUMENT_BYTES })).toEqual({ extension: "pdf" });
  });

  it("rejects development authentication in production", () => {
    expect(() => createRequireUser({ mode: "dev", nodeEnv: "production" })).toThrow(AuthConfigurationError);
  });

  it("does not expose sensitive error details to users", async () => {
    const secret = "010-1234-5678 ORDER-SECRET card-411111 storage/users/private/receipt.pdf";
    const response = toApiErrorResponse(new Error(secret));
    const body = JSON.stringify(await response.json());
    expect(body).not.toContain("010-1234-5678");
    expect(body).not.toContain("ORDER-SECRET");
    expect(body).not.toContain("411111");
    expect(body).not.toContain("storage/users/private/receipt.pdf");
  });
});
