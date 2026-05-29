#!/usr/bin/env python3

import re
import time
from prometheus_client import start_http_server
from prometheus_client import Gauge
from prometheus_client import Counter

LOG_FILE = "/logs/master_output.txt"

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

# -------------------------------------------------
# Regex
# -------------------------------------------------

BEACON_RE = re.compile(
    r"Beacon TX callback fired:\s*frame_time=([\d.]+)\s*ms"
)

PDC_RE = re.compile(
    r"PDC received at frame_time\s+([\d.]+)\s*ms"
)

SEQ_RE = re.compile(
    r"Seq Nbr:\s*(\d+)"
)

DATA_RE = re.compile(
    r"Tx:(\d+)\(0x[0-9a-fA-F]+\)\s+Temp:(\d+)\(0x[0-9a-fA-F]+\)"
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
# Main parser
# -------------------------------------------------

def main():
    print("Starting Prometheus exporter on :8000")

    start_http_server(8000)

    current_frame_time = None
    current_seq = None

    with open(LOG_FILE, "r") as f:

        for line in follow(f):

            line = line.strip()

            # Beacon
            m = BEACON_RE.search(line)

            if m:
                beacon_counter.inc()

                print(f"Beacon @ {m.group(1)} ms")
                continue

            # PDC
            m = PDC_RE.search(line)

            if m:
                current_frame_time = float(m.group(1))
                continue

            # Sequence
            m = SEQ_RE.search(line)

            if m:
                current_seq = int(m.group(1))
                continue

            # TX/TEMP
            m = DATA_RE.search(line)

            if m:
                tx_id = m.group(1)
                temp = int(m.group(2))

                packet_counter.labels(tx_id=tx_id).inc()

                temperature_gauge.labels(
                    tx_id=tx_id
                ).set(temp)

                if current_seq is not None:
                    seq_gauge.labels(
                        tx_id=tx_id
                    ).set(current_seq)

                if current_frame_time is not None:
                    frame_time_gauge.labels(
                        tx_id=tx_id
                    ).set(current_frame_time)

                print(
                    f"TX={tx_id} "
                    f"SEQ={current_seq} "
                    f"TEMP={temp}"
                )

if __name__ == "__main__":
    main()