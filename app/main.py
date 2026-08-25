import os

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import Response

ENGINE_BASE_URL = os.getenv("ENGINE_BASE_URL", "http://momentum-engine-staging:8000").rstrip("/")
ENGINE_SHARED_SECRET = os.getenv("ENGINE_SHARED_SECRET", "")

app = FastAPI(title="Momentum API Gateway", version="1.0.0")


async def proxy(request: Request, path: str) -> Response:
    params = list(request.query_params.multi_items())
    headers = {
        "Accept": request.headers.get("accept", "application/json"),
        "X-API-Key": request.headers.get("x-api-key", ""),
        "X-Forwarded-For": request.client.host if request.client else "unknown",
    }
    if ENGINE_SHARED_SECRET:
        headers["X-Engine-Secret"] = ENGINE_SHARED_SECRET

    body = await request.body()
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.request(
            request.method,
            f"{ENGINE_BASE_URL}/{path.lstrip('/')}",
            params=params,
            headers=headers,
            content=body,
        )

    passthrough = {"content-type", "cache-control", "x-request-id", "x-api-version", "x-response-time-ms"}
    response_headers = {k: v for k, v in response.headers.items() if k.lower() in passthrough}
    return Response(content=response.content, status_code=response.status_code, headers=response_headers)


@app.get("/health", tags=["health"])
async def health() -> Response:
    return await proxy(Request(scope={"type": "http", "method": "GET", "path": "/health", "query_string": b"", "headers": []}), "health")


@app.get("/version", tags=["health"])
async def version() -> Response:
    return await proxy(Request(scope={"type": "http", "method": "GET", "path": "/version", "query_string": b"", "headers": []}), "version")


@app.get("/v1/momentum", tags=["momentum"])
async def momentum(request: Request) -> Response:
    return await proxy(request, "v1/momentum")
