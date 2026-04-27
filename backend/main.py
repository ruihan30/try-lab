"""
=============================================================================
  FastAPI SSE Backend - main.py
=============================================================================

KEY CONCEPTS:
  
  1. SSE (Server-Sent Events):
     A simple, one-directional protocol where the server pushes events to the
     browser over a single, long-lived HTTP connection. The browser uses the
     built-in `EventSource` API to connect. Unlike WebSockets, SSE is HTTP
     and therefore works through proxies/firewalls more easily.
  
  2. sse-starlette:
     Starlette is the ASGI web framework that FastAPI is built on top of.
     `sse-starlette` is a small library that adds an `EventSourceResponse`
     class to Starlette/FastAPI. It handles:
       - Setting the correct response headers (Content-Type: text/event-stream)
       - Formatting data into the SSE wire format ("data: ...\n\n")
       - Keeping the connection alive with periodic "ping" comments
       - Yielding your Python async generator as a stream to the browser
     
     Think of it as the "adapter" that lets you write a simple Python async
     generator function and have it automatically become an SSE endpoint.
  
  3. Last-Event-ID (Resumption):
     When the browser's EventSource reconnects (e.g. after a network hiccup),
     it automatically sends a `Last-Event-Id` header containing the `id` field
     of the last event it received. Your server can read this and replay any
     missed events - this is how SSE streams are made resumable. We expose
     this via the `?last_event_id=` query parameter too, so you can test it
     directly in a browser URL bar or curl command.
  
  4. asyncio.Queue & Fan-out:
     A single `asyncio.Queue` per connected client is stored in a global set.
     When the logger POSTs a new value via `/ingest`, we loop over every
     queue and put the event into each one. This is the "fan-out" or
     "broadcast" pattern - one producer, many consumers.
"""

import asyncio
import json
import time
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import FastAPI, Header, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

# ---------------------------------------------------------------------------
# Global state: a set of asyncio Queues, one per connected SSE client.
# When a client connects, we add their queue; when they disconnect, we remove it.
# ---------------------------------------------------------------------------
SUBSCRIBERS: set[asyncio.Queue] = set()

# We keep a simple incrementing counter to use as the SSE event `id`.
# This is what the browser sends back as `Last-Event-Id` on reconnect.
event_counter: int = 0


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown hooks."""
    print("Backend started. Waiting for logger events on POST /ingest ...")
    yield
    print("Backend shutting down.")


app = FastAPI(
    title="SSE Streaming Demo",
    description="Streams random floats from a Logger container to React clients via SSE.",
    lifespan=lifespan,
)

# Allow the React dev server (and any origin) to connect.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Data model for the logger's POST payload
# ---------------------------------------------------------------------------
class LogEvent(BaseModel):
    timestamp: str
    value: float


# ---------------------------------------------------------------------------
# POST /ingest  — Logger pushes data here
# ---------------------------------------------------------------------------
@app.post("/ingest", summary="Logger pushes a new float value here")
async def ingest(event: LogEvent):
    """
    Receives a random float from the Logger container and fans it out
    to every currently-connected SSE client by putting the data into
    each client's asyncio.Queue.
    """
    global event_counter
    event_counter += 1

    payload = json.dumps({"id": event_counter, "value": event.value, "timestamp": event.timestamp})

    # Fan-out: put the payload into every subscriber's queue
    dead_queues = set()
    for q in SUBSCRIBERS:
        try:
            q.put_nowait(payload)
        except asyncio.QueueFull:
            dead_queues.add(q)  # remove slow/dead clients

    SUBSCRIBERS.difference_update(dead_queues)

    return {"status": "ok", "delivered_to": len(SUBSCRIBERS), "event_id": event_counter}


# ---------------------------------------------------------------------------
# GET /stream  — React frontend subscribes here (SSE endpoint)
# ---------------------------------------------------------------------------
@app.get("/stream", summary="SSE stream endpoint for React clients")
async def stream(
    request: Request,
    # EXPERIMENT #1: Read Last-Event-ID from HTTP header (set automatically
    # by the browser's EventSource on reconnect).
    last_event_id: Annotated[str | None, Header()] = None,
    # EXPERIMENT #2: Alternatively, pass it as a query param so you can
    # test resumption directly in the browser URL: /stream?resume_from=5
    resume_from: int = Query(default=0, description="Resume from this event ID (for experimentation)"),
    # EXPERIMENT #3: Slow down how fast the server sends keep-alive pings.
    # Default is 15s. Lower it to see ping frames in DevTools Network tab.
    ping_interval: int = Query(default=15, description="SSE ping interval in seconds"),
):
    """
    Long-lived SSE endpoint.
    
    HOW TO EXPERIMENT:
    ------------------
    1. Open http://localhost:8000/stream in your browser - you'll see raw SSE frames.
    
    2. Test Last-Event-ID resumption:
       - Note the `id` of the last event you saw (e.g. id=42)
       - Disconnect, then re-open: /stream?resume_from=42
       - The server will log that it would replay from event 42.
       - A real implementation would store events in a DB and replay them here.
    
    3. See keep-alive pings more frequently:
       - Open: /stream?ping_interval=3
       - In the browser DevTools > Network > /stream > EventStream tab,
         you'll see a ": ping" comment every 3 seconds.
    
    4. Simulate reconnect with curl:
       curl -N -H "Last-Event-Id: 10" http://localhost:8000/stream
    """
    # Determine the effective resume point
    effective_last_id = last_event_id or (str(resume_from) if resume_from else None)
    if effective_last_id:
        print(f"[SSE] Client reconnecting. Last-Event-Id: {effective_last_id}")
        print(f"[SSE] In production, you would query your DB for events after id={effective_last_id} and replay them here.")

    # Register this client
    queue: asyncio.Queue = asyncio.Queue(maxsize=100)
    SUBSCRIBERS.add(queue)
    print(f"[SSE] New client connected. Total subscribers: {len(SUBSCRIBERS)}")

    async def event_generator():
        """
        An async generator that the EventSourceResponse will iterate over.
        Each `yield` sends one SSE event to the browser.
        
        SSE Wire Format (what actually travels over TCP):
            id: 42\n
            event: log_event\n
            data: {"value": 0.731, "timestamp": "..."}\n
            \n
        
        The blank line (\n\n) signals the end of one event.
        """
        try:
            # Send an initial "connected" event so the frontend knows it's live
            yield {
                "event": "connected",
                "data": json.dumps({
                    "message": "Connected to SSE stream",
                    "resumed_from": effective_last_id,
                }),
            }

            while True:
                # Check if the client disconnected
                if await request.is_disconnected():
                    print("[SSE] Client disconnected cleanly.")
                    break

                try:
                    # Wait up to 1 second for a new event from the queue.
                    # This prevents blocking forever and lets us check is_disconnected.
                    raw = await asyncio.wait_for(queue.get(), timeout=1.0)
                    data = json.loads(raw)

                    # Yield a full SSE event dict.
                    # `sse-starlette` will serialize this into proper SSE format.
                    yield {
                        "id": str(data["id"]),           # <-- This is what browser stores as Last-Event-Id
                        "event": "log_event",            # <-- Custom event name (frontend uses addEventListener("log_event", ...))
                        "data": json.dumps({
                            "value": data["value"],
                            "timestamp": data["timestamp"],
                        }),
                        "retry": 3000,  # Tell browser to wait 3s before reconnecting (milliseconds)
                    }
                except asyncio.TimeoutError:
                    # No new data yet, loop again (and re-check is_disconnected)
                    continue

        except asyncio.CancelledError:
            print("[SSE] Stream task cancelled (client disconnected).")
        finally:
            SUBSCRIBERS.discard(queue)
            print(f"[SSE] Client removed. Remaining subscribers: {len(SUBSCRIBERS)}")

    return EventSourceResponse(
        event_generator(),
        ping=ping_interval,           # Send a keep-alive comment every N seconds
        ping_message_factory=lambda: f"ping at {time.time():.0f}",  # Custom ping payload
    )


# ---------------------------------------------------------------------------
# GET /status  — Healthcheck / info
# ---------------------------------------------------------------------------
@app.get("/status")
async def status():
    return {
        "subscribers": len(SUBSCRIBERS),
        "total_events_ingested": event_counter,
    }
