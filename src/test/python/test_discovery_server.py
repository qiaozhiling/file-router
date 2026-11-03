from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import tempfile
import sys
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "discovery-server"))
from server import create_app, DeviceStore, Heartbeat, render_page


class DiscoveryServerTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "devices.json"

    def test_empty_page_then_overwrite_and_reload_after_restart(self):
        with TestClient(create_app(self.path)) as client:
            self.assertIn("尚未收到服务地址", client.get("/").text)
            for address in ("http://10.13.4.75:8081/", "https://files.example.test/share/"):
                response = client.post("/api/heartbeat", json={"address": address})
                self.assertEqual(204, response.status_code)
                self.assertEqual(b"", response.content)
            state = json.loads(self.path.read_text(encoding="utf-8"))
            self.assertEqual("https://files.example.test/share/", state["address"])
            self.assertEqual(300, state["reportIntervalSeconds"])
            self.assertIsNotNone(datetime.fromisoformat(state["lastSeen"]).tzinfo)
        with TestClient(create_app(self.path)) as client:
            page = client.get("/")
            self.assertIn("https://files.example.test/share/", page.text)
            self.assertIn("最近有上报", page.text)
            self.assertEqual("no-store", page.headers["cache-control"])

    def test_invalid_input_does_not_replace_previous_record(self):
        with TestClient(create_app(self.path)) as client:
            client.post("/api/heartbeat", json={"address": "http://10.13.4.75:8081/"})
            before = self.path.read_bytes()
            for address in ("javascript:alert(1)", "file:///etc/passwd", "https://user:pass@example.test/",
                            "http://", "http://example.test:65536/", "http://example.test:0/",
                            "http://example.test/\n", "http://example.test\\evil/"):
                response = client.post("/api/heartbeat", json={"address": address})
                self.assertEqual(422, response.status_code, address)
            for interval in (0, -1, True, "300", 2147483648):
                response = client.post("/api/heartbeat", json={
                    "address": "http://10.13.4.88:8081/", "reportIntervalSeconds": interval})
                self.assertEqual(422, response.status_code)
            self.assertEqual(before, self.path.read_bytes())

    def test_client_timestamp_cannot_override_server_receipt_time(self):
        with TestClient(create_app(self.path)) as client:
            response = client.post("/api/heartbeat", json={
                "address": "http://10.13.4.75:8081/", "lastSeen": "2000-01-01T00:00:00+00:00"})
            self.assertEqual(204, response.status_code)
        state = json.loads(self.path.read_text(encoding="utf-8"))
        self.assertLess(abs((datetime.now(timezone.utc) - datetime.fromisoformat(state["lastSeen"])).total_seconds()), 10)

    def test_offline_status_respects_longer_heartbeat_interval_and_keeps_manual_link(self):
        record = {"address": "http://10.13.4.75:8081/", "reportIntervalSeconds": 300,
                  "lastSeen": (datetime.now(timezone.utc) - timedelta(minutes=16)).isoformat()}
        self.assertIn("可能离线", render_page(record))
        self.assertIn('href="http://10.13.4.75:8081/"', render_page(record))
        record["reportIntervalSeconds"] = 3600
        self.assertIn("最近有上报", render_page(record))

    def test_address_is_escaped_in_link_and_visible_text(self):
        with TestClient(create_app(self.path)) as client:
            address = 'https://example.test/?q="<script>alert(1)</script>&x=1'
            self.assertEqual(204, client.post("/api/heartbeat", json={"address": address}).status_code)
            page = client.get("/").text
            self.assertNotIn("<script>", page)
            self.assertIn("&quot;&lt;script&gt;", page)
            self.assertIn("&amp;x=1", page)

    def test_failed_atomic_replace_keeps_last_saved_state_and_cleans_temporary_file(self):
        with TestClient(create_app(self.path)) as client:
            client.post("/api/heartbeat", json={"address": "http://10.13.4.75:8081/"})
            before = self.path.read_bytes()
            with self.assertLogs(level="ERROR"), patch("server.os.replace", side_effect=OSError("disk full")):
                self.assertEqual(503, client.post("/api/heartbeat", json={
                    "address": "http://10.13.4.88:8081/"}).status_code)
            self.assertEqual(before, self.path.read_bytes())
            self.assertIn("http://10.13.4.75:8081/", client.get("/").text)
            self.assertEqual([], list(self.path.parent.glob("*.tmp")))

    def test_concurrent_updates_leave_valid_json_matching_memory(self):
        store = DeviceStore(self.path)
        with ThreadPoolExecutor(max_workers=8) as executor:
            list(executor.map(lambda i: store.update(Heartbeat(address=f"http://10.0.0.{i}:8081/")), range(1, 33)))
        self.assertEqual(json.loads(self.path.read_text(encoding="utf-8")), store.snapshot())
        self.assertEqual([], list(self.path.parent.glob("*.tmp")))

    def test_corrupt_file_fails_startup_and_is_preserved(self):
        self.path.write_text("broken JSON", encoding="utf-8")
        with self.assertRaises(ValueError):
            with TestClient(create_app(self.path)):
                pass
        self.assertEqual("broken JSON", self.path.read_text(encoding="utf-8"))

    def test_multiple_addresses_are_deduplicated_displayed_and_reloaded(self):
        addresses = ["http://10.13.4.75:8081/", "http://192.168.1.20:8081/"]
        with TestClient(create_app(self.path)) as client:
            response = client.post("/api/heartbeat", json={"addresses": addresses + [addresses[0]]})
            self.assertEqual(204, response.status_code)
            state = json.loads(self.path.read_text(encoding="utf-8"))
            self.assertEqual(addresses, state["addresses"])
            self.assertEqual(addresses[0], state["address"])
            page = client.get("/").text
            for address in addresses:
                self.assertIn(f'href="{address}"', page)
        with TestClient(create_app(self.path)) as client:
            page = client.get("/").text
            for address in addresses:
                self.assertIn(f'href="{address}"', page)
            self.assertIn("地址 2", page)

    def test_old_json_file_is_loaded_without_manual_migration(self):
        self.path.write_text(json.dumps({"address": "http://10.13.4.75:8081/",
                                        "lastSeen": datetime.now(timezone.utc).isoformat()}), encoding="utf-8")
        with TestClient(create_app(self.path)) as client:
            self.assertIn('href="http://10.13.4.75:8081/"', client.get("/").text)
            self.assertEqual(204, client.post("/api/heartbeat", json={
                "addresses": ["http://192.168.1.20:8081/"]}).status_code)
        self.assertEqual(["http://192.168.1.20:8081/"], json.loads(
            self.path.read_text(encoding="utf-8"))["addresses"])

    def test_address_removal_replaces_list_and_invalid_list_preserves_state(self):
        addresses = ["http://10.13.4.75:8081/", "http://192.168.1.20:8081/"]
        with TestClient(create_app(self.path)) as client:
            client.post("/api/heartbeat", json={"addresses": addresses})
            response = client.post("/api/heartbeat", json={"addresses": addresses[1:]})
            self.assertEqual(204, response.status_code)
            self.assertNotIn(addresses[0], client.get("/").text)
            before = self.path.read_bytes()
            for body in ({}, {"addresses": []}, {"addresses": addresses + ["javascript:alert(1)"]},
                         {"addresses": addresses * 33}, {"addresses": ["http://example.test/" + "x" * 2048]},
                         {"addresses": "http://10.13.4.75:8081/"}, {"addresses": [None]}):
                self.assertEqual(422, client.post("/api/heartbeat", json=body).status_code)
            self.assertEqual(before, self.path.read_bytes())

    def test_new_list_takes_precedence_over_legacy_field_and_all_links_are_escaped(self):
        addresses = ['https://example.test/?q="<script>x</script>', "http://10.13.4.75:8081/"]
        with TestClient(create_app(self.path)) as client:
            response = client.post("/api/heartbeat", json={
                "addresses": addresses, "address": "http://192.168.1.20:8081/"})
            self.assertEqual(204, response.status_code)
            state = json.loads(self.path.read_text(encoding="utf-8"))
            self.assertEqual(addresses[0], state["address"])
            page = client.get("/").text
            self.assertNotIn("<script>", page)
            self.assertIn("&quot;&lt;script&gt;", page)
            self.assertNotIn("http://192.168.1.20:8081/", page)


if __name__ == "__main__":
    unittest.main()
