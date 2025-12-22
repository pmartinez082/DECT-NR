import matplotlib.pyplot as plt
import pandas as pd
import numpy as np

files = {
    "TDL-A": "output/anite_tdla.csv",
    "TDL-B": "output/anite_tdlb.csv",
    "TDL-C": "output/anite_tdlc.csv",
}

plt.figure(figsize=(8, 6))

for label, path in files.items():
    df = pd.read_csv(path)
    df.columns = df.columns.str.lower()

    # Map packet error
    df['packet_error'] = df['channel'].apply(
        lambda x: 0 if x.upper() == 'PDC'
        else 1 if x.upper() == 'PDC_ERR'
        else np.nan
    )

    df = df.dropna(subset=['packet_error'])

    # Compute PER per SNR (no filtering, no cleaning)
    per_data = (
        df.groupby('snr')['packet_error']
        .mean()
        .reset_index()
        .sort_values('snr')
    )

    plt.plot(
        per_data['snr'],
        per_data['packet_error'],
        marker='o',
        linewidth=2,
        label=label
    )

plt.xlabel('Signal-to-Noise Ratio (dB)')
plt.ylabel('Packet Error Rate')
plt.title('PER vs SNR for TDL Channels')
plt.grid(True, which='both', linestyle='--', linewidth=0.5)
plt.yscale('log')
plt.legend()
plt.tight_layout()

plt.savefig('output/TDL_comparison.pdf', format='pdf')
plt.show()
