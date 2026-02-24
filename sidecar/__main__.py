"""
Sidecar entrypoint — run with: python -m sidecar
"""

import argparse

import uvicorn

from sidecar.server import create_app


def main() -> None:
    parser = argparse.ArgumentParser(description="Sanna governance sidecar")
    parser.add_argument("--host", default="127.0.0.1", help="Bind host")
    parser.add_argument("--port", type=int, default=18791, help="Bind port")
    parser.add_argument(
        "--constitution",
        default="./constitutions",
        help="Path to YAML constitution file or directory",
    )
    parser.add_argument(
        "--key",
        default="",
        help="Path to Ed25519 signing key",
    )
    parser.add_argument(
        "--receipt-store",
        default="",
        help="Path to SQLite receipt database",
    )
    args = parser.parse_args()

    app = create_app(
        constitution_path=args.constitution,
        key_path=args.key,
        receipt_store_path=args.receipt_store,
    )

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
