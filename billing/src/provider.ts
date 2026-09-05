export type RazorpaySubscriptionPayload = {
  plan_id: string;
  total_count: number;
  quantity: number;
  customer_notify: boolean;
  notes: Record<string, string>;
};

export type RazorpaySubscriptionResponse = {
  id?: string;
  short_url?: string;
  status?: string;
  plan_id?: string;
  error?: { code?: string; description?: string };
};

export type ProviderResult = {
  ok: boolean;
  status: number;
  data: RazorpaySubscriptionResponse;
};

export interface BillingProvider {
  createSubscription(payload: RazorpaySubscriptionPayload): Promise<ProviderResult>;
}

export class RazorpayProvider implements BillingProvider {
  constructor(
    private readonly keyId: string,
    private readonly keySecret: string,
    private readonly timeoutMs = 8000,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async createSubscription(payload: RazorpaySubscriptionPayload): Promise<ProviderResult> {
    const auth = btoa(`${this.keyId}:${this.keySecret}`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl("https://api.razorpay.com/v1/subscriptions", {
        method: "POST",
        headers: {
          authorization: `Basic ${auth}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      let data: RazorpaySubscriptionResponse = {};
      try {
        data = await response.json() as RazorpaySubscriptionResponse;
      } catch {
        data = {};
      }
      return { ok: response.ok, status: response.status, data };
    } finally {
      clearTimeout(timer);
    }
  }
}
