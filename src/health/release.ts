const RELEASE_SHA = /^[0-9a-f]{40}$/;

export function getReleaseSha(value = process.env.DASIGAP_RELEASE_SHA): string {
  return value && RELEASE_SHA.test(value) ? value : "unknown";
}
