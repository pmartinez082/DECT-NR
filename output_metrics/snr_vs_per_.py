import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

# Load CSV
df = pd.read_csv('csv_files/per_snr_59_25dB.csv')

# Compute average SNR in dB
df['snr_avg_db'] = 10 * np.log10(df['snr_low']+df['snr_high']) - 10 * np.log10(2)

# Group by MCS
groups = df.groupby('mcs')

# Define markers and colors
markers = ['o', 's', '^', 'D', 'v', '<', '>', 'p', '*', 'h']
colors = plt.cm.tab10.colors  # 10 distinct colors

plt.figure(figsize=(8, 6))

for i, (mcs, data) in enumerate(groups):
    plt.scatter(
        data['snr_avg_db'], 
        data['PER'], 
        label=f"MCS {mcs}",
        marker=markers[i % len(markers)],  # cycle through markers
        color=colors[i % len(colors)],     # cycle through colors
        s=50,
        alpha=0.8
    )

plt.xlabel('Average SNR (dB)')
plt.ylabel('PER (%)')
plt.title('PER vs SNR')
plt.yscale('log')  # logarithmic PER axis
plt.grid(True, which='both', linestyle='--', alpha=0.7)
plt.legend(title="MCS")
plt.tight_layout()
plt.show()
