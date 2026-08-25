from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx


@dataclass
class MomentumClient:
    api_key: str
    base_url: str = "https://api.yourdomain.com"
    timeout: float = 20.0

    def momentum(
        self,
        *,
        language: str | None = None,
        min_stars: int = 100,
        max_age_days: int = 3650,
        limit: int = 10,
    ) -> dict[str, Any]:
        params = {
            "language": language,
            "min_stars": min_stars,
            "max_age_days": max_age_days,
            "limit": limit,
        }
        params = {k: v for k, v in params.items() if v is not None}
        with httpx.Client(timeout=self.timeout) as client:
            response = client.get(
                f"{self.base_url.rstrip('/')}/v1/momentum",
                params=params,
                headers={"X-API-Key": self.api_key},
            )
            response.raise_for_status()
            return response.json()
