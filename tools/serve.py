#!/usr/bin/env python3
"""Static file server with COOP/COEP so SharedArrayBuffer / worker sharing works."""

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import sys


class CoopCoepHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        super().end_headers()


def main():
    port = 8080
    if len(sys.argv) > 1:
        port = int(sys.argv[1])
    server = ThreadingHTTPServer(("127.0.0.1", port), CoopCoepHandler)
    print("VoxelSpace http://127.0.0.1:%d  (COOP/COEP on)" % port)
    server.serve_forever()


if __name__ == "__main__":
    main()
