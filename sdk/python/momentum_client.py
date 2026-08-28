from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx


@dataclass
class MomentumClient:
    """Synchronous client for Momentum API v1."""

    api_key: str
    base_url: str = "https://momentum-api-public.manikandanruki2004.workers.dev"
    timeout: float = 30.0

    def _get(self, path: str, **kwargs: Any) -> dict[str, Any]:
        with httpx.Client(timeout=self.timeout) as client:
            response = client.get(
                f"{self.base_url.rstrip('/')}{path}",
                headers={"X-API-Key": self.api_key},
                **kwargs,
            )
            response.raise_for_status()
            return response.json()

    def momentum(
        self,
        *,
        language: str | None = None,
        min_stars: int = 100,
        max_age_days: int = 3650,
        limit: int = 5,
    ) -> dict[str, Any]:
        """Return repositories ranked by Momentum score."""
        if not 0 <= min_stars <= 1_000_000:
            raise ValueError("min_stars must be between 0 and 1,000,000")
        if not 1 <= max_age_days <= 36_500:
            raise ValueError("max_age_days must be between 1 and 36,500")
        if not 1 <= limit <= 20:
            raise ValueError("limit must be between 1 and 20")

        params: dict[str, Any] = {
            "min_stars": min_stars,
            "max_age_days": max_age_days,
            "limit": limit,
        }
        if language:
            params["language"] = language
        return self._get("/v1/momentum", params=params)

    def me(self) -> dict[str, Any]:
        """Return the authenticated account, plan, and current usage summary."""
        return self._get("/v1/me")
