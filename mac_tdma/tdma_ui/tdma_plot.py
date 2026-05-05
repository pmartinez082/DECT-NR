import pandas as pd
import matplotlib.pyplot as plt

# ---- CONFIG ----
CSV_FILE = "tdma.csv"

# ---- LOAD ----
df = pd.read_csv(CSV_FILE)
df = df.sort_values("frame_time")

# Normalize time
t0 = df["frame_time"].min()
df["time_rel"] = df["frame_time"] - t0

# Optional: convert to ms for readability
df["time_ms"] = df["time_rel"] / 1e6

# ---- COLORS ----
tx_ids = sorted(df["tx_id"].unique())
color_map = {tx: i for i, tx in enumerate(tx_ids)}  # numeric mapping

# ---- PLOT ----
plt.figure()

for tx in tx_ids:
    subset = df[df["tx_id"] == tx]

    plt.scatter(
        subset["time_ms"],
        [0] * len(subset),   # ✅ all on same line
        marker='|',
        label=f"TX {tx}"
    )

# ---- LABELS ----
plt.xlabel("Time (ms)")
plt.yticks([])  # hide Y axis (single line)
plt.title("TDMA Transmission Timeline (Single-Line View)")

# ---- GRID ----
plt.grid(axis='x')

# ---- LEGEND ----
plt.legend()

plt.show()