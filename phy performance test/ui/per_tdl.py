from datetime import datetime
import matplotlib.pyplot as plt
import pandas as pd
import csv
import sys
import os

# ===============================
# Configuration
# ===============================
base_name = "TDL-A"
seeds = [1, 2, 3, 4, 5]
data_dir = sys.argv[1] if len(sys.argv) > 1 else "."

MCS_VALUE = 1  # only one MCS

# Today's date folder
today = datetime.now()
date_folder = f"measurements_{today.year}-{today.month:02d}-{today.day:02d}"

# Output directories
cleaned_dir = os.path.join(data_dir, 'output', 'cleaned' + today.strftime("_%Y%m%d"))
graphs_dir = os.path.join(data_dir, 'output', 'graphs' + today.strftime("_%Y%m%d"))
stats_dir = os.path.join(data_dir, 'output', 'stats' + today.strftime("_%Y%m%d"))
os.makedirs(cleaned_dir, exist_ok=True)
os.makedirs(graphs_dir, exist_ok=True)
os.makedirs(stats_dir, exist_ok=True)

# ===============================
# Process each seed
# ===============================
all_seed_per = []    # PER vs SNR per seed
all_raw_data = []    # for stats if needed

plt.figure(figsize=(9, 7))

for seed in seeds:
    file_name = f"{base_name}_seed{seed}"
    measurement_path = os.path.join(data_dir, date_folder, file_name + ".csv")

    print(f"Loading {measurement_path}")

    # --- Load CSV ---
    df = pd.read_csv(measurement_path)
    df.columns = df.columns.str.lower()

    # Keep only MCS 1 (safety)
    df = df[df['mcs'] == MCS_VALUE]

    # --- Compute PER ---
    df['per'] = (df['sent'] - df['received']) / df['sent']
    df['per'] = df['per'].clip(0, 1)

    # Save cleaned CSV
    df.to_csv(os.path.join(cleaned_dir, file_name + "_clean.csv"), index=False)

    # --- PER per SNR ---
    per_data = (
        df.groupby('snr')
          .agg({'sent': 'sum', 'received': 'sum'})
          .reset_index()
    )
    per_data['per'] = (per_data['sent'] - per_data['received']) / per_data['sent']
    per_data['seed'] = seed

    all_seed_per.append(per_data)

    # --- Plot this seed (light curve) ---
    plt.plot(
        per_data['snr'],
        per_data['per'],
        linestyle='--',
        linewidth=1,
        alpha=0.4,
        label=f"Seed {seed}"
    )

# ===============================
# Average across seeds
# ===============================
avg_data = (
    pd.concat(all_seed_per)
      .groupby('snr')
      .agg({'per': 'mean'})
      .reset_index()
)

# --- Plot average (bold) ---
plt.plot(
    avg_data['snr'],
    avg_data['per'],
    color='black',
    linewidth=3,
    label='Average'
)

# ===============================
# Final plot formatting
# ===============================
plt.xlabel('Signal-to-Noise Ratio (dB)')
plt.ylabel('Packet Error Rate')
plt.title('TDL-A channel — 5 seeds (MCS 1)')
plt.grid(True, which='both', linestyle='--', linewidth=0.5)
plt.yscale('log')
plt.legend()
plt.tight_layout()

pdf_path = os.path.join(graphs_dir, "TDL-A_all_seeds_MCS1.pdf")
plt.savefig(pdf_path, format='pdf')
plt.show()

print(f"Graph saved to: {pdf_path}")

# ===============================
# Export statistics (average PER)
# ===============================
stats_rows = [['SNR(dB)', 'PER_avg']]

for _, row in avg_data.iterrows():
    stats_rows.append([
        row['snr'],
        row['per']
    ])

stats_path = os.path.join(stats_dir, "statistics_tdl-a_avg_mcs1.csv")
with open(stats_path, 'w', newline='') as csvfile:
    writer = csv.writer(csvfile)
    writer.writerows(stats_rows)

print(f"Statistics saved to: {stats_path}")
