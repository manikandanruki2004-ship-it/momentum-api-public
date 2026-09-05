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
  halfOpen: boolean;
};

const READ_FAILURE_THRESHOLD = 3;
const READ_OPEN_MS = 5000;
const readCircuit: CircuitState = { failures: 0, openUntil: 0, halfOpen: false };

function circuitOpen() {
  const now = Date.now();
  if (readCircuit.openUntil <= now) {
    if (readCircuit.openUntil !== 0) {
      readCircuit.openUntil = 0;
      readCircuit.halfOpen = true;
    }
    return false;
  }
  return !readCircuit.halfOpen;
}

function circuitPermit() {
  if (!circuitOpen()) return true;
  return false;
}

function circuitSuccess() {
  readCircuit.failures = 0;
  readCircuit.openUntil = 0;
  readCircuit.halfOpen = false;
}

function circuitFailure() {
  readCircuit.failures += 1;
  readCircuit.halfOpen = false;
  if (readCircuit.failures >= READ_FAILURE_THRESHOLD) readCircuit.openUntil = Date.now() + READ_OPEN_MS;
}

export class RazorpayProvider implements BillingProvider {
  constructor(
    private readonly keyId: string,
    private readonly keySecret: string,
    private readonly timeoutMs = 8000,
    private readonly readTimeoutMs = 2500,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async request(url: string, init: RequestInit, retryableRead = false): Promise<ProviderResult> {
    if (retryableRead && !circuitPermit()) return { ok: false, status: 503, data: { error: { code: "PROVIDER_CIRCUIT_OPEN" } } };
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
            if (retryableRead && response.ok) circuitSuccess();
            else if (retryableRead && !response.ok) circuitFailure();
            return lastResult;
          }
        } finally {
          clearTimeout(timer);
        }

        const delayMs = Math.min(400, 100 * 2 ** attempt);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    } catch (error) {
      if (retryableRead) circuitFailure();
      throw error;
    }

    if (retryableRead) circuitFailure();
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
