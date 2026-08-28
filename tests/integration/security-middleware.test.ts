import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { middleware } from "../../middleware";

describe("private document middleware", () => {
  it("marks private document and signed-url responses as no-store", () => {
    const privateDocument = middleware(
      new NextRequest("http://localhost/api/private-documents/example-token"),
    );
    const signedUrl = middleware(
      new NextRequest(
        "http://localhost/api/documents/00000000-0000-4000-8000-000000000001/signed-url",
      ),
    );

    expect(privateDocument.headers.get("cache-control")).toBe("private, no-store");
    expect(signedUrl.headers.get("cache-control")).toBe("private, no-store");
  });
});
