const DEFAULT_BASE_URL = "https://momentum-api-public.manikandanruki2004.workers.dev";

export class MomentumClient {
  constructor({ apiKey, baseUrl = DEFAULT_BASE_URL, timeoutMs = 30000 } = {}) {
    if (!apiKey || typeof apiKey !== "string") {
      throw new Error("apiKey is required");
    }
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.timeoutMs = timeoutMs;
  }

  async momentum({ language, minStars = 100, maxAgeDays = 3650, limit = 5 } = {}) {
    if (!Number.isInteger(minStars) || minStars < 0 || minStars > 1000000) {
      throw new Error("minStars must be an integer between 0 and 1,000,000");
    }
    if (!Number.isInteger(maxAgeDays) || maxAgeDays < 1 || maxAgeDays > 36500) {
      throw new Error("maxAgeDays must be an integer between 1 and 36,500");
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
      throw new Error("limit must be an integer between 1 and 20");
    }

    const params = new URLSearchParams({
      min_stars: String(minStars),
      max_age_days: String(maxAgeDays),
      limit: String(limit),
    });
    if (language) params.set("language", language);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/v1/momentum?${params}`, {
        method: "GET",
        headers: { "X-API-Key": this.apiKey },
        signal: controller.signal,
      });
      const payload = await response.json();
      if (!response.ok) {
        const message = payload?.error?.message ?? `HTTP ${response.status}`;
        const error = new Error(message);
        error.status = response.status;
        error.code = payload?.error?.code;
        error.requestId = payload?.error?.request_id;
        throw error;
      }
      return payload;
    } finally {
      clearTimeout(timeout);
    }
  }
}
