const FULL_SHA = /^[0-9a-f]{40}$/i;

export function getReleaseSha(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.DASIGAP_RELEASE_SHA?.trim();
  return value && FULL_SHA.test(value) ? value.toLowerCase() : "unknown";
}
