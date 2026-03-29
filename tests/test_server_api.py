import json
import os
import re
import subprocess
import sys
import time
import unittest
import urllib.error
import urllib.request


class ServerApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.port = 50101
        env = os.environ.copy()
        env["SMARTNOTES_DISABLE_MCP"] = "1"
        cls.proc = subprocess.Popen(
            [sys.executable, "server.py", "--port", str(cls.port), "--no-browser", "--daemon"],
            cwd=os.path.dirname(os.path.dirname(__file__)),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )

        deadline = time.time() + 20
        ok = False
        while time.time() < deadline:
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{cls.port}/api/default-model", timeout=2).read()
                ok = True
                break
            except Exception:
                time.sleep(0.3)

        if not ok:
            output = ""
            try:
                output = cls.proc.stdout.read()
            except Exception:
                pass
            raise RuntimeError(f"Server did not start in time. Output: {output}")

    @classmethod
    def tearDownClass(cls):
        if cls.proc and cls.proc.poll() is None:
            cls.proc.terminate()
            try:
                cls.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                cls.proc.kill()

    def _get_json(self, url):
        with urllib.request.urlopen(url, timeout=5) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))

    def _post_json(self, url, payload):
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))

    def _post_json_expect_error(self, url, payload):
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(req, timeout=5)
        return ctx.exception.code, json.loads(ctx.exception.read().decode("utf-8"))

    def _post_raw_expect_error(self, url, raw_body):
        req = urllib.request.Request(
            url,
            data=raw_body,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(req, timeout=5)
        return ctx.exception.code, json.loads(ctx.exception.read().decode("utf-8"))

    def _cleanup_note_file(self, note_id):
        notes_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "notes")
        if not os.path.isdir(notes_dir):
            return

        prefix = re.escape(str(note_id)) + r"__"
        for filename in os.listdir(notes_dir):
            if re.match(prefix, filename):
                try:
                    os.remove(os.path.join(notes_dir, filename))
                except Exception:
                    pass

    def test_default_model_endpoint(self):
        status, payload = self._get_json(f"http://127.0.0.1:{self.port}/api/default-model")
        self.assertEqual(status, 200)
        self.assertIn("model", payload)
        self.assertTrue(payload["model"])
        self.assertEqual(payload.get("schemaVersion"), "v1")

    def test_unknown_api_returns_404_json(self):
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(f"http://127.0.0.1:{self.port}/api/not-a-real-endpoint", timeout=5)
        self.assertEqual(ctx.exception.code, 404)
        body = json.loads(ctx.exception.read().decode("utf-8"))
        self.assertIn("error", body)

    def test_control_status_endpoint(self):
        status, payload = self._get_json("http://127.0.0.1:50002/control/status")
        self.assertEqual(status, 200)
        self.assertIn("is_running", payload)
        self.assertIn("port", payload)

    def test_index_page_smoke(self):
        with urllib.request.urlopen(f"http://127.0.0.1:{self.port}/", timeout=5) as resp:
            html = resp.read().decode("utf-8")
            self.assertEqual(resp.status, 200)
            self.assertIn("SmartNotes", html)
            self.assertIn("id=\"search-input\"", html)

    def test_api_validation_generate_requires_prompt(self):
        code, body = self._post_json_expect_error(f"http://127.0.0.1:{self.port}/api/generate", {"model": "x"})
        self.assertEqual(code, 400)
        self.assertIn("error", body)

    def test_api_validation_chat_requires_messages(self):
        code, body = self._post_json_expect_error(f"http://127.0.0.1:{self.port}/api/chat", {"model": "x"})
        self.assertEqual(code, 400)
        self.assertIn("error", body)

    def test_api_validation_rejects_non_boolean_stream(self):
        code, body = self._post_json_expect_error(
            f"http://127.0.0.1:{self.port}/api/generate",
            {"model": "x", "prompt": "hello", "stream": "yes"},
        )
        self.assertEqual(code, 400)
        self.assertIn("error", body)

    def test_api_validation_embeddings_requires_prompt(self):
        code, body = self._post_json_expect_error(f"http://127.0.0.1:{self.port}/api/embeddings", {"model": "x"})
        self.assertEqual(code, 400)
        self.assertIn("error", body)

    def test_api_rejects_invalid_json_body(self):
        code, body = self._post_raw_expect_error(
            f"http://127.0.0.1:{self.port}/api/model",
            b"{invalid",
        )
        self.assertEqual(code, 400)
        self.assertEqual(body.get("error"), "Invalid JSON body")

    def test_model_roundtrip(self):
        _, current = self._get_json(f"http://127.0.0.1:{self.port}/api/default-model")
        original = current.get("model")
        temp_model = f"contract-test-model-{int(time.time())}"

        try:
            code, set_payload = self._post_json(
                f"http://127.0.0.1:{self.port}/api/model",
                {"model": temp_model},
            )
            self.assertEqual(code, 200)
            self.assertTrue(set_payload.get("ok"))
            self.assertEqual(set_payload.get("schemaVersion"), "v1")

            _, updated = self._get_json(f"http://127.0.0.1:{self.port}/api/default-model")
            self.assertEqual(updated.get("model"), temp_model)
        finally:
            if original:
                self._post_json(
                    f"http://127.0.0.1:{self.port}/api/model",
                    {"model": original},
                )

    def test_file_notes_sync_and_load_roundtrip(self):
        note_id = f"contract-note-{int(time.time() * 1000)}"
        note = {
            "id": note_id,
            "title": "Contract Test",
            "body": "Roundtrip body",
            "tags": ["test/contracts"],
            "updatedAt": int(time.time() * 1000),
            "folderId": "tests",
        }

        try:
            status, payload = self._post_json(
                f"http://127.0.0.1:{self.port}/api/file-notes/sync",
                {"notes": [note]},
            )
            self.assertEqual(status, 200)
            self.assertTrue(payload.get("ok"))
            self.assertGreaterEqual(payload.get("written", 0), 1)

            _, loaded = self._get_json(f"http://127.0.0.1:{self.port}/api/file-notes/load")
            notes = loaded.get("notes", [])
            found = next((n for n in notes if n.get("id") == note_id), None)
            self.assertIsNotNone(found)
            self.assertEqual(found.get("title"), "Contract Test")
        finally:
            self._cleanup_note_file(note_id)

    def test_file_notes_sync_requires_notes_array(self):
        code, body = self._post_json_expect_error(
            f"http://127.0.0.1:{self.port}/api/file-notes/sync",
            {"notes": "invalid"},
        )
        self.assertEqual(code, 400)
        self.assertIn("error", body)

    def test_control_api_invalid_action(self):
        code, body = self._post_json_expect_error(
            "http://127.0.0.1:50002/control",
            {"action": "does-not-exist"},
        )
        self.assertEqual(code, 400)
        self.assertEqual(body.get("error"), "invalid action")

    def test_control_select_model_requires_model(self):
        code, body = self._post_json_expect_error(
            "http://127.0.0.1:50002/control",
            {"action": "select_model"},
        )
        self.assertEqual(code, 400)
        self.assertEqual(body.get("error"), "model is required")


if __name__ == "__main__":
    unittest.main()
