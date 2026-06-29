#!/usr/bin/env python3
"""
Parse master_output.txt and generate TDMA CSV and plot (SAFE VERSION)
"""

import pandas as pd
import matplotlib.pyplot as plt
import re
import numpy as np
from pathlib import Path

# ---- CONFIG ----
MASTER_LOG_FILE = "master_output.txt"
CSV_FILE = "tdma.csv"

# SAFETY LIMITS (prevents matplotlib freeze)
'''
MAX_ROWS = 100        # hard cap for plotting
DOWNSAMPLE = 5         # vlines reduction factor
OFFSET = 700          # wait for both clients to converge

'''

def parse_master_log(log_file):
    if not Path(log_file).exists():
        print(f"Error: {log_file} not found")
        return []

    records = []

    with open(log_file, "r") as f:
        lines = f.readlines()

    # -------------------------------------------------
    # Find first beacon
    # -------------------------------------------------
    first_beacon_time = None

    for line in lines:
        m = re.search(
            r"Beacon TX callback fired:\s*frame_time=([\d.]+)\s*ms",
            line
        )

        if m:
            first_beacon_time = float(m.group(1))
            print(f"Found first beacon at: {first_beacon_time} ms")
            break

    if first_beacon_time is None:
        print("No beacon found in log")
        return []

    # -------------------------------------------------
    # Parse log
    # -------------------------------------------------
    current_pdc = None

    for raw_line in lines:
        line = raw_line.strip()

        if not line:
            continue

        # -------------------------------------------------
        # Beacon
        # -------------------------------------------------
        m = re.search(
            r"Beacon TX callback fired:\s*frame_time=([\d.]+)\s*ms",
            line
        )

        if m:
            beacon_time = float(m.group(1)) - first_beacon_time

            records.append({
                "frame_time": beacon_time,
                "beacon": True,
                "seq": None,
                "tx_id": 0,
                "temperature": None
            })

            continue

        # -------------------------------------------------
        # PDC start
        # -------------------------------------------------
        m = re.search(
            r"PDC received at frame_time\s+([\d.]+)\s*ms",
            line
        )

        if m:
            current_pdc = {
                "frame_time": float(m.group(1)) - first_beacon_time,
                "beacon": False,
                "seq": None,
                "tx_id": None,
                "temperature": None
            }

            continue

        if current_pdc is None:
            continue

        # -------------------------------------------------
        # Sequence number
        # -------------------------------------------------
        m = re.search(r"Seq Nbr:\s*(\d+)", line, re.IGNORECASE)

        if m:
            current_pdc["seq"] = int(m.group(1))
            continue

        # -------------------------------------------------
        # Compact TX/TEMP line
        # Example:
        # Tx:2(0x0002) Temp:33(0x0021)
        # -------------------------------------------------
        m = re.search(
            r"Tx:(\d+)\(0x[0-9a-fA-F]+\)\s+Temp:(\d+)\(0x[0-9a-fA-F]+\)",
            line
        )

        if m:
            current_pdc["tx_id"] = int(m.group(1))
            current_pdc["temperature"] = int(m.group(2))

            records.append(current_pdc)
            current_pdc = None

            continue

    return records


def save_to_csv(records, csv_file):
    if not records:
        print("No records to save")
        return False

    df = pd.DataFrame(records)
    df.to_csv(csv_file, index=False)

    print(f"Saved {len(records)} records to {csv_file}")
    return True


def plot_tdma_timeline(csv_file):
    if not Path(csv_file).exists():
        print(f"Error: {csv_file} not found")
        return

    df = pd.read_csv(csv_file)

    if len(df) == 0:
        print("No data found")
        return

    df = df.sort_values("frame_time")

    # -------------------------------------------------
    # DEBUG LIMIT
    # -------------------------------------------------
    # select df max rows with an offset
   # df = df.head(MAX_ROWS + OFFSET)

    beacon_df = df[df["beacon"] == True].copy()
    pdc_df = df[df["beacon"] == False].copy()

    t0 = df["frame_time"].min()

    df["time_ms"] = df["frame_time"] - t0
    beacon_df["time_ms"] = beacon_df["frame_time"] - t0
    pdc_df["time_ms"] = pdc_df["frame_time"] - t0

    # Clean tx_id
    pdc_df["tx_id"] = pdc_df["tx_id"].fillna(-1).astype(int)

    plt.figure(figsize=(14, 6))

    # -------------------------------------------------
    # TX lines (SAFE DOWNSAMPLING)
    # -------------------------------------------------
    if len(pdc_df) > 0:
        tx_ids = sorted(pdc_df["tx_id"].unique())
        cmap = plt.colormaps["tab10"]

        color_map = {tx: cmap(i % 10) for i, tx in enumerate(tx_ids)}

        for tx in tx_ids:
            subset = pdc_df[pdc_df["tx_id"] == tx]

            # DOWN SAMPLE (CRITICAL FIX)
            #subset = subset.iloc[::DOWNSAMPLE]

            plt.vlines(
                subset["time_ms"],
                -0.2,
                0.2,
                label=f"TX {tx}",
                colors=[color_map[tx]],
                linewidth=1
            )

    # -------------------------------------------------
    # Beacons
    # -------------------------------------------------
    if len(beacon_df) > 0:
        plt.scatter(
            beacon_df["time_ms"],
            [0.35] * len(beacon_df),
            marker="^",
            s=80,
            color="red",
            label="Beacon",
            zorder=5
        )

    # -------------------------------------------------
    # Grid
    # -------------------------------------------------
    max_time = df["time_ms"].max()
    FRAME_PERIOD_MS = 2000

    for t in np.arange(0, max_time + FRAME_PERIOD_MS, FRAME_PERIOD_MS):
        plt.axvline(x=t, linestyle=":", linewidth=0.8, alpha=0.4)

    # -------------------------------------------------
    # Labels
    # -------------------------------------------------
    plt.xlabel("Time (ms)")
    plt.title("TDMA Timeline")

    plt.yticks([])
    plt.grid(axis="x", alpha=0.3)
    plt.legend(loc="upper left")

    plt.tight_layout()

    # -------------------------------------------------
    # SAVE FIRST (IMPORTANT)
    # -------------------------------------------------
    out_file = "tdma_timeline.png"
    plt.savefig(out_file, dpi=150, bbox_inches="tight")

    print(f"Saved plot to {out_file}")

    # Optional (safe now)
    #plt.show()
    # Avoid freeze in some backends
    plt.close()

  
def print_seq_stats(df):
    BATCH_SIZE = 50  # expected packets per iteration/batch

    # remove beacon rows
    pdc = df[df["beacon"] == False].copy()
    pdc = pdc.dropna(subset=["seq", "tx_id"])
    pdc["seq"] = pdc["seq"].astype(int)
    pdc["tx_id"] = pdc["tx_id"].astype(int)

    print("\n=== Per (TX ID, SEQ) message counts ===")
    grouped = pdc.groupby(["tx_id", "seq"]).size().reset_index(name="count")
    for _, row in grouped.sort_values(["tx_id", "seq"]).iterrows():
        print(f"TX {row['tx_id']} | Seq {row['seq']} -> {row['count']} msgs")

    print("\n=== Per TX summary ===")
    tx_summary = pdc.groupby("tx_id").agg(
        total_msgs=("seq", "count"),
        unique_seqs=("seq", "nunique"),
        min_seq=("seq", "min"),
        max_seq=("seq", "max"),
    )
    print(tx_summary.to_string())

    print("\n=== Duplicate detection (seq reuse per tx) ===")
    dup = pdc.groupby(["tx_id", "seq"]).size()
    dup = dup[dup > 1]
    if len(dup) == 0:
        print("No duplicate seq numbers found per TX.")
    else:
        print(dup.to_string())

# -------------------------------------------------
    # Batch-based inter-frame timing (50 packets = 1 iteration)
    # Expected period = 40 ms, tolerance = ±half-period for matching
    # -------------------------------------------------
    PERIOD_MS   = 40.0
    TOLERANCE   = PERIOD_MS / 2.0   # 20 ms match window
    print(f"\n=== Batch inter-frame timing (batch_size={BATCH_SIZE}, period={PERIOD_MS} ms) ===")

    pdc_sorted = pdc.sort_values(["tx_id", "frame_time"]).copy()
    pdc_sorted["batch"] = (
        pdc_sorted.groupby("tx_id").cumcount() // BATCH_SIZE
    )
    # discard last batch of each tx
    # Drop the last batch for each TX (incomplete / stop-emulation artefact)
    last_batch_per_tx = pdc_sorted.groupby("tx_id")["batch"].transform("max")
    pdc_sorted = pdc_sorted[pdc_sorted["batch"] < last_batch_per_tx]
     # DEBUG
    print("\n=== Batch assignment debug ===")
    print(pdc_sorted.groupby(["tx_id", "batch"]).size().to_string())
    
    # Drop the last batch for each TX
    last_batch_per_tx = pdc_sorted.groupby("tx_id")["batch"].transform("max")
    pdc_sorted = pdc_sorted[pdc_sorted["batch"] < last_batch_per_tx]
    
    print(f"\nAfter last-batch drop: {len(pdc_sorted)} rows remaining")
    stats_rows  = []
    loss_rows   = []   # one row per missing slot


    for (tx_id, batch_idx), group in pdc_sorted.groupby(["tx_id", "batch"]):
        times    = np.sort(group["frame_time"].values)
        received = len(times)

        if received == 0:
            continue

        # ---------------------------------------------------
        # Estimate actual period from this batch's data.
        # Use median of deltas to be robust against gaps.
        # Fall back to PERIOD_MS if too few packets.
        # ---------------------------------------------------
        if received >= 2:
            deltas          = np.diff(times)
            # Only use deltas close to expected period (ignore multi-slot gaps)
            clean_deltas    = deltas[deltas <= PERIOD_MS * 1.8]
            measured_period = float(np.median(clean_deltas)) if len(clean_deltas) else PERIOD_MS
        else:
            measured_period = PERIOD_MS

        # ---------------------------------------------------
        # Find best anchor: try every received packet as slot-0
        # and pick the one that maximises matches.
        # ---------------------------------------------------
        def count_matches(anchor, period):
            matched = 0
            used    = [False] * received
            for k in range(BATCH_SIZE):
                exp = anchor + k * period
                for i, t in enumerate(times):
                    if not used[i] and abs(t - exp) <= TOLERANCE:
                        used[i] = True
                        matched += 1
                        break
            return matched

        best_anchor  = times[0]
        best_matches = count_matches(times[0], measured_period)

        for candidate in times[1:]:
            # candidate could be slot k — try offsets back
            for k in range(1, min(5, BATCH_SIZE)):
                anchor_try = candidate - k * measured_period
                m = count_matches(anchor_try, measured_period)
                if m > best_matches:
                    best_matches = m
                    best_anchor  = anchor_try

        expected_times = best_anchor + np.arange(BATCH_SIZE) * measured_period

        # ---------------------------------------------------
        # Now do the actual matching with the best anchor
        # ---------------------------------------------------
        used        = [False] * received
        slot_status = []

        for slot_idx, exp_t in enumerate(expected_times):
            best_i    = None
            best_dist = np.inf

            for i, t in enumerate(times):
                if used[i]:
                    continue
                dist = abs(t - exp_t)
                if dist < best_dist and dist <= TOLERANCE:
                    best_dist = dist
                    best_i    = i

            if best_i is not None:
                used[best_i] = True
                slot_status.append({
                    "slot":        slot_idx,
                    "expected_ms": round(exp_t,           3),
                    "actual_ms":   round(times[best_i],   3),
                    "offset_ms":   round(times[best_i] - exp_t, 3),
                    "matched":     True,
                })
            else:
                slot_status.append({
                    "slot":        slot_idx,
                    "expected_ms": round(exp_t, 3),
                    "actual_ms":   None,
                    "offset_ms":   None,
                    "matched":     False,
                })
                loss_rows.append({
                    "tx_id":       tx_id,
                    "batch":       batch_idx,
                    "slot":        slot_idx,
                    "expected_ms": round(exp_t, 3),
                })
    if not stats_rows:
        print("No batch data to summarise.")
        return

    stats_df = pd.DataFrame(stats_rows)
    loss_df  = pd.DataFrame(loss_rows) if loss_rows else pd.DataFrame(
        columns=["tx_id", "batch", "slot", "expected_ms"]
    )

    # -------------------------------------------------
    # Cross-batch summary per TX
    # -------------------------------------------------
    print("\n=== Per-TX batch summary ===")
    for tx_id, g in stats_df.groupby("tx_id"):
        valid = g.dropna(subset=["interval_mean_ms"])
        print(
            f"  TX {tx_id} | batches={len(g)} | "
            f"avg_loss={g['loss_pct'].mean():.1f}% | "
            f"mean_jitter={valid['interval_mean_ms'].mean():.2f} ms | "
            f"p95_max={valid['interval_p95_ms'].max():.2f} ms"
        )

    # -------------------------------------------------
    # Save CSVs
    # -------------------------------------------------
    stats_csv = "tdma_batch_stats.csv"
    loss_csv  = "tdma_missing_packets.csv"

    stats_df.to_csv(stats_csv, index=False)
    loss_df.to_csv(loss_csv,   index=False)

    print(f"\nSaved batch stats    -> {stats_csv}")
    print(f"Saved missing packets -> {loss_csv}  ({len(loss_df)} missing slots)")
    # -------------------------------------------------
    # Cross-batch summary per TX
    # -------------------------------------------------
    print("\n=== Per-TX batch summary ===")
    for tx_id, g in stats_df.groupby("tx_id"):
        valid = g.dropna(subset=["interval_mean_ms"])
        print(
            f"  TX {tx_id} | batches={len(g)} | "
            f"avg_loss={g['loss_pct'].mean():.1f}% | "
            f"mean_interval={valid['interval_mean_ms'].mean():.2f} ms | "
            f"p95_max={valid['interval_p95_ms'].max():.2f} ms"
        )

    # -------------------------------------------------
    # Save stats CSV
    # -------------------------------------------------
    stats_csv = "tdma_batch_stats.csv"
    stats_df.to_csv(stats_csv, index=False)
    print(f"\nSaved batch stats -> {stats_csv}")



def main():
    print(f"Parsing {MASTER_LOG_FILE}...")

    records = parse_master_log(MASTER_LOG_FILE)

    if not records:
        print("No records found")
        return

    df = pd.DataFrame(records)

    print(f"Found {len(records)} TDMA events")

    print_seq_stats(df)

    print(f"Saving CSV -> {CSV_FILE}")

    if save_to_csv(records, CSV_FILE):
        print("Generating plot...")
        plot_tdma_timeline(CSV_FILE)
        print("Done")


if __name__ == "__main__":
    main()