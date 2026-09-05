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
  customer_id?: string | null;
  current_start?: number | null;
  current_end?: number | null;
  ended_at?: number | null;
  error?: { code?: string; description?: string };
};

export type ProviderResult = {
  ok: boolean;
  status: number;
  data: RazorpaySubscriptionResponse;
};

export interface BillingProvider {
  createSubscription(payload: RazorpaySubscriptionPayload): Promise<ProviderResult>;
  getSubscription(subscriptionId: string): Promise<ProviderResult>;
}

export class RazorpayProvider implements BillingProvider {
  constructor(
    private readonly keyId: string,
    private readonly keySecret: string,
    private readonly timeoutMs = 8000,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async request(url: string, init: RequestInit, retryableRead = false): Promise<ProviderResult> {
    const auth = btoa(`${this.keyId}:${this.keySecret}`);
    const maxAttempts = retryableRead ? 3 : 1;
    let lastResult: ProviderResult = { ok: false, status: 503, data: { error: { code: "PROVIDER_UNAVAILABLE" } } };

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(url, {
          ...init,
          headers: {
            authorization: `Basic ${auth}`,
            accept: "application/json",
            "content-type": "application/json",
            ...(init.headers ?? {}),
          },
          signal: controller.signal,
        });
        let data: RazorpaySubscriptionResponse = {};
        try {
          data = await response.json() as RazorpaySubscriptionResponse;
        } catch {
          data = {};
        }
        lastResult = { ok: response.ok, status: response.status, data };
        if (!retryableRead || response.ok || (response.status !== 429 && response.status < 500) || attempt === maxAttempts - 1) return lastResult;
      } finally {
        clearTimeout(timer);
      }

      const delayMs = Math.min(400, 100 * 2 ** attempt);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    return lastResult;
  }

  async createSubscription(payload: RazorpaySubscriptionPayload): Promise<ProviderResult> {
    return this.request("https://api.razorpay.com/v1/subscriptions", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async getSubscription(subscriptionId: string): Promise<ProviderResult> {
    if (!/^sub_[A-Za-z0-9]+$/.test(subscriptionId)) {
      return { ok: false, status: 400, data: { error: { code: "INVALID_SUBSCRIPTION_ID", description: "Invalid subscription id" } } };
    }
    return this.request(`https://api.razorpay.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, {
      method: "GET",
    }, true);
  }
}
