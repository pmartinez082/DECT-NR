import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import csv

# === Load CSV ===
df = pd.read_csv('output/anite_tdlc.csv')

'''
Current measurement settings:
- slot count: 2
- slot gap count: 2
- subslot gap count: 0
- channel: 1677
- power = -20 dBm'''

# === Clean data ===
df.columns = df.columns.str.lower()

shape = df.shape[0]


df = df[df['snr'] >= 0]
# Drop rows where mcs > 4 | mcs < 1
df = df[df['mcs'] == 1]





df.to_csv('output/tdlc_clean.csv', index=False)
# Assign packet error based on channel
# PDCC → 0 (success), PDC_ERR → 1 (error)
df['packet_error'] = df['channel'].apply(
    lambda x: 0 if x.upper() in ['PDC']
    else 1 if x.upper() in ['PDC_ERR'] 
    else np.nan
)


# Drop rows where packet_error is NaN (unexpected channel names)
df = df.dropna(subset=['packet_error'])




print("Dropped rows:", shape - df.shape[0])



# === Compute PER per SNR per MCS ===
per_data = (
    df.groupby(['snr', 'mcs'])['packet_error']
    .mean()
    .reset_index()
    .rename(columns={'packet_error': 'per'})
)


# === Plot ===
plt.figure(figsize=(8,6))

for mcs in sorted(per_data['mcs'].unique()):
    mcs_data = per_data[per_data['mcs'] == mcs].sort_values('snr')
    if mcs_data.empty:
        continue

    # Scatter points
    plt.scatter(mcs_data['snr'], mcs_data['per'], marker='o', s=20, alpha=0.6, label=f'MCS {mcs}')

    # Connect the dots
    plt.plot(mcs_data['snr'], mcs_data['per'], linewidth=2)




plt.xlabel('Signal-to-Noise Ratio (dB)')
plt.ylabel('Packet Error Rate')
plt.title('TDL-C channel')
plt.grid(True, which='both', linestyle='--', linewidth=0.5)
plt.yscale('log')  # <<< Make y-axis logarithmic

# Only create legend if there are artists with labels
handles, labels = plt.gca().get_legend_handles_labels()
if handles:
    plt.legend(title='MCS')
plt.tight_layout()




csv_data = [['SNR(dB)', 'MCS', 'Current Samples' ]]
for _, row in per_data.iterrows():
        csv_data.append([row['snr'], int(row['mcs']), int(df[(df['snr'] == row['snr']) & (df['mcs'] == row['mcs'])].shape[0])])

# sort csv_data by MCS and SNR
csv_header = csv_data[0]
csv_data_rows = csv_data[1:]
csv_data_rows = sorted(csv_data_rows, key=lambda x: (int(x[2]), float(x[0])))
csv_data = [csv_header] + csv_data_rows

# Save and show
plt.savefig('output/TDL-C.pdf', format='pdf')


# Save CSV data
with open('output/statistics_tdlc.csv', 'w', newline='') as csvfile:
    writer = csv.writer(csvfile)
    writer.writerows(csv_data)

