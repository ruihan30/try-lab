"""
=============================================================================
  Logger Service - logger.py
=============================================================================

This is the data producer. It generates random floats in a loop and POSTs
them to the FastAPI backend's /ingest endpoint. The backend then fans out
the event to all connected React clients via SSE.

You can tweak INTERVAL_SECONDS to speed up or slow down the data stream.
"""

import random
import time
import os
import requests
from datetime import datetime, timezone

# The backend URL comes from Docker Compose's internal DNS.
# When running in Docker Compose, `backend` resolves to the backend container's IP.
BACKEND_URL = os.getenv("BACKEND_URL", "http://backend:8000")
INGEST_URL = f"{BACKEND_URL}/ingest"

# How often to generate and send a new event (seconds)
INTERVAL_SECONDS = float(os.getenv("INTERVAL_SECONDS", "1.0"))

# How many retries before giving up on startup
MAX_STARTUP_RETRIES = 20


def wait_for_backend():
    """Poll /status until the backend is ready before starting the main loop."""
    print(f"[Logger] Waiting for backend at {BACKEND_URL}/status ...")
    for attempt in range(MAX_STARTUP_RETRIES):
        try:
            r = requests.get(f"{BACKEND_URL}/status", timeout=3)
            if r.status_code == 200:
                print(f"[Logger] Backend is ready! Starting stream in 1s...")
                time.sleep(1)
                return
        except requests.exceptions.ConnectionError:
            pass
        print(f"[Logger] Not ready yet (attempt {attempt + 1}/{MAX_STARTUP_RETRIES}), retrying in 2s...")
        time.sleep(2)
    raise RuntimeError("Backend did not become ready in time.")


def main():
    wait_for_backend()

    event_num = 0
    print(f"[Logger] Sending events every {INTERVAL_SECONDS}s to {INGEST_URL}")

    while True:
        event_num += 1

        # Generate a random float between 0.0 and 1.0
        value = random.random()
        timestamp = datetime.now(timezone.utc).isoformat()

        payload = { "timestamp": timestamp ,"value": value}

        try:
            response = requests.post(INGEST_URL, json=payload, timeout=5)
            print(f"[Logger] Event #{event_num:04d} | value={value:.6f} | status={response.status_code}")
        except requests.exceptions.RequestException as e:
            print(f"[Logger] Event #{event_num:04d} | FAILED to send: {e}")

        time.sleep(INTERVAL_SECONDS)


if __name__ == "__main__":
    main()
