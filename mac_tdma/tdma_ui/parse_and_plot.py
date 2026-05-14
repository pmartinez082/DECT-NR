#!/usr/bin/env python3
"""
Parse master_output.txt and generate TDMA CSV and plot
"""

import pandas as pd
import matplotlib.pyplot as plt
import re
import numpy as np
import sys
from pathlib import Path

# ---- CONFIG ----
MASTER_LOG_FILE = "master_output.txt"
CSV_FILE = "tdma.csv"

TICKS_TO_MS = 1 / 69120  # exact conversion factor

def parse_master_log(log_file):
    """
    Parse master_output.txt and extract TDMA transmission data.
    Returns list of dicts with keys: frame_time, beacon, seq, tx_id
    """
    if not Path(log_file).exists():
        print(f"Error: {log_file} not found")
        return []
    
    records = []
    current_pdc = None
    
    with open(log_file, 'r') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            
            # ---- Beacon TX callback ----
            m = re.search(r'Beacon TX callback fired: frame_time=(\d+)', line)
            if m:
                beacon_frame_time = int(m.group(1))
                records.append({
                    'frame_time': beacon_frame_time,
                    'beacon': True,
                    'seq': 0,
                    'tx_id': 0
                })
                continue
            
            # ---- Start of new PDC ----
            m = re.search(r'PDC received at frame_time (\d+)', line)
            if m:
                # Flush previous PDC if exists
                if current_pdc and current_pdc['frame_time'] is not None:
                    records.append(current_pdc)
                
                current_pdc = {
                    'frame_time': int(m.group(1)),
                    'beacon': False,
                    'seq': None,
                    'tx_id': None
                }
                continue
            
            if not current_pdc:
                continue
            
            # ---- Parse PDC fields ----
            
            
            m = re.search(r'Seq Nbr:\s*(\d+)', line, re.IGNORECASE)
            if m:
                current_pdc['seq'] = int(m.group(1))
            
            m = re.search(r'Tx id:\s*(\d+)', line, re.IGNORECASE)
            if m:
                current_pdc['tx_id'] = int(m.group(1))
                # Finalize record when TX ID arrives
                if current_pdc['frame_time'] is not None:
                    records.append(current_pdc)
                current_pdc = None
    
    # Flush last incomplete PDC
    if current_pdc and current_pdc['frame_time'] is not None:
        records.append(current_pdc)
    
    return records

def save_to_csv(records, csv_file):
    """
    Save parsed records to CSV file
    """
    if not records:
        print("No records to save")
        return False
    
    df = pd.DataFrame(records)
    df.to_csv(csv_file, index=False)
    print(f"Saved {len(records)} records to {csv_file}")
    return True

def plot_tdma_timeline(csv_file):
    """
    Plot TDMA timeline with transmissions and beacons
    """
    if not Path(csv_file).exists():
        print(f"Error: {csv_file} not found")
        return
    
    # ---- LOAD TX DATA ----
    df = pd.read_csv(csv_file)
    df = df.sort_values("frame_time")
    
    # Separate beacons from PDC data
    pdc_df = df[df['beacon'] != True].copy()
    beacon_df = df[df['beacon'] == True].copy()
    
    if len(pdc_df) == 0:
        print("No PDC data found to plot")
        return
    
    t0 = pdc_df["frame_time"].min()
    pdc_df["time_ms"] = (pdc_df["frame_time"] - t0) * TICKS_TO_MS
    
    # ---- PARSE BEACONS ----
    beacon_ticks = beacon_df['frame_time'].tolist()
    beacon_ms = [(t - t0) * TICKS_TO_MS for t in beacon_ticks]
    
    # ---- COLOR MAP (deterministic) ----
    tx_ids = sorted(pdc_df["tx_id"].unique())
    cmap = plt.cm.get_cmap('tab10', len(tx_ids))  # scalable palette
    
    color_map = {tx: cmap(i) for i, tx in enumerate(tx_ids)}
    
    # ---- PLOT ----
    plt.figure(figsize=(14, 6))
    
    # TX events (PDC data only)
    for tx in tx_ids:
        subset = pdc_df[pdc_df["tx_id"] == tx]
        
        plt.vlines(
            subset["time_ms"],
            -0.2,
            0.2,
            label=f"TX {tx}",
            colors=[color_map[tx]],
            linewidth=2
        )
    
    # ---- BEACONS ----
    if len(beacon_ms) > 0:
        plt.scatter(
            beacon_ms,
            [0.3] * len(beacon_ms),
            marker='^',
            label='Beacon',
            s=100,
            color='red',
            zorder=5
        )
    
    # ---- FRAME GRID (2s) ----
    FRAME_PERIOD_MS = 2000
    
    if beacon_ms or len(pdc_df) > 0:
        start = min(beacon_ms) if beacon_ms else pdc_df["time_ms"].min()
        end = max(pdc_df["time_ms"].max(), max(beacon_ms) if beacon_ms else 0)
        
        for t in np.arange(start, end, FRAME_PERIOD_MS):
            plt.axvline(x=t, linestyle=':', linewidth=0.8, alpha=0.5)
    
    # ---- LABELS ----
    plt.xlabel("Time (ms)", fontsize=12)
    plt.ylabel("", fontsize=12)
    plt.title("TDMA Timeline", fontsize=14)
    plt.yticks([])
    
    plt.grid(axis='x', alpha=0.3)
    plt.legend(loc='upper left', fontsize=10)
    plt.tight_layout()
    
    plt.savefig('tdma_timeline.png', dpi=150, bbox_inches='tight')
    print("Saved plot to tdma_timeline.png")
    plt.show()

def main():
    """
    Main function: parse log -> generate CSV -> plot
    """
    print(f"Parsing {MASTER_LOG_FILE}...")
    records = parse_master_log(MASTER_LOG_FILE)
    
    if not records:
        print("No records found in master output")
        return
    
    print(f"Found {len(records)} TDMA events")
    
    print(f"\nSaving to {CSV_FILE}...")
    if save_to_csv(records, CSV_FILE):
        print(f"\nGenerating plot...")
        plot_tdma_timeline(CSV_FILE)
        print("\nDone!")

if __name__ == '__main__':
    main()
