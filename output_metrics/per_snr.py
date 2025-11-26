import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import csv

# === Load CSV ===
df = pd.read_csv('csv_files/anite_gauss.csv')

# === Clean data ===
df.columns = df.columns.str.lower()


# Drop rows where snr is <= 0
df = df[df['snr'] > 0]

# Assign packet error based on channel
# PDC → 0, PCC → 0, PDC_ERR/PCC_ERR → 1
df['packet_error'] = df['channel'].apply(
    lambda x: 0 if x.upper() == 'PDC' or x.upper() == 'PCC'
    else 1 if x.upper() in ['PDC_ERR' ]
    else np.nan
)

# Drop rows where packet_error is NaN (unexpected channel names)
df = df.dropna(subset=['packet_error'])

# Drop rows where mcs > 4 | mcs < 1
df = df[df['mcs'] > 0]
df = df[df['mcs'] < 5]



# === Compute PER per SNR per MCS ===
per_data = (
    df.groupby(['snr', 'mcs'])['packet_error']
    .mean()
    .reset_index()
    .rename(columns={'packet_error': 'per'})
)

# === Convert SNR to dB ===
per_data['snr_db'] = 10 * np.log10(per_data['snr'])

# === Plot ===
plt.figure(figsize=(8,6))
for mcs in sorted(per_data['mcs'].unique()):
    mcs_data = per_data[per_data['mcs'] == mcs].sort_values('snr_db')
    plt.scatter(mcs_data['snr_db'], mcs_data['per'], marker='o', label=f'MCS {mcs}')

plt.xlabel('Signal-to-Noise Ratio (dB)')
plt.ylabel('Packet Error Rate')
plt.title('AWGN channel')
plt.grid(True, which='both', linestyle='--', linewidth=0.5)
plt.yscale('log')  # <<< Make y-axis logarithmic

plt.legend(title='MCS')
plt.tight_layout()



# Print snr values that need more data (1M samples needed per SNR value per MCS) and save to CSV file

csv_data = [ ['SNR (dB)', 'MCS', 'Current Samples', 'Additional Samples Needed'] ]
required_samples = 1_000_000
for _, row in per_data.iterrows():
    if int(df[(df['snr'] == row['snr']) & (df['mcs'] == row['mcs'])].shape[0]) < required_samples:
        csv_data.append([row['snr'], int(row['mcs']), int(df[(df['snr'] == row['snr']) & (df['mcs'] == row['mcs'])].shape[0]), required_samples - int(df[(df['snr'] == row['snr']) & (df['mcs'] == row['mcs'])].shape[0])])

# sort csv_data by MCS and SNR
# Separate header and data, then sort data only
csv_header = csv_data[0]
csv_data_rows = csv_data[1:]
csv_data_rows = sorted(csv_data_rows, key=lambda x: (int(x[1]), float(x[0])))
csv_data = [csv_header] + csv_data_rows

# Save and show
plt.savefig('output/AWGN.pdf', format='pdf')


# Save CSV data
with open('output/statistics_AWGN.csv', 'w', newline='') as csvfile:
    writer = csv.writer(csvfile)
    writer.writerows(csv_data)

