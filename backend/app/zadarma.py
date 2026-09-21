"""Zadarma API client.

Handles authenticated requests to https://api.zadarma.com/v1/ including
signature generation, fetching PBX call statistics, and downloading
recording files.

Requires ZADARMA_API_KEY and ZADARMA_API_SECRET environment variables.
"""

import hashlib
import hmac
import logging
import time
from base64 import b64encode
from urllib.parse import urlencode

import httpx

logger = logging.getLogger("suhbatdosh.zadarma")

BASE_URL = "https://api.zadarma.com/v1"


def _sign(method: str, params: dict, secret: str) -> str:
    """Generate the HMAC-SHA1 signature required by the Zadarma API.

    Algorithm (from Zadarma docs):
      1. Sort params by key alphabetically
      2. Build query string (RFC 1738 encoding)
      3. string_to_sign = METHOD + request_path + md5(query_string)
      4. hash = HMAC-SHA1(string_to_sign, secret)
      5. base64-encode the hash
    """
    sorted_params = dict(sorted(params.items()))
    params_str = urlencode(sorted_params, quote_via=lambda s, *a, **kw: s)
    md5_params = hashlib.md5(params_str.encode()).hexdigest()
    # method is e.g. "/v1/statistics/pbx/"
    string_to_sign = f"{method}{params_str}{md5_params}"
    signature = hmac.new(secret.encode(), string_to_sign.encode(), hashlib.sha1).digest()
    return b64encode(signature).decode()


class ZadarmaClient:
    """Thin wrapper around the Zadarma REST API."""

    def __init__(self, api_key: str, api_secret: str):
        self.api_key = api_key
        self.api_secret = api_secret
        self._http = httpx.Client(timeout=30)

    def _request(self, method: str, path: str, params: dict | None = None) -> dict:
        """Make an authenticated GET request and return the parsed JSON body."""
        params = params or {}
        signature = _sign(path, params, self.api_secret)
        headers = {"Authorization": f"{self.api_key}:{signature}"}
        url = f"{BASE_URL}{path}"
        resp = self._http.get(url, params=params, headers=headers)
        resp.raise_for_status()
        return resp.json()

    def _request_post(self, path: str, data: dict | None = None) -> dict:
        """Make an authenticated POST request and return the parsed JSON body."""
        data = data or {}
        signature = _sign(path, data, self.api_secret)
        headers = {
            "Authorization": f"{self.api_key}:{signature}",
            "Content-Type": "application/x-www-form-urlencoded",
        }
        url = f"{BASE_URL}{path}"
        resp = self._http.post(url, data=data, headers=headers)
        resp.raise_for_status()
        return resp.json()

    def get_balance(self) -> dict:
        """Return the user's balance info."""
        return self._request("GET", "/v1/info/balance/")

    def get_pbx_statistics(
        self,
        start: str,
        end: str,
        version: int = 2,
        skip: int = 0,
        limit: int = 1000,
    ) -> dict:
        """Fetch PBX call statistics for a date range.

        Args:
            start: "YYYY-MM-DD HH:MM:SS"
            end: "YYYY-MM-DD HH:MM:SS"
            version: stats format version (2 = new)
            skip: offset for pagination
            limit: max rows (1–1000)

        Returns the full API response dict with ``stats`` list.
        """
        params = {
            "start": start,
            "end": end,
            "version": str(version),
            "skip": str(skip),
            "limit": str(limit),
        }
        return self._request("GET", "/v1/statistics/pbx/", params)

    def get_record_link(
        self, call_id: str | None = None, pbx_call_id: str | None = None, lifetime: int = 1800
    ) -> dict:
        """Request a temporary download link for a call recording.

        Exactly one of ``call_id`` or ``pbx_call_id`` must be provided.
        Returns ``{"status": "success", "link": "...", "lifetime_till": "..."}``
        or a dict with ``"links": [...]`` when ``pbx_call_id`` yields multiple
        recordings.
        """
        params: dict[str, str] = {"lifetime": str(lifetime)}
        if call_id:
            params["call_id"] = call_id
        if pbx_call_id:
            params["pbx_call_id"] = pbx_call_id
        return self._request("GET", "/v1/pbx/record/request/", params)

    def download_recording(self, url: str) -> bytes:
        """Download the raw audio bytes from a recording link.

        The URL is the one returned by :meth:`get_record_link`.
        """
        resp = self._http.get(url, headers={"Authorization": f"{self.api_key}:"})
        resp.raise_for_status()
        return resp.content
