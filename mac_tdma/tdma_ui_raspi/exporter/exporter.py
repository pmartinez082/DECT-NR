#!/usr/bin/env python3

import re
import time
from collections import deque
from prometheus_client import start_http_server
from prometheus_client import Gauge
from prometheus_client import Counter

LOG_FILE = "/logs/master_output.txt"

BURST_SIZE = 50

# -------------------------------------------------
# Metrics
# -------------------------------------------------

beacon_counter = Counter(
    "tdma_beacons_total",
    "Total TDMA beacons"
)

packet_counter = Counter(
    "tdma_packets_total",
    "Total TDMA packets",
    ["tx_id"]
)

temperature_gauge = Gauge(
    "tdma_temperature_celsius",
    "Node temperature",
    ["tx_id"]
)

seq_gauge = Gauge(
    "tdma_sequence",
    "Latest sequence number",
    ["tx_id"]
)

frame_time_gauge = Gauge(
    "tdma_frame_time_ms",
    "Latest frame time",
    ["tx_id"]
)

inter_message_gauge = Gauge(
    "tdma_inter_message_mseconds",
    "Time between consecutive messages from this TX (ms)",
    ["tx_id"]
)

burst_per_gauge = Gauge(
    "tdma_burst_per",
    "Packet error rate for the last completed burst (lost / 50)",
    ["tx_id"]
)

cumulative_per_gauge = Gauge(
    "tdma_cumulative_per",
    "Cumulative packet error rate across all completed bursts",
    ["tx_id"]
)

tx_event = Gauge("tdma_tx_event", "TDMA transmission event", ["tx_id"])

# -------------------------------------------------
# Per-TX state
# -------------------------------------------------

last_message_time  = {}  # tx_id -> last frame_time (ms)
current_burst_seq  = {}  # tx_id -> seq number of burst in progress
burst_received     = {}  # tx_id -> packets received in current burst

total_expected     = {}  # tx_id -> total packets expected across completed bursts
total_lost         = {}  # tx_id -> total packets lost across completed bursts

# FIFO queue — seq numbers arrive before tx_id is known
seq_queue = deque()

# -------------------------------------------------
# Regex
# -------------------------------------------------

PDC_LINE_RE = re.compile(
    r"PDC\s+([\d.]+)\s+Seq:(\d+)\s+Tx:(\d+)\s+Temp:(\d+)"
)

BEACON_RE = re.compile(
    r"Beacon fired:\s*frame_time=([\d.]+)\s*"
)

# -------------------------------------------------
# Tail file
# -------------------------------------------------

def follow(file):
    file.seek(0, 2)

    while True:
        line = file.readline()

        if not line:
            time.sleep(0.05)
            continue

        yield line

# -------------------------------------------------
# Helpers
# -------------------------------------------------

def close_burst(tx_id):
    received = burst_received.get(tx_id, 0)
    lost     = BURST_SIZE - received

    burst_per = lost / BURST_SIZE
    burst_per_gauge.labels(tx_id=tx_id).set(burst_per)

    total_expected[tx_id] = total_expected.get(tx_id, 0) + BURST_SIZE
    total_lost[tx_id]     = total_lost.get(tx_id, 0) + lost

    cum_per = total_lost[tx_id] / total_expected[tx_id]
    cumulative_per_gauge.labels(tx_id=tx_id).set(cum_per)

    print(
        f"[BURST END] TX={tx_id} seq={current_burst_seq.get(tx_id)} "
        f"received={received}/{BURST_SIZE} lost={lost} "
        f"burst_PER={burst_per:.4f} cum_PER={cum_per:.4f}"
    )

# -------------------------------------------------
# Main parser
# -------------------------------------------------
def main():
    print("Starting Prometheus exporter on :8000")
    start_http_server(8000)

    with open(LOG_FILE, "r") as f:
        for line in follow(f):
            line = line.strip()

            # Beacon
            m = BEACON_RE.search(line)
            if m:
                beacon_counter.inc()
                print(f"Beacon @ {m.group(1)} ms")
                continue

            # Consolidated PDC line
            m = PDC_LINE_RE.search(line)
            if m:
                frame_time  = float(m.group(1))
                current_seq = int(m.group(2))
                tx_id       = m.group(3)   # keep as str for label consistency
                temp        = int(m.group(4))

                # --- Inter-message timing ---
                delta = None
                if tx_id in last_message_time:
                    delta = frame_time - last_message_time[tx_id]
                    inter_message_gauge.labels(tx_id=tx_id).set(delta)
                last_message_time[tx_id] = frame_time

                # --- Burst tracking by seq number per tx_id ---
                if tx_id not in current_burst_seq:
                    current_burst_seq[tx_id] = current_seq
                    burst_received[tx_id]    = 1
                elif current_seq != current_burst_seq[tx_id]:
                    close_burst(tx_id)
                    current_burst_seq[tx_id] = current_seq
                    burst_received[tx_id]    = 1
                else:
                    burst_received[tx_id] = burst_received.get(tx_id, 0) + 1

                # --- Other metrics ---
                packet_counter.labels(tx_id=tx_id).inc()
                temperature_gauge.labels(tx_id=tx_id).set(temp)
                seq_gauge.labels(tx_id=tx_id).set(current_seq)
                frame_time_gauge.labels(tx_id=tx_id).set(frame_time)

                print(
                    f"TX={tx_id} SEQ={current_seq} TEMP={temp} "
                    f"DT={f'{delta:.3f}ms' if delta is not None else 'n/a'} "
                    f"burst_rx={burst_received.get(tx_id, 0)}"
                )
                continue

            # unmatched lines (e.g. bare "PDC ...") fall through silently



if __name__ == "__main__":
    main()