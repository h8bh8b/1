"""
GMGN OpenAPI client — wraps https://openapi.gmgn.ai endpoints.
Docs: https://github.com/GMGNAI/gmgn-skills
"""

import hashlib
import time
from typing import Any, Optional

import httpx
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import load_pem_private_key
import base64
import json

BASE_URL = "https://openapi.gmgn.ai"
DEFAULT_TIMEOUT = 15


class GMGNError(Exception):
    def __init__(self, code: int, message: str):
        self.code = code
        self.message = message
        super().__init__(f"[{code}] {message}")


class GMGNClient:
    def __init__(self, api_key: str, private_key_pem: Optional[str] = None):
        self.api_key = api_key
        self._private_key: Optional[Ed25519PrivateKey] = None
        if private_key_pem:
            pem_bytes = private_key_pem.replace("\\n", "\n").encode()
            self._private_key = load_pem_private_key(pem_bytes, password=None)
        self._client = httpx.AsyncClient(base_url=BASE_URL, timeout=DEFAULT_TIMEOUT)

    def _auth_headers(self, body: Optional[bytes] = None) -> dict:
        headers = {"X-APIKEY": self.api_key}
        if body is not None and self._private_key:
            sig = self._private_key.sign(body)
            headers["X-Signature"] = base64.b64encode(sig).decode()
        return headers

    async def _get(self, path: str, params: dict = None) -> Any:
        resp = await self._client.get(path, params=params, headers=self._auth_headers())
        data = resp.json()
        if data.get("code", 0) != 0:
            raise GMGNError(data.get("code", -1), data.get("msg", data.get("message", "Unknown error")))
        return data.get("data", data)

    async def _post(self, path: str, body: dict) -> Any:
        raw = json.dumps(body, separators=(",", ":")).encode()
        resp = await self._client.post(path, content=raw,
                                       headers={**self._auth_headers(raw), "Content-Type": "application/json"})
        data = resp.json()
        if data.get("code", 0) != 0:
            raise GMGNError(data.get("code", -1), data.get("msg", data.get("message", "Unknown error")))
        return data.get("data", data)

    async def close(self):
        await self._client.aclose()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        await self.close()

    # ── Token ──────────────────────────────────────────────────────────────

    async def token_info(self, chain: str, address: str) -> dict:
        return await self._get("/v1/token/info", {"chain": chain, "address": address})

    async def token_security(self, chain: str, address: str) -> dict:
        return await self._get("/v1/token/security", {"chain": chain, "address": address})

    async def token_pool(self, chain: str, address: str) -> dict:
        return await self._get("/v1/token/pool_info", {"chain": chain, "address": address})

    async def token_holders(self, chain: str, address: str, limit: int = 10,
                             order_by: str = "amount_percentage") -> dict:
        return await self._get("/v1/market/token_top_holders",
                               {"chain": chain, "address": address, "limit": limit, "orderby": order_by})

    async def token_traders(self, chain: str, address: str, limit: int = 10,
                             order_by: str = "profit") -> dict:
        return await self._get("/v1/market/token_top_traders",
                               {"chain": chain, "address": address, "limit": limit, "orderby": order_by})

    # ── Market ─────────────────────────────────────────────────────────────

    async def market_trending(self, chain: str, interval: str = "1h",
                               limit: int = 20, order_by: str = "default") -> dict:
        return await self._get("/v1/market/rank",
                               {"chain": chain, "interval": interval, "limit": limit, "orderby": order_by})

    async def market_kline(self, chain: str, address: str, resolution: str,
                            from_ts: Optional[int] = None, to_ts: Optional[int] = None) -> dict:
        params = {"chain": chain, "address": address, "resolution": resolution}
        if from_ts:
            params["from"] = from_ts
        if to_ts:
            params["to"] = to_ts
        return await self._get("/v1/market/token_kline", params)

    async def market_trenches(self, chain: str, type_: str = "completed",
                               limit: int = 20) -> dict:
        return await self._post("/v1/trenches",
                                {"chain": chain, "type": [type_], "limit": limit})

    # ── Portfolio ──────────────────────────────────────────────────────────

    async def wallet_holdings(self, chain: str, wallet: str, limit: int = 20) -> dict:
        return await self._get("/v1/user/wallet_holdings",
                               {"chain": chain, "wallet": wallet, "limit": limit})

    async def wallet_activity(self, chain: str, wallet: str, limit: int = 20) -> dict:
        return await self._get("/v1/user/wallet_activity",
                               {"chain": chain, "wallet": wallet, "limit": limit})

    async def wallet_stats(self, chain: str, wallet: str, period: str = "30d") -> dict:
        return await self._get("/v1/user/wallet_stats",
                               {"chain": chain, "wallet": wallet, "period": period})
