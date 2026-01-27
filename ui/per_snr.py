from datetime import datetime
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import csv
import sys
import os

# --- Input arguments ---
file_name = sys.argv[1] if len(sys.argv) > 1 else "AWGN"
data_dir = sys.argv[2] if len(sys.argv) > 2 else "."

# Today's date folder
today = datetime.now()
date_folder = f"measurements_{today.year}-{today.month:02d}-{today.day:02d}"
measurement_path = os.path.join(data_dir, date_folder, file_name + '.csv')

# --- Load CSV ---
df = pd.read_csv(measurement_path)
df.columns = df.columns.str.lower()

# Ensure output directories exist
cleaned_dir = os.path.join(data_dir, 'output', 'cleaned'+today.strftime("_%Y%m%d"))
graphs_dir = os.path.join(data_dir, 'output', 'graphs'+today.strftime("_%Y%m%d"))
stats_dir = os.path.join(data_dir, 'output', 'stats'+today.strftime("_%Y%m%d"))
os.makedirs(cleaned_dir, exist_ok=True)
os.makedirs(graphs_dir, exist_ok=True)
os.makedirs(stats_dir, exist_ok=True)



# --- Compute PER ---
df['per'] = (df['sent'] - df['received']) / df['sent']
df['per'] = df['per'].clip(0, 1)  # ensure between 0 and 1

# Save cleaned CSV
df.to_csv(os.path.join(cleaned_dir, file_name + '_clean.csv'), index=False)

# --- Compute PER per SNR and MCS ---
per_data = (
    df.groupby(['snr', 'mcs'])
      .agg({'sent': 'sum', 'received': 'sum'})
      .reset_index()
)
per_data['per'] = (per_data['sent'] - per_data['received']) / per_data['sent']

# Debug
print("PER data:\n", per_data.head())

# --- Plot PER curves ---
plt.figure(figsize=(8, 6))

for mcs in sorted(per_data['mcs'].unique()):
    mcs_data = per_data[per_data['mcs'] == mcs].sort_values('snr')
    if mcs_data.empty:
        continue

    plt.scatter(
        mcs_data['snr'],
        mcs_data['per'],
        marker='o',
        s=20,
        alpha=0.6,
        label=f'MCS {mcs}'
    )

    plt.plot(
        mcs_data['snr'],
        mcs_data['per'],
        linewidth=2
    )

plt.xlabel('Signal-to-Noise Ratio (dB)')
plt.ylabel('Packet Error Rate')
plt.title(file_name + ' channel')
plt.grid(True, which='both', linestyle='--', linewidth=0.5)
plt.yscale('log')

handles, labels = plt.gca().get_legend_handles_labels()
if handles:
    plt.legend(title='MCS')

plt.tight_layout()
pdf_path = os.path.join(graphs_dir, file_name + '.pdf')
plt.savefig(pdf_path, format='pdf')
print(f"Graph saved to: {pdf_path}")

# --- Export statistics CSV ---
csv_data = [['SNR(dB)', 'MCS', 'Samples', 'PER']]

for _, row in per_data.iterrows():
    sample_count = df[(df['snr'] == row['snr']) & (df['mcs'] == row['mcs'])].shape[0]
    csv_data.append([
        row['snr'],
        int(row['mcs']),
        int(sample_count),
        row['per']
    ])

# Sort by SNR then MCS
csv_header = csv_data[0]
csv_rows = csv_data[1:]
csv_rows = sorted(csv_rows, key=lambda x: (float(x[0]), int(x[1])))
csv_data = [csv_header] + csv_rows

stats_path = os.path.join(stats_dir, 'statistics_' + file_name.lower() + '.csv')
with open(stats_path, 'w', newline='') as csvfile:
    writer = csv.writer(csvfile)
    writer.writerows(csv_data)
print(f"Statistics saved to: {stats_path}")
