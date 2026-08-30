import type { RetailerId, RetailerPolicy } from "../domain/types";
import { johnLewisPricePromisePolicy } from "../retailers/johnLewisPolicy";

export class RetailerPolicyRegistry {
  constructor(private readonly policies: RetailerPolicy[]) {}

  findPolicyForRetailer(retailerId: RetailerId, at: string): RetailerPolicy | null {
    const effective = this.policies
      .filter((policy) => policy.retailerId === retailerId && policy.effectiveFrom <= at)
      .sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom));

    return effective[0] ?? null;
  }
}

export const defaultPolicyRegistry = new RetailerPolicyRegistry([
  johnLewisPricePromisePolicy,
]);
