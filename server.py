#!/usr/bin/env python3
"""
Local development server for Staff Auto BDE Polytech Nice Sophia.
Serves static files (GitHub Pages compatible) and exposes POST /api/config
to persist changes directly into data/config.json while running on localhost.
"""

import json
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent
CONFIG_PATH = ROOT_DIR / "data" / "config.json"
HOST = "127.0.0.1"
PORT = int(os.environ.get("PORT", "8080"))
MAX_BODY_BYTES = 256 * 1024


class StaffHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT_DIR), **kwargs)

    def do_POST(self):
        if self.path != "/api/config":
            self.send_error(404, "Endpoint introuvable")
            return

        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > MAX_BODY_BYTES:
            self.send_error(400, "Taille de requete invalide")
            return

        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self.send_error(400, "JSON invalide")
            return

        if (
            not isinstance(data, dict)
            or not isinstance(data.get("settings"), dict)
            or not isinstance(data.get("members"), list)
            or not isinstance(data.get("roles"), list)
        ):
            self.send_error(400, "Structure de configuration invalide")
            return

        CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        CONFIG_PATH.write_text(
            json.dumps(data, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )

        body = json.dumps({"ok": True}).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_error(self, code, message=None, explain=None):
        if code == 404 and (ROOT_DIR / "404.html").exists():
            content = (ROOT_DIR / "404.html").read_bytes()
            self.send_response(404)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)
            return
        super().send_error(code, message, explain)


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), StaffHandler)
    print(f"Serveur lance sur http://{HOST}:{PORT}", flush=True)
    server.serve_forever()
