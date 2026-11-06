#!/usr/bin/env python3
"""
Edgewise static host.

A dependency-free static file server.

**Everything is served `no-store`.** This is a tiny single-user site, so HTTP
caching buys nothing and costs correctness: a stale module or `sw.js` is
indistinguishable from a failed deploy. Browsers (and iOS in particular) cache
aggressively, so caching is disabled at the source rather than fought later.

    python3 serve.py                 # bind 0.0.0.0:8080
    python3 serve.py --port 9000
    python3 serve.py --bind 127.0.0.1 --port 8080
"""
import argparse
import functools
import http.server
import os
import socket
import socketserver
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = dict(http.server.SimpleHTTPRequestHandler.extensions_map)
    extensions_map.update({
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".mjs": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".webmanifest": "application/manifest+json; charset=utf-8",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".ico": "image/x-icon",
        ".woff2": "font/woff2",
        ".ttf": "font/ttf",
        ".txt": "text/plain; charset=utf-8",
        ".md": "text/markdown; charset=utf-8",
        "": "application/octet-stream",
    })

    def end_headers(self):
        # Never let a browser reuse anything without revalidating. Without this,
        # an updated module can sit behind a 5-minute HTTP cache while the
        # service worker believes it has fetched the current build.
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8097)
    ap.add_argument("--bind", default="0.0.0.0")
    args = ap.parse_args()

    socketserver.TCPServer.allow_reuse_address = True
    handler = functools.partial(Handler, directory=HERE)
    with socketserver.ThreadingTCPServer((args.bind, args.port), handler) as httpd:
        print("Edgewise serving %s" % HERE)
        print("  local :  http://127.0.0.1:%d/" % args.port)
        print("  lan   :  http://%s:%d/" % (lan_ip(), args.port))
        print("  Ctrl-C to stop")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nstopped")


if __name__ == "__main__":
    main()
