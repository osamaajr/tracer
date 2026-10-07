import { defaultApiBaseUrl, defaultUserId } from "./config";

const productionIdentity = defaultApiBaseUrl.startsWith("https://");
const tokenPattern = /^[a-f0-9]{64}$/;
let identityPromise: Promise<string> | null = null;

export function getTracerUserId(): Promise<string> {
  identityPromise ??= readIdentity().catch((error: unknown) => {
    identityPromise = null;
    throw error;
  });
  return identityPromise;
}

async function readIdentity(): Promise<string> {
  if (!productionIdentity) {
    const stored = await chrome.storage.local.get("tracerUserId");
    const configured = typeof stored.tracerUserId === "string" ? stored.tracerUserId : "";
    if (configured) return configured;
    await chrome.storage.local.set({ tracerUserId: defaultUserId });
    return defaultUserId;
  }

  // The popup and service worker can start together. A Web Lock prevents them
  // from creating two identities and orphaning the first protected purchase.
  return navigator.locks.request("tracer-installation-identity", async () => {
    const stored = await chrome.storage.local.get("tracerUserId");
    const configured = typeof stored.tracerUserId === "string" ? stored.tracerUserId : "";
    if (tokenPattern.test(configured)) return configured;
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    await chrome.storage.local.set({ tracerUserId: token });
    return token;
  });
}
