import type { FastifyRequest } from "fastify";
import type { ApiConfig } from "./config";

export interface AuthenticatedUser {
  id: string;
}

export function requireAuthenticatedUser(
  request: FastifyRequest,
  config: ApiConfig,
): AuthenticatedUser {
  const header = request.headers["x-afterbuy-user-id"];
  const requestedUserId = Array.isArray(header) ? header[0] : header;

  if (requestedUserId && isSafeUserId(requestedUserId)) {
    if (!config.enableDevAuth) {
      throw new Error("Extension token authentication is not configured");
    }

    return { id: requestedUserId };
  }

  if (config.enableDevAuth) {
    return { id: config.devUserId };
  }

  throw new Error("Authentication required");
}

function isSafeUserId(value: string): boolean {
  return /^[A-Za-z0-9_-]{3,80}$/.test(value);
}
