#!/usr/bin/env python3
"""Serve the hand-scroll demo locally so the browser can access the camera."""

from __future__ import annotations

import argparse
import functools
import http.server
import socketserver
import webbrowser
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Serve the hand-scroll demo.")
    parser.add_argument("--host", default="127.0.0.1", help="Host interface to bind.")
    parser.add_argument("--port", default=8000, type=int, help="Port to bind.")
    parser.add_argument("--no-open", action="store_true", help="Do not open the browser automatically.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    root = Path(__file__).resolve().parent
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(root))

    with socketserver.TCPServer((args.host, args.port), handler) as server:
        url = f"http://{args.host}:{args.port}/"
        print(f"Serving {root} at {url}")
        if not args.no_open:
            webbrowser.open(url)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("Stopping server.")


if __name__ == "__main__":
    main()