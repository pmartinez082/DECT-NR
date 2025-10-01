import pandas as pd
import matplotlib.pyplot as plt
import numpy as np
# Read the CSV file
df = pd.read_csv("rssi_measurements_2.csv")

# Calculate the mean of RSSI and SNR

mean_rssi = 10 * np.log10(
    0.5 * (10 ** (df['rx_rssi_high_level'] / 10)) + (10 ** (df['rx_rssi_low_level'] / 10))
)

mean_snr = 10 * np.log10(
    0.5 * (10 ** (df['rx_snr_high'] / 10)) + (10 ** (df['rx_snr_low'] / 10))
)
# Create a figure
fig, ax = plt.subplots(figsize=(10, 6))



# Scatter plot of mean SNR vs mean RSSI + fitted line
ax.scatter(mean_rssi, mean_snr, color='blue', marker='o')


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

plt.savefig("snr_vs_rssi.pdf", format="pdf")

plt.show()
