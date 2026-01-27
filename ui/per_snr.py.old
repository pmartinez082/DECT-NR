from datetime import datetime
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import csv
import sys
import os

# Get channel type and data directory from command line arguments
file_name = sys.argv[1] if len(sys.argv) > 1 else "AWGN"
data_dir = sys.argv[2] if len(sys.argv) > 2 else "."

# Get today's date folder
today = datetime.now()
date_folder = f"measurements_{today.year}-{today.month:02d}-{today.day:02d}"
measurement_path = os.path.join(data_dir, date_folder, file_name + '.csv')

# === Load CSV ===
df = pd.read_csv(measurement_path)
# row order: channel,mcs,snr,seq_number


'''
Current measurement settings:
- slot count: 2
- slot gap count: 2
- subslot gap count: 0
- channel: 1677
- power = -20 dBm
'''

# === Clean data ===
df.columns = df.columns.str.lower()
'''
# === Sort by sequence number ===
df = df.sort_values('seq_number').reset_index(drop=True)

original_shape = df.shape[0]

# === Detect missing sequence numbers ===
seq = df['seq_number'].dropna().astype(int)

missing_seq_count = 0
if not seq.empty:
    expected_seq = np.arange(seq.min(), seq.max() + 1)
    missing_seq_count = len(set(expected_seq) - set(seq))

print("Missing sequence numbers:", missing_seq_count)
'''
# === Apply filters ===
df = df[df['mcs'] >= 0]
df = df[df['mcs'] <= 4]

# Ensure output directories exist
cleaned_dir = os.path.join(data_dir, 'output', 'cleaned'+datetime.now().strftime("_%Y%m%d"))
graphs_dir = os.path.join(data_dir, 'output', 'graphs'+datetime.now().strftime("_%Y%m%d"))
stats_dir = os.path.join(data_dir, 'output', 'stats'+datetime.now().strftime("_%Y%m%d"))
os.makedirs(cleaned_dir, exist_ok=True)
os.makedirs(graphs_dir, exist_ok=True)
os.makedirs(stats_dir, exist_ok=True)

# Save cleaned CSV
df.to_csv(os.path.join(cleaned_dir, file_name + '_clean.csv'), index=False)

# === Assign packet error based on channel ===
# PDC → 0 (success), PDC_ERR → 1 (error)
# Column 0 is the channel type (pdc, pdc_err), not 'channel'
df['packet_error'] = df.iloc[:, 0].apply(
    lambda x: 0 if str(x).upper() == 'PDC'
    else 1 if str(x).upper() == 'PDC_ERR'
    else np.nan
)

# Drop rows with unexpected channel names
df = df.dropna(subset=['packet_error'])
'''
# === Add virtual packet errors for missing sequence numbers ===
if missing_seq_count > 0:
    virtual_errors = pd.DataFrame({
        'snr': [df['snr'].median()] * missing_seq_count,
        'mcs': [df['mcs'].mode()[0]] * missing_seq_count,
        'packet_error': [1] * missing_seq_count
    })

    df = pd.concat([df, virtual_errors], ignore_index=True)

print("Dropped rows:", original_shape - df.shape[0])

'''
# === Compute PER per SNR per MCS ===

per_data = (
    df.groupby(['snr', 'mcs'])['packet_error']
    .mean()
    .reset_index()
    .rename(columns={'packet_error': 'per'})
)

print("DEBUG: DataFrame shape:", df.shape)
print("DEBUG: DataFrame columns:", df.columns.tolist())
print("DEBUG: DataFrame head:\n", df.head())
print("DEBUG: per_data:\n", per_data)
print("DEBUG: Unique MCS values:", per_data['mcs'].unique())


# === Plot ===
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

# === Export statistics CSV ===
csv_data = [['SNR(dB)', 'MCS', 'Current Samples']]

for _, row in per_data.iterrows():
    sample_count = df[
        (df['snr'] == row['snr']) &
        (df['mcs'] == row['mcs'])
    ].shape[0]

    csv_data.append([
        row['snr'],
        int(row['mcs']),
        int(sample_count)
    ])

# Sort by sample count then SNR
csv_header = csv_data[0]
csv_rows = csv_data[1:]
csv_rows = sorted(csv_rows, key=lambda x: (int(x[2]), float(x[0])))
csv_data = [csv_header] + csv_rows

stats_path = os.path.join(stats_dir, 'statistics_' + file_name.lower() + '.csv')
with open(stats_path, 'w', newline='') as csvfile:
    writer = csv.writer(csvfile)
    writer.writerows(csv_data)
print(f"Statistics saved to: {stats_path}")
