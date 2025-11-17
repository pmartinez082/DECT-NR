import pandas as pd
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.colors import ListedColormap, BoundaryNorm
# Read the CSV file
df = pd.read_csv("csv_files/20251002_measurements_noHARQ_mcs_3&4.csv")

# Calculate the mean of RSSI and SNR

mean_rssi = 10 * np.log10(
    0.5 * (10 ** (df['rx_rssi_high_level'] / 10)) + (10 ** (df['rx_rssi_low_level'] / 10))
)

mean_snr = 10 * np.log10(
    0.5 * ( (df['rx_snr_high'])) + ( (df['rx_snr_low']))
)
# Create a figure
fig, ax = plt.subplots(figsize=(10, 6))


cmap = plt.get_cmap('viridis', 4)  
norm = BoundaryNorm(np.arange(2.5, 5.5, 1), cmap.N)  


# Scatter plot with discrete colors
scatter = ax.scatter(
    mean_rssi,
    mean_snr,
    c=df["rx_testing_mcs"],
    cmap=cmap,
    norm=norm,            
    marker='o',
    s=60,
    edgecolor='k',
    alpha=0.8
)

# Colorbar with integer ticks
cbar = plt.colorbar(scatter, ax=ax, ticks=np.arange(3, 6, 1))
cbar.set_label("MCS")

# Set axis labels
ax.set_xlabel("RSSI (dBm)")
ax.set_ylabel("SNR (dB)")




# Enable grid
ax.grid(True, linestyle='--', alpha=0.5)

# Add legend
ax.legend(loc='upper left')

# Add title
plt.title("SNR vs RSSI")

# Adjust layout and show plot
plt.tight_layout()

plt.savefig("output/snr_vs_rssi_noHarq_0210.pdf", format="pdf")

plt.show()
