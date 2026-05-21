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
MAX_ROWS = 500        # hard cap for plotting
DOWNSAMPLE = 5         # vlines reduction factor

# Convert modem ticks to milliseconds (unused but kept)
TICKS_TO_MS = 1 / 69120


def parse_master_log(log_file):
    if not Path(log_file).exists():
        print(f"Error: {log_file} not found")
        return []

    records = []
    current_pdc = None

    with open(log_file, "r") as f:
        for raw_line in f:
            line = raw_line.strip()
            if not line:
                continue

            # Beacon
            m = re.search(r"Beacon TX callback fired:\s*frame_time=([\d\.]+)", line)
            if m:
                records.append({
                    "frame_time": float(m.group(1)),
                    "beacon": True,
                    "seq": None,
                    "tx_id": 0
                })
                continue

            # PDC start
            m = re.search(r"PDC received at frame_time\s+([\d\.]+)", line)
            if m:
                if current_pdc is not None:
                    records.append(current_pdc)

                current_pdc = {
                    "frame_time": float(m.group(1)),
                    "beacon": False,
                    "seq": None,
                    "tx_id": None
                }
                continue

            if current_pdc is None:
                continue

            # Seq
            m = re.search(r"Seq Nbr:\s*(\d+)", line, re.IGNORECASE)
            if m:
                current_pdc["seq"] = int(m.group(1))

            # Tx ID
            m = re.search(r"Tx id:\s*(\d+)", line, re.IGNORECASE)
            if m:
                current_pdc["tx_id"] = int(m.group(1))
                records.append(current_pdc)
                current_pdc = None

    if current_pdc is not None:
        records.append(current_pdc)

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
    # DEBUG LIMIT (CRITICAL FIX)
    # -------------------------------------------------
    df = df.head(MAX_ROWS)

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
            subset = subset.iloc[::DOWNSAMPLE]

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
    plt.show()
    # Avoid freeze in some backends
    plt.close()

  


def main():
    print(f"Parsing {MASTER_LOG_FILE}...")

    records = parse_master_log(MASTER_LOG_FILE)

    if not records:
        print("No records found")
        return

    print(f"Found {len(records)} TDMA events")

    print(f"Saving CSV -> {CSV_FILE}")

    if save_to_csv(records, CSV_FILE):
        print("Generating plot...")
        plot_tdma_timeline(CSV_FILE)
        print("Done")


if __name__ == "__main__":
    main()