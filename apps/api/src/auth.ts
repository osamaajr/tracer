import { createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { ApiConfig } from "./config";

export interface AuthenticatedUser {
  id: string;
}

export function requireAuthenticatedUser(
  request: FastifyRequest,
  config: ApiConfig,
): AuthenticatedUser {
  const header = request.headers["x-tracer-user-id"];
  const requestedUserId = Array.isArray(header) ? header[0] : header;

  if (requestedUserId && isSafeUserId(requestedUserId)) {
    if (!config.enableDevAuth) {
      if (!/^[a-f0-9]{64}$/.test(requestedUserId)) {
        throw new Error("Authentication required");
      }
      return {
        id: `anon_${createHash("sha256").update(requestedUserId).digest("hex")}`,
      };
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
