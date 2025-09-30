import pandas as pd
import matplotlib.pyplot as plt

df = pd.read_csv("rssi_measurements_0.csv")

fig, ax1 = plt.subplots(figsize=(10, 6))

ax1.plot(df["Timestamp (ms)"], df["RSSI (dBm)"], color='tab:blue', marker='o', label='RSSI (dBm)')
ax1.set_xlabel("Tiempo (ms)")
ax1.set_ylabel("RSSI (dBm)", color='tab:blue')
ax1.tick_params(axis='y', labelcolor='tab:blue')
ax1.grid(True, linestyle='--', alpha=0.5)

ax2 = ax1.twinx()
ax2.plot(df["Timestamp (ms)"], df["BER (%)"], color='tab:red', marker='s', label='BER (%)')
ax2.set_ylabel("BER (%)", color='tab:red')
ax2.tick_params(axis='y', labelcolor='tab:red')
ax2.set_ylim(0, 100) 
lines1, labels1 = ax1.get_legend_handles_labels()
lines2, labels2 = ax2.get_legend_handles_labels()
ax1.legend(lines1 + lines2, labels1 + labels2, loc='upper right')

plt.title("RSSI vs BER")
plt.tight_layout()
plt.show()
