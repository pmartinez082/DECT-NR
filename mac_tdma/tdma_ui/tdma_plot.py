import pandas as pd
import matplotlib.pyplot as plt
import re
import numpy as np

# ---- CONFIG ----
CSV_FILE = "tdma.csv"


TICKS_TO_MS = 1 / 69120  # exact

# ---- LOAD TX DATA ----
df = pd.read_csv(CSV_FILE)
df = df.sort_values("frame_time")

# Separate beacons from PDC data
pdc_df = df[df['reset'] != 'beacon'].copy()
beacon_df = df[df['reset'] == 'beacon'].copy()

t0 = pdc_df["frame_time"].min()
pdc_df["time_ms"] = (pdc_df["frame_time"] - t0) * TICKS_TO_MS

# ---- PARSE BEACONS ----
beacon_ticks = []

# Extract beacons from CSV (rows with reset='beacon')
beacon_rows = df[df['reset'] == 'beacon']
beacon_ticks = beacon_rows['frame_time'].tolist()

beacon_ms = [(t - t0) * TICKS_TO_MS for t in beacon_ticks]

# ---- COLOR MAP (deterministic) ----
tx_ids = sorted(pdc_df["tx_id"].unique())
cmap = plt.cm.get_cmap('tab10', len(tx_ids))  # scalable palette

color_map = {tx: cmap(i) for i, tx in enumerate(tx_ids)}

# ---- PLOT ----
plt.figure()

# TX events (PDC data only)
for tx in tx_ids:
    subset = pdc_df[pdc_df["tx_id"] == tx]

    plt.vlines(
        subset["time_ms"],
        -0.2,
        0.2,
        label=f"TX {tx}",
        colors=[color_map[tx]]
    )

# ---- BEACONS ----
plt.scatter(
    beacon_ms,
    [0.3] * len(beacon_ms),
    marker='^',
    label='Beacon'
)

# ---- FRAME GRID (2s) ----
FRAME_PERIOD_MS = 2000

if beacon_ms:
    start = beacon_ms[0]
    end = max(pdc_df["time_ms"].max(), beacon_ms[-1])

    for t in np.arange(start, end, FRAME_PERIOD_MS):
        plt.axvline(x=t, linestyle=':', linewidth=0.8)

# ---- LABELS ----
plt.xlabel("Time (ms)")
plt.yticks([])
plt.title("TDMA Timeline")

plt.grid(axis='x')
plt.legend()

plt.show()