"""Outbound-only signed KyLogic client with signed, bounded responses."""
import hashlib
import hmac
import json
import time
import urllib.error
import urllib.request
from urllib.parse import urlsplit
import uuid
from contract import canonical

PREFIX = "/api/public/video-factory/v1"
MAX_RESPONSE = 1024 * 1024
REMOTE_ERRORS = frozenset({'invalid_json', 'schema_version', 'lookup_failed', 'recipe_unavailable',
    'invalid_asset', 'asset_unavailable', 'asset_checksum_failed', 'store_failed',
    'invalid_event', 'event_conflict'})


class RequestError(Exception):
    """Only authenticated fixed codes, never remote free text."""
    def __init__(self, operation, status, code):
        self.operation, self.status, self.code = operation, status, code
        super().__init__(f'operation={operation} http={status} reason={code}')


def signature(secret, timestamp, nonce, method, path, body):
    message = f"{timestamp}.{nonce}.{method}.{path}.{hashlib.sha256(body).hexdigest()}".encode()
    return hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Client:
    def __init__(self, origin, agent_id, secret):
        parsed = urlsplit(origin)
        # KyLogic endpoint base, e.g. https://<project>.supabase.co/functions/v1/video-factory
        if parsed.scheme != "https" or parsed.username or parsed.password or parsed.port or parsed.query or parsed.fragment:
            raise ValueError("https_origin_required")
        if len(secret) < 32:
            raise ValueError("dedicated_machine_secret_required")
        self.origin, self.agent_id, self.secret = origin.rstrip("/"), agent_id, secret

    def request(self, operation, payload):
        if operation not in {"claim", "events", "heartbeat", "assets"}:
            raise ValueError("endpoint_not_allowed")
        path = PREFIX + "/" + operation
        body = canonical(payload)
        nonce, timestamp = str(uuid.uuid4()), str(int(time.time()))
        request = urllib.request.Request(self.origin + "/" + operation, data=body, method="POST", headers={
            "Content-Type": "application/json", "User-Agent": "kylo-video-factory/1.0", "X-Factory-Agent": self.agent_id,
            "X-Factory-Timestamp": timestamp, "X-Factory-Nonce": nonce,
            "X-Factory-Signature": signature(self.secret, timestamp, nonce, "POST", path, body)})
        try:
            response = urllib.request.build_opener(NoRedirect).open(request, timeout=25)
        except urllib.error.HTTPError as error:
            status = error.code
            with error:
                try:
                    result = self._response(error, path, nonce)
                    code = result.get('error')
                    if not isinstance(code, str) or code not in REMOTE_ERRORS:
                        code = 'unrecognized_remote_error'
                except (ValueError, UnicodeError):
                    code = 'unverified_error_response'
            raise RequestError(operation, status, code) from None
        with response:
            return self._response(response, path, nonce)

    def _response(self, response, path, nonce):
            data = response.read(MAX_RESPONSE + 1)
            stamp = response.headers.get("X-Factory-Timestamp", "")
            received_nonce = response.headers.get("X-Factory-Nonce", "")
            expected = signature(self.secret, stamp, nonce, "RESPONSE", path, data)
            if len(data) > MAX_RESPONSE or received_nonce != nonce or not stamp.isdigit() or abs(int(stamp) - time.time()) > 120 or not hmac.compare_digest(expected, response.headers.get("X-Factory-Signature", "")):
                raise ValueError("response_verification_failed")
            result = json.loads(data)
            if not isinstance(result, dict) or result.get("schema_version") != 1:
                raise ValueError("invalid_response")
            return result