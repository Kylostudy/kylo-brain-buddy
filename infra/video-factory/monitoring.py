"""Independent outbound telemetry; never claims commands or authorizes production."""
import json
import threading
import time

HEARTBEAT_SECONDS = 30
EVENT_POLL_SECONDS = 2
PROTOCOL = "video-factory-monitor-v1"


def tables(db):
    # Separate queue: an older receiver rejecting a new kind must not block legacy ACKs.
    db.execute("CREATE TABLE IF NOT EXISTS monitor_outbox(id TEXT PRIMARY KEY, body TEXT NOT NULL, sent INTEGER DEFAULT 0)")


def emit(state, db, kind, entity, result):
    import uuid
    from contract import canonical
    body = {"schema_version": 1, "event_id": str(uuid.uuid4()), "kind": kind,
            "entity_id": entity, "result": {"monitor_version": PROTOCOL, **result}}
    db.execute("INSERT INTO monitor_outbox(id,body) VALUES(?,?)", (body["event_id"], canonical(body).decode()))


def video_result(job, phase, now=None):
    from contract import digest
    manifest = job["manifest"]
    video = manifest["videos"][job["cursor"]]
    return {"job_id": job["id"], "recipe_id": manifest["recipe_id"],
            "recipe_version": manifest["version"], "recipe_sha256": digest(manifest),
            "video_id": video["video_id"], "language": video["language"],
            "story": video["story"], "cursor": job["cursor"], "attempt": job["attempts"],
            "total_videos": len(manifest["videos"]), "phase": phase,
            "observed_at": int(time.time()) if now is None else now}


class Transport:
    """Two independent senders so a slow event ACK never suppresses the heartbeat."""
    def __init__(self, state, client, agent_id, takeover_approved):
        self.state, self.client = state, client
        self.agent_id, self.takeover_approved = agent_id, takeover_approved
        self.stop = threading.Event()
        self.threads = []

    def send_events_once(self):
        # Bound each pass. Failure in one stream does not starve the other stream.
        with self.state.transaction() as db:
            monitor = [json.loads(r["body"]) for r in db.execute(
                "SELECT body FROM monitor_outbox WHERE sent=0 ORDER BY rowid LIMIT 10")]
        for events, table in ((self.state.pending(), "outbox"), (monitor, "monitor_outbox")):
            for event in events:
                if self.stop.is_set():
                    return
                try:
                    ack = self.client.request("events", event)
                    if ack.get("acknowledged_event_id") != event["event_id"]:
                        break
                    with self.state.transaction() as db:
                        db.execute("UPDATE " + table + " SET sent=1 WHERE id=?", (event["event_id"],))
                except Exception as error:
                    self.log_error("events", error)
                    break

    def heartbeat_once(self):
        with self.state.transaction() as db:
            pending = db.execute("SELECT COUNT(*) FROM outbox WHERE sent=0").fetchone()[0]
        # Preserve today's receiver schema. Cadence/protocol are declared by monitor_ready.
        self.client.request("heartbeat", {"schema_version": 1, "agent_id": self.agent_id,
                            "takeover_approved": self.takeover_approved, "pending_events": pending})

    @staticmethod
    def log_error(operation, error):
        # No response bodies, exception text, headers, credentials or inputs.
        print("factory telemetry unavailable: operation=%s type=%s" %
              (operation, type(error).__name__), flush=True)

    def _loop(self, action, interval, operation):
        while not self.stop.is_set():
            started = time.monotonic()
            try:
                action()
            except Exception as error:
                self.log_error(operation, error)
            self.stop.wait(max(0.1, interval - (time.monotonic() - started)))

    def start(self):
        if self.threads:
            raise RuntimeError("telemetry_already_started")
        for action, interval, operation in ((self.heartbeat_once, HEARTBEAT_SECONDS, "heartbeat"),
                                             (self.send_events_once, EVENT_POLL_SECONDS, "events")):
            thread = threading.Thread(target=self._loop, args=(action, interval, operation), daemon=True)
            self.threads.append(thread)
            thread.start()
        with self.state.transaction() as db:
            emit(self.state, db, "monitor_ready", self.agent_id,
                 {"observed_at": int(time.time()), "heartbeat_interval_seconds": HEARTBEAT_SECONDS,
                  "event_poll_seconds": EVENT_POLL_SECONDS, "independent_heartbeat": True,
                  "independent_events": True, "production_authorized": False})

    def close(self):
        self.stop.set()
        for thread in self.threads:
            thread.join(timeout=30)