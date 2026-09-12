import { normalizeSavedUrl, savedMatchesPurchase, type SavedItem, type SavedProduct, type PurchaseDraft, type PurchaseRecord, type ProductRecord } from '@afterbuy/core';

export const watchlistKey = 'tracerWatchlistV1';
interface Storage {
  get(key: string): Promise<Record<string, unknown>>;
  set(value: Record<string, unknown>): Promise<void>;
}
/** One background-owned writer serializes read/modify/write operations across popups. */
export class WatchlistRepository {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private storage: Storage) {}
  private mutate<T>(fn: (items: SavedItem[]) => Promise<T>): Promise<T> {
    const task = this.queue.then(async () => fn(await this.all()));
    this.queue = task.catch(() => undefined);
    return task;
  }
  async all(): Promise<SavedItem[]> {
    const data = await this.storage.get(watchlistKey);
    return Array.isArray(data[watchlistKey]) ? data[watchlistKey] as SavedItem[] : [];
  }
  async list(): Promise<SavedItem[]> {
    await this.queue;
    return (await this.all()).filter(item => item.status === 'saved');
  }
  save(product: SavedProduct): Promise<{item: SavedItem; duplicate: boolean}> {
    return this.mutate(async items => {
      const canonicalUrl = normalizeSavedUrl(product.canonicalUrl);
      if (!product.name?.trim() || product.name.length > 300) throw new Error('A product name is required.');
      const existing = items.find(item => item.status === 'saved' && item.canonicalUrl === canonicalUrl);
      if (existing) return {item: existing, duplicate: true};
      const item: SavedItem = {...product, canonicalUrl, name: product.name.trim(), id: crypto.randomUUID(), savedAt: new Date().toISOString(), status: 'saved'};
      await this.storage.set({[watchlistKey]: [...items, item]});
      return {item, duplicate: false};
    });
  }
  remove(id: string): Promise<void> {
    return this.mutate(async items => { await this.storage.set({[watchlistKey]: items.filter(item => item.id !== id || item.status !== 'saved')}); });
  }
  clearSaved(): Promise<void> {
    return this.mutate(async items => {
      await this.storage.set({[watchlistKey]: items.filter(item => item.status !== 'saved')});
    });
  }
  connect(draft: Pick<PurchaseDraft, "retailerId" | "storeHost" | "lineItems">, protectionId: string): Promise<void> {
    return this.mutate(async items => {
      const next = items.map(item => item.status === 'saved' && draft.lineItems.some(line => savedMatchesPurchase(item, draft, line))
        ? {...item, status: 'protected' as const, protectionId, protectedAt: new Date().toISOString()} : item);
      await this.storage.set({[watchlistKey]: next});
    });
  }
}


export interface AcceptedProtectionResponse {
  accepted?: Array<{purchase?: PurchaseRecord; product?: ProductRecord}>;
}

/** Optional reconciliation cannot turn a successful protection into a failure. */
export async function connectAcceptedSavedItems(repository: WatchlistRepository, body: AcceptedProtectionResponse): Promise<void> {
  for (const accepted of body.accepted ?? []) {
    const purchase = accepted.purchase;
    if (!purchase?.id || !purchase.productUrl) continue;
    await repository.connect({
      retailerId: purchase.retailerId,
      storeHost: purchase.storeHost,
      lineItems: [{
        productName: purchase.productName,
        productUrl: purchase.productUrl,
        pricePaid: purchase.pricePaid,
        quantity: purchase.quantity,
        ...(purchase.externalProductId ? {externalProductId: purchase.externalProductId} : {}),
        ...(accepted.product?.sku ? {sku: accepted.product.sku} : {}),
      }],
    }, purchase.id).catch(() => undefined);
  }
}
