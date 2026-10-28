"""Synthetic signed HTTP failures; no live requests, credentials or rendering."""
import io
import time
import unittest
import urllib.error
from unittest.mock import patch
from client import Client, RequestError, signature, PREFIX
from contract import canonical


class ClientErrorTests(unittest.TestCase):
    def fail(self, operation, body, valid=True):
        secret = "synthetic-test-key-not-a-credential" * 2
        client = Client("https://example.invalid/factory", "test-agent", secret)

        def respond(request, timeout):
            nonce = request.get_header("X-factory-nonce")
            timestamp = str(int(time.time()))
            data = canonical(body)
            headers = {"X-Factory-Timestamp": timestamp, "X-Factory-Nonce": nonce,
                "X-Factory-Signature": signature(secret, timestamp, nonce, "RESPONSE", PREFIX + "/" + operation, data) if valid else "bad"}
            raise urllib.error.HTTPError(request.full_url, 400, "unsafe message", headers, io.BytesIO(data))

        with patch("client.urllib.request.build_opener") as opener:
            opener.return_value.open.side_effect = respond
            with self.assertRaises(RequestError) as caught:
                client.request(operation, {"schema_version": 1})
        return caught.exception

    def test_signed_400_retains_exact_operation_and_error(self):
        for operation, code in [("events", "invalid_event"), ("assets", "invalid_asset"), ("heartbeat", "schema_version")]:
            with self.subTest(operation=operation):
                error = self.fail(operation, {"schema_version": 1, "error": code})
                self.assertEqual((error.operation, error.status, error.code), (operation, 400, code))

    def test_unsigned_error_is_not_trusted(self):
        error = self.fail("events", {"schema_version": 1, "error": "invalid_event"}, valid=False)
        self.assertEqual(error.code, "unverified_error_response")

    def test_arbitrary_remote_text_and_secrets_are_not_logged(self):
        error = self.fail("events", {"schema_version": 1, "error": "private-token https://private.invalid", "detail": "private-detail"})
        self.assertEqual(error.code, "unrecognized_remote_error")
        self.assertNotIn("private", str(error))
        self.assertNotIn("unsafe message", str(error))

    def test_invalid_json_is_redacted(self):
        error = self.fail("claim", ["private-data"])
        self.assertEqual(error.code, "unverified_error_response")


if __name__ == "__main__":
    unittest.main()