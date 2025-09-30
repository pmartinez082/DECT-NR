import pandas as pd
import matplotlib.pyplot as plt

# Read the CSV file
df = pd.read_csv("rssi_measurements_0.csv")

# Calculate the mean of RSSI and SNR
mean_rssi = 0.5 * (df['rx_rssi_high_level'] + df['rx_rssi_low_level'])
mean_snr = 0.5 * (df['rx_snr_high'] + df['rx_snr_low'])

# Create a figure
fig, ax = plt.subplots(figsize=(10, 6))

# Scatter plot of mean SNR vs mean RSSI
ax.scatter(mean_rssi, mean_snr, color='blue', label='Mean', marker='o')

# Set axis labels
ax.set_xlabel("RSSI (dBm)")
ax.set_ylabel("SNR (dB)")

# Enable grid
ax.grid(True, linestyle='--', alpha=0.5)

# Add legend
ax.legend(loc='upper left')

# Add title
plt.title("SNR vs RSSI (Scatter)")

# Adjust layout and show plot
plt.tight_layout()
plt.show()
