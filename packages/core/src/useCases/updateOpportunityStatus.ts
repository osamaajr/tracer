import type {
  AfterBuyRepository,
  OpportunityRecord,
  OpportunityStatus,
} from "../domain/types";

export type OpportunityUserAction = "viewed" | "claim_clicked" | "dismissed";

export interface UpdateOpportunityStatusCommand {
  repository: AfterBuyRepository;
  userId: string;
  opportunityId: string;
  status: OpportunityUserAction;
  now?: string;
}

export interface UpdateOpportunityStatusResult {
  opportunity: OpportunityRecord | null;
  changed: boolean;
}

export async function updateOpportunityStatus(
  command: UpdateOpportunityStatusCommand,
): Promise<UpdateOpportunityStatusResult> {
  const existing = await command.repository.findOpportunityByIdForUser(
    command.opportunityId,
    command.userId,
  );

  if (!existing) {
    return { opportunity: null, changed: false };
  }

  const nextStatus = resolveNextStatus(existing.status, command.status);

  if (nextStatus === existing.status) {
    return { opportunity: existing, changed: false };
  }

  const updated = await command.repository.updateOpportunityStatus(
    command.opportunityId,
    command.userId,
    nextStatus,
    command.now ?? new Date().toISOString(),
  );

  return { opportunity: updated, changed: Boolean(updated) };
}

function resolveNextStatus(
  currentStatus: OpportunityStatus,
  requestedStatus: OpportunityUserAction,
): OpportunityStatus {
  if (currentStatus === "expired" || currentStatus === "dismissed") {
    return currentStatus;
  }

  if (requestedStatus === "viewed") {
    return currentStatus === "open" ? "viewed" : currentStatus;
  }

  if (requestedStatus === "claim_clicked") {
    return currentStatus === "open" || currentStatus === "viewed"
      ? "claim_clicked"
      : currentStatus;
  }

  return currentStatus === "open" || currentStatus === "viewed"
    ? "dismissed"
    : currentStatus;
}
