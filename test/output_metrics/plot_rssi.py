import pandas as pd
import matplotlib.pyplot as plt

# Read the CSV file
df = pd.read_csv("rssi_measurements_0.csv")

# Calculate the mean of RSSI and SNR
mean_rssi = 0.5 * (df['rx_rssi_high_level'] + df['rx_rssi_low_level'])
mean_snr = 0.5 * (df['rx_snr_high'] + df['rx_snr_low'])

# Create a figure
fig, ax = plt.subplots(figsize=(10, 6))

<<<<<<< HEAD
# Scatter plot of mean SNR vs mean RSSI
ax.scatter(mean_rssi, mean_snr, color='blue', label='Mean', marker='o')
=======
ax2 = ax1.twinx()
ax2.plot(df["Timestamp (ms)"], df["BER (%)"], color='tab:red', marker='s', label='BER (%)')
ax2.set_ylabel("BER (%)", color='tab:red')
ax2.tick_params(axis='y', labelcolor='tab:red')
ax2.set_ylim(0, 100)  # Limit BER axis from 0 to 100%
>>>>>>> bb51f256e092cbb3c69fdf90be20cf618e147406

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
