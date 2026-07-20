// Google Play Digital Goods API (Web TWA / PWA billing).
// Spec: https://developers.google.com/google-play/web/financial
// Available inside Android Chrome (TWA) via window.digitalGoods.

export interface DigitalServiceItem {
  itemId: string;
  title: string;
  description: string;
  price: { value: string; currency: string };
}

interface DigitalGoodsService {
  getSKU(skuIds: string[], itemType: 'inapp' | 'subs'): Promise<DigitalServiceItem[]>;
  consume(purchaseToken: string): Promise<void>;
  acknowledge(purchaseToken: string): Promise<void>;
}

interface PaymentService {
  loadPaymentData(paymentDataRequest: unknown): Promise<unknown>;
}

declare global {
  interface Window {
    digitalGoods?: { service: (s: string) => Promise<DigitalGoodsService> };
    PaymentRequest?: { new (...a: unknown[]): { show: () => Promise<unknown> } } & typeof PaymentRequest;
  }
}

import { SUBSCRIPTION_SKUS } from './config';

export const PRODUCT_SKUS = SUBSCRIPTION_SKUS;

export type PlanId = 'trial' | 'monthly' | 'yearly' | 'expired';

export function isPlayBillingAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.digitalGoods;
}

async function getDGService(): Promise<DigitalGoodsService | null> {
  if (!window.digitalGoods) return null;
  try {
    return await window.digitalGoods.service('https://play.google.com/billing');
  } catch {
    return null;
  }
}

export async function fetchProductDetails(): Promise<Record<string, DigitalServiceItem>> {
  const svc = await getDGService();
  if (!svc) return {};
  try {
    const items = await svc.getSKU(Object.values(PRODUCT_SKUS), 'subs');
    const out: Record<string, DigitalServiceItem> = {};
    for (const it of items) out[it.itemId] = it;
    return out;
  } catch {
    return {};
  }
}

interface PurchaseResult {
  purchaseToken: string;
  productId: string;
}

export async function purchasePlan(plan: 'monthly' | 'yearly'): Promise<PurchaseResult> {
  const sku = PRODUCT_SKUS[plan];
  const paymentRequest = new PaymentRequest(
    [{ supportedMethods: 'https://play.google.com/billing', data: { sku } }],
    { total: { label: 'Kepi', amount: { currency: 'TRY', value: '0' } } },
  );
  const paymentData = (await paymentRequest.show()) as { purchaseToken?: string; productId?: string };
  if (!paymentData?.purchaseToken) throw new Error('Ödeme iptal edildi');
  return { purchaseToken: paymentData.purchaseToken, productId: paymentData.productId ?? sku };
}

export async function acknowledgePurchase(token: string): Promise<void> {
  const svc = await getDGService();
  if (!svc) return;
  try { await svc.acknowledge(token); } catch { /* ignore */ }
}
