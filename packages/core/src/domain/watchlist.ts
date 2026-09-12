import type { Money } from "./types";

export interface SavedProduct {
  name: string;
  retailer: string;
  retailerId: string;
  canonicalUrl: string;
  savedPrice?: Money;
  imageUrl?: string;
  externalProductId?: string;
  sku?: string;
}
export interface SavedItem extends SavedProduct {
  id: string;
  savedAt: string;
  status: 'saved' | 'protected';
  protectionId?: string;
  protectedAt?: string;
}

