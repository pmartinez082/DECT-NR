import pandas as pd
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.colors import ListedColormap, BoundaryNorm
from datetime import datetime

df = pd.read_csv("rssi_measurements_0.csv")

fig, ax = plt.subplots(figsize=(10, 6))

cmap = plt.get_cmap('viridis', 4)  
norm = BoundaryNorm(np.arange(2.5, 5.5, 1), cmap.N)  


scatter = ax.scatter(
    df["throuhput"],
    df["PER"],
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
ax.set_xlabel("Throughput (kbps)")
ax.set_ylabel("PER (%)")
ax.set_title("Throughput vs PER")
ax.set_ylim(0, 100)

# Enable grid
ax.grid(True, linestyle='--', alpha=0.5)

# Save plot
plt.savefig("output/"+datetime.now().strftime("%Y%m%d")+"_throughput_vs_PER.pdf", format="pdf")
plt.show()