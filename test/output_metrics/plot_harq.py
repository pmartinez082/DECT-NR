import pandas as pd
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.colors import ListedColormap, BoundaryNorm
# Read the CSV file
#dfServer = pd.read_csv("csv_files/20251007_measurements_HARQ_server.csv")
dfClient = pd.read_csv(
    "csv_files/20251007_measurements_HARQ_client.csv",
    sep=",",          # your CSV uses commas
    index_col=False,  # do not use first column as index
    engine="python",  # more flexible parser
    skipinitialspace=True,
    quotechar='"',
    on_bad_lines="skip"
)

print(dfClient.head(5))
print(dfClient.columns)

df_noHARQ = pd.read_csv("csv_files/20251002_measurements_noHARQ_mcs_3&4.csv")

print(dfClient.dtypes)
print(dfClient.columns.tolist())
print(dfClient[["pdc_crc_err_cnt", "packet_count", "throughput_kbps"]].head(20))
print(dfClient[["pdc_crc_err_cnt", "packet_count"]].dtypes)


# HARQ 
error_rate = dfClient["pdc_crc_err_cnt"] / dfClient["packet_count"]
througput = dfClient["throughput_kbps"] 

print(error_rate)

# NoHARQ data
error_rate_noHARQ = df_noHARQ["pdc_crc_err_cnt"] / df_noHARQ["packet_count"]
througput_noHARQ = df_noHARQ["data_rate"] 


fig, ax = plt.subplots(figsize=(10, 6))

cmap = plt.get_cmap('viridis', 4)  
norm = BoundaryNorm(np.arange(2.5, 5.5, 1), cmap.N)  
scatter = ax.scatter(
    error_rate,
    througput,
    
              
    marker='o',
    s=60,
    edgecolor='k',
    alpha=0.8
)
"""
scatter_noHARQ = ax.scatter(
    error_rate_noHARQ,
    througput_noHARQ,
   
               
    marker='o',
    s=60,
    edgecolor='k',
    alpha=0.8
)
"""
ax.set_xlabel("Error rate")
ax.set_ylabel("Throughput (Kbps)")
ax.legend(loc='upper left')
plt.title("Error rate vs throughput")
plt.tight_layout()
plt.savefig("output/error_rate_vs_throughput.pdf", format="pdf")
plt.show()
