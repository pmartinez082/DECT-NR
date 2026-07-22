import re
import time
from prometheus_client import start_http_server, Gauge, Counter

LOG_FILE = "/logs/master_output.txt"

BURST_SIZE = 50
BURST_DURATION_MS = 2000.0

packet_counter = Counter("tdma_packets_total", "Total TDMA packets", ["tx_id"])
temperature_gauge = Gauge("tdma_temperature_celsius", "Node temperature", ["tx_id"])
seq_gauge = Gauge("tdma_sequence", "Latest sequence number", ["tx_id"])
frame_time_gauge = Gauge("tdma_frame_time_ms", "Latest frame time", ["tx_id"])
inter_message_gauge = Gauge("tdma_inter_message_mseconds",
                            "Time between consecutive messages from this TX (ms)", ["tx_id"])
burst_per_gauge = Gauge("tdma_burst_per",
                         "Packet error rate for the last completed burst (lost / 50)", ["tx_id"])
cumulative_per_gauge = Gauge("tdma_cumulative_per",
                              "Cumulative packet error rate across all completed bursts", ["tx_id"])

# -------------------------------------------------
# Per-TX state
# -------------------------------------------------
last_message_time = {}   # tx_id -> last frame_time (ms)
burst_epoch       = {}   # tx_id -> frame_time of this tx's first-ever packet (grid origin)
current_window    = {}   # tx_id -> index of the burst window currently in progress
current_burst_seq = {}   # tx_id -> seq number seen in current window
burst_received    = {}   # tx_id -> packets received in current window

total_expected = {}  # tx_id -> total packets expected across completed bursts
total_lost     = {}  # tx_id -> total packets lost across completed bursts

PDC_LINE_RE = re.compile(r"PDC\s+([\d.]+)\s+Seq:(\d+)\s+Tx:(\d+)\s+Temp:(\d+)")


def follow(file):
    file.seek(0, 2)
    while True:
        line = file.readline()
        if not line:
            time.sleep(0.05)
            continue
        yield line


def burst_window_index(tx_id, frame_time):
    if tx_id not in burst_epoch:
        burst_epoch[tx_id] = frame_time
        return 0
    return int((frame_time - burst_epoch[tx_id]) // BURST_DURATION_MS)


def close_burst(tx_id, missed_windows=1):
    """missed_windows > 1 means one or more entire bursts were skipped with zero packets."""
    received = burst_received.get(tx_id, 0)
    lost = max(BURST_SIZE - received, 0)

    burst_per = lost / BURST_SIZE
    burst_per_gauge.labels(tx_id=tx_id).set(burst_per)

    total_expected[tx_id] = total_expected.get(tx_id, 0) + BURST_SIZE
    total_lost[tx_id] = total_lost.get(tx_id, 0) + lost

    # account for any fully-missed bursts in between (0 packets received at all)
    for _ in range(missed_windows - 1):
        total_expected[tx_id] += BURST_SIZE
        total_lost[tx_id] += BURST_SIZE

    cum_per = total_lost[tx_id] / total_expected[tx_id]
    cumulative_per_gauge.labels(tx_id=tx_id).set(cum_per)

    print(
        f"[BURST END] TX={tx_id} seq={current_burst_seq.get(tx_id)} "
        f"received={received}/{BURST_SIZE} lost={lost} "
        f"burst_PER={burst_per:.4f} cum_PER={cum_per:.4f}"
        + (f" (+{missed_windows - 1} fully-missed burst(s))" if missed_windows > 1 else "")
    )


def main():
    print("Starting Prometheus exporter on :8000")
    start_http_server(8000)

    with open(LOG_FILE, "r") as f:
        for line in follow(f):
            line = line.strip()

            m = PDC_LINE_RE.search(line)
            if not m:
                continue

            frame_time = float(m.group(1))
            current_seq = int(m.group(2))
            tx_id = m.group(3)
            temp = int(m.group(4))

            delta = None
            if tx_id in last_message_time:
                delta = frame_time - last_message_time[tx_id]
                inter_message_gauge.labels(tx_id=tx_id).set(delta)
            last_message_time[tx_id] = frame_time

            window = burst_window_index(tx_id, frame_time)

            if tx_id not in current_window:
                current_window[tx_id] = window
                current_burst_seq[tx_id] = current_seq
                burst_received[tx_id] = 1
            elif window != current_window[tx_id]:
                missed = window - current_window[tx_id]
                close_burst(tx_id, missed_windows=missed)
                current_window[tx_id] = window
                current_burst_seq[tx_id] = current_seq
                burst_received[tx_id] = 1
            else:
                burst_received[tx_id] = burst_received.get(tx_id, 0) + 1
                current_burst_seq[tx_id] = current_seq

            packet_counter.labels(tx_id=tx_id).inc()
            temperature_gauge.labels(tx_id=tx_id).set(temp)
            seq_gauge.labels(tx_id=tx_id).set(current_seq)
            frame_time_gauge.labels(tx_id=tx_id).set(frame_time)

            print(
                f"TX={tx_id} SEQ={current_seq} TEMP={temp} "
                f"DT={f'{delta:.3f}ms' if delta is not None else 'n/a'} "
                f"burst_rx={burst_received.get(tx_id, 0)}"
            )


if __name__ == "__main__":
    main()