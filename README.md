# DECT-NR


# DECT Ping Instructions

## Overview
This guide explains how to run the **DECT Ping** test using two kits — one configured as the RX server and the other as the TX client.  
The program is already flashed on both kits (with `MCS` hardcoded to **4**).

---

## RX Server Setup

### Command

```bash
dect ping -s --channel 1677 -t -1
```

---

## TX Client Setup

### Command
```bash
dect ping -c --s_tx_id 39 --c_tx_pwr -40 -i 3 -t 2000 -l 4 --c_tx_mcs 4 --c_count 4096 --channel 1677 --c_slots 3
```

---

## Output and Results

Valuable results will be printed on the **server side**:

```
CSV header format: [channel, mcs, snr]
```

### Channel Metrics
```
[PCC, PDC, PCC_err, PDC_err]
```

> **Note:** PCC’s MCS is hardcoded to **1**.  
> **Important:** SNR results are **linear**, not logarithmic.

---

## Saving Results

You can save the terminal output in one of two ways:

1. Use the **"Write to File"** option in the nRF terminal.
2. Press **Ctrl + A** then **Ctrl + C** to copy all output manually into a csv file.

---

## Plotting SNR Graphs

To visualize results, run:

```bash
python output_metrics/per_snr.py
```

> Ensure the **file path** to your saved results is correctly specified inside the script.

---

## Notes

- Both kits must already be flashed with the DECT Ping program.

````
