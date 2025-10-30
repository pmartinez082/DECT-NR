import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

# === Load CSV ===
df = pd.read_csv('csv_files/20251028_ping.csv')

# === Clean data ===
df.columns = df.columns.str.lower()

# Drop rows where snr is <= 0
df = df[df['snr'] > 0]

# Assign packet error based on channel
# PDC → 0, PCC → 0, PDC_ERR/PCC_ERR → 1
df['packet_error'] = df['channel'].apply(
    lambda x: 0 if x.upper() == 'PDC' or x.upper() == 'PCC'
    else 1 if x.upper() in ['PDC_ERR', 'PCC_ERR']
    else np.nan
)

# Drop rows where packet_error is NaN (unexpected channel names)
df = df.dropna(subset=['packet_error'])

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

plt.xlabel('SNR [dB]')
plt.ylabel('Packet Error Rate (PER)')
plt.title('PER vs SNR per MCS')
plt.grid(True, which='both', linestyle='--', linewidth=0.5)
plt.yscale('log')  # <<< Make y-axis logarithmic

plt.legend(title='MCS')
plt.tight_layout()

# Save and show
plt.savefig('output/per_vs_snr.pdf', format='pdf')
plt.show()
