import { normalizeSavedUrl, savedMatchesPurchase, type SavedItem, type SavedProduct, type PurchaseDraft, type PurchaseRecord, type ProductRecord } from '@tracer/core';

export const watchlistKey = 'tracerWatchlistV1';
type MonitoringUpdate = {
  savedPrice?: NonNullable<SavedItem['savedPrice']>;
  currentPrice?: NonNullable<SavedItem['currentPrice']>;
  priceDropAmount?: SavedItem['priceDropAmount'] | undefined;
  priceDropPercent?: SavedItem['priceDropPercent'] | undefined;
  monitoringStatus?: NonNullable<SavedItem['monitoringStatus']>;
  lastCheckedAt?: NonNullable<SavedItem['lastCheckedAt']>;
  lastNotifiedPrice?: SavedItem['lastNotifiedPrice'] | undefined;
};
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
      if (existing) {
        if (!existing.savedPrice && product.savedPrice) {
          const updated: SavedItem = {...existing, savedPrice: product.savedPrice, currentPrice: product.savedPrice, monitoringStatus: 'watching', lastCheckedAt: new Date().toISOString()};
          await this.storage.set({[watchlistKey]: items.map(item => item.id === existing.id ? updated : item)});
          return {item: updated, duplicate: true};
        }
        return {item: existing, duplicate: true};
      }
      const savedAt = new Date().toISOString();
      const item: SavedItem = {...product, canonicalUrl, name: product.name.trim(), id: crypto.randomUUID(), savedAt, status: 'saved', ...(product.savedPrice ? {currentPrice: product.savedPrice, lastCheckedAt: savedAt} : {}), monitoringStatus: product.savedPrice ? 'watching' : 'unavailable'};
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
  updateMonitoring(id: string, update: MonitoringUpdate): Promise<SavedItem | null> {
    return this.mutate(async items => {
      const index = items.findIndex(item => item.id === id && item.status === 'saved');
      if (index < 0) return null;
      const existing = items[index];
      if (!existing) return null;
      const {priceDropAmount, priceDropPercent, lastNotifiedPrice, ...definedUpdate} = update;
      const next: SavedItem = {...existing, ...definedUpdate};
      if ('priceDropAmount' in update) {
        if (priceDropAmount === undefined) delete next.priceDropAmount;
        else next.priceDropAmount = priceDropAmount;
      }
      if ('priceDropPercent' in update) {
        if (priceDropPercent === undefined) delete next.priceDropPercent;
        else next.priceDropPercent = priceDropPercent;
      }
      if ('lastNotifiedPrice' in update) {
        if (lastNotifiedPrice === undefined) delete next.lastNotifiedPrice;
        else next.lastNotifiedPrice = lastNotifiedPrice;
      }
      const all = [...items];
      all[index] = next;
      await this.storage.set({[watchlistKey]: all});
      return next;
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
