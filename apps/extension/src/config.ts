export const defaultApiBaseUrl = import.meta.env.VITE_TRACER_API_BASE_URL ?? "http://127.0.0.1:4000";
export const defaultDashboardBaseUrl = import.meta.env.VITE_TRACER_DASHBOARD_BASE_URL ?? "http://127.0.0.1:5173";
export const defaultUserId = import.meta.env.VITE_TRACER_USER_ID ?? "dev-user-tracer";

export function configuredBaseUrl(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const candidate = value.trim();
  // An installed development build may have saved localhost in synced settings.
  // A customer release must use its HTTPS defaults after the update.
  if (fallback.startsWith("https://") && !candidate.startsWith("https://")) return fallback;
  return candidate;
}
