function toLowerHex(bytes: Uint8Array): string {
  let output = "";
  for (const byte of bytes) {
    output += byte.toString(16).padStart(2, "0");
  }
  return output;
}

export async function hashOpaqueSecret(value: string): Promise<string> {
  const normalized = value.trim();
  if (!normalized) {
    throw new RangeError("opaque secret is required");
  }

  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(normalized),
  );
  return toLowerHex(new Uint8Array(digest));
}
