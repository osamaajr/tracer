import type {
  ActivityEventRecord,
  OpportunityRecord,
  PriceObservationRecord,
  ProductRecord,
  PurchaseRecord,
  UserMonitoringPreference,
} from "@tracer/core";

export interface StoreState {
  products: ProductRecord[];
  purchases: PurchaseRecord[];
  observations: PriceObservationRecord[];
  opportunities: OpportunityRecord[];
  activityEvents: ActivityEventRecord[];
  monitoringPreferences: UserMonitoringPreference[];
}

export const emptyStore: StoreState = {
  products: [],
  purchases: [],
  observations: [],
  opportunities: [],
  activityEvents: [],
  monitoringPreferences: [],
};

export function clone<T>(value: T): T {
  if (value === null) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

export function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

export function isMonitoringEnabled(state: StoreState, userId: string): boolean {
  return state.monitoringPreferences.find((preference) => preference.userId === userId)?.enabled !== false;
}
