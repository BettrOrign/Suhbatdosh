"""Zadarma API client.

Handles authenticated requests to https://api.zadarma.com/v1/ including
signature generation, fetching PBX call statistics, and downloading
recording files.

Requires ZADARMA_API_KEY and ZADARMA_API_SECRET environment variables.
"""

import hashlib
import hmac
import logging
from base64 import b64encode
from collections import OrderedDict
from urllib.parse import urlencode

import httpx

logger = logging.getLogger("suhbatdosh.zadarma")

BASE_URL = "https://api.zadarma.com"


def _sign(method: str, params_str: str, secret: str) -> str:
    """Generate the HMAC-SHA1 signature required by the Zadarma API.

    Matches the official Python library exactly:
      string_to_sign = method + params_string + md5(params_string)
      signature = base64(HMAC-SHA1(string_to_sign, secret).hexdigest())
    """
    data = method + params_str + hashlib.md5(params_str.encode("utf-8")).hexdigest()
    hmac_h = hmac.new(secret.encode("utf-8"), data.encode("utf-8"), hashlib.sha1)
    return b64encode(bytes(hmac_h.hexdigest(), "utf-8")).decode()


class ZadarmaClient:
    """Thin wrapper around the Zadarma REST API."""

    def __init__(self, api_key: str, api_secret: str):
        self.api_key = api_key
        self.api_secret = api_secret
        self._http = httpx.Client(timeout=30)

    def _request(self, method: str, path: str, params: dict | None = None) -> dict:
        """Make an authenticated GET request and return the parsed JSON body."""
        params = params or {}
        params["format"] = "json"
        params_str = urlencode(OrderedDict(sorted(params.items())))
        signature = _sign(path, params_str, self.api_secret)
        headers = {"Authorization": f"{self.api_key}:{signature}"}
        url = f"{BASE_URL}{path}?{params_str}"
        resp = self._http.get(url, headers=headers)
        resp.raise_for_status()
        return resp.json()

    def _request_post(self, path: str, data: dict | None = None) -> dict:
        """Make an authenticated POST request and return the parsed JSON body."""
        data = data or {}
        data["format"] = "json"
        params_str = urlencode(OrderedDict(sorted(data.items())))
        signature = _sign(path, params_str, self.api_secret)
        headers = {
            "Authorization": f"{self.api_key}:{signature}",
            "Content-Type": "application/x-www-form-urlencoded",
        }
        url = f"{BASE_URL}{path}"
        resp = self._http.post(url, data=params_str, headers=headers)
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
            limit: max rows (1-1000)

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
