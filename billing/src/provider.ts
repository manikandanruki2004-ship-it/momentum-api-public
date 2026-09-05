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

type CircuitState = {
  failures: number;
  openUntil: number;
  probeInFlight: boolean;
};

const READ_FAILURE_THRESHOLD = 3;
const READ_OPEN_MS = 5000;

class ReadCircuitBreaker {
  private readonly state: CircuitState = { failures: 0, openUntil: 0, probeInFlight: false };

  permit() {
    const now = Date.now();
    const open = this.state.openUntil > now;
    if (open) return false;
    if (this.state.openUntil !== 0) {
      if (this.state.probeInFlight) return false;
      this.state.probeInFlight = true;
      return true;
    }
    return true;
  }

  success() {
    this.state.failures = 0;
    this.state.openUntil = 0;
    this.state.probeInFlight = false;
  }

  failure() {
    this.state.failures += 1;
    if (this.state.failures >= READ_FAILURE_THRESHOLD) this.state.openUntil = Date.now() + READ_OPEN_MS;
    this.state.probeInFlight = false;
  }
}

export class RazorpayProvider implements BillingProvider {
  private readonly readCircuit = new ReadCircuitBreaker();

  constructor(
    private readonly keyId: string,
    private readonly keySecret: string,
    private readonly timeoutMs = 8000,
    private readonly readTimeoutMs = 2500,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async request(url: string, init: RequestInit, retryableRead = false): Promise<ProviderResult> {
    if (retryableRead && !this.readCircuit.permit()) return { ok: false, status: 503, data: { error: { code: "PROVIDER_CIRCUIT_OPEN" } } };
    const auth = btoa(`${this.keyId}:${this.keySecret}`);
    const maxAttempts = retryableRead ? 3 : 1;
    const attemptTimeoutMs = retryableRead ? this.readTimeoutMs : this.timeoutMs;
    let lastResult: ProviderResult = { ok: false, status: 503, data: { error: { code: "PROVIDER_UNAVAILABLE" } } };

    try {
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), attemptTimeoutMs);
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
          if (!retryableRead || response.ok || (response.status !== 429 && response.status < 500) || attempt === maxAttempts - 1) {
            if (retryableRead && response.ok) this.readCircuit.success();
            else if (retryableRead && !response.ok) this.readCircuit.failure();
            return lastResult;
          }
        } finally {
          clearTimeout(timer);
        }

        const delayMs = Math.min(400, 100 * 2 ** attempt);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    } catch (error) {
      if (retryableRead) this.readCircuit.failure();
      throw error;
    }

    if (retryableRead) this.readCircuit.failure();
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
