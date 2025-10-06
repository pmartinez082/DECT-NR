import pandas as pd
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.colors import ListedColormap, BoundaryNorm
# Read the CSV file
df = pd.read_csv("csv_files/20251006_measurements_HARQ_mcs_3&4.csv")
df_noHARQ = pd.read_csv("csv_files/20251002_measurements_noHARQ_mcs_3&4.csv")



# HARQ 
df_tx = df["tx_id"] == 0
df_rx = df["tx_id"] != 0
df_rx = df[df_rx]
print(df_rx)
error_rate = df_rx["pdc_crc_err_cnt"] / df_rx["total_data_pkts"]
througput = df_rx["data_rate_kbps"] / 1e3  # Convert to Mbps


# NoHARQ data
error_rate_noHARQ = df_noHARQ["pdc_crc_err_cnt"] / df_noHARQ["packet_count"]
througput_noHARQ = df_noHARQ["data_rate"] / 1e3  # Convert to Mbps


fig, ax = plt.subplots(figsize=(10, 6))

cmap = plt.get_cmap('viridis', 4)  
norm = BoundaryNorm(np.arange(2.5, 5.5, 1), cmap.N)  
scatter = ax.scatter(
    error_rate,
    througput,
    
    cmap=cmap,
    norm=norm,            
    marker='o',
    s=60,
    edgecolor='k',
    alpha=0.8
)

scatter_noHARQ = ax.scatter(
    error_rate_noHARQ,
    througput_noHARQ,
   
    cmap=cmap,
    norm=norm,            
    marker='o',
    s=60,
    edgecolor='k',
    alpha=0.8
)

cbar = plt.colorbar(scatter, ax=ax, ticks=np.arange(3, 6, 1))
cbar.set_label("MCS")
ax.set_xlabel("Error rate")
ax.set_ylabel("Throughput (Mbps)")
ax.legend(loc='upper left')
plt.title("Error rate vs throughput")
plt.tight_layout()
plt.savefig("output/error_rate_vs_throughput.pdf", format="pdf")
plt.show()