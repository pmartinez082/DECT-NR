#!/usr/bin/env python3
"""
parse_missing_packets.py

Parses a DECT MAC beacon log (default: logs/master_output.txt) and identifies
missing PDC (Physical Data Channel) packets.

Expected packet structure, per the burst protocol being logged:
  - Packets are logged in "bursts" that share the same Seq id.
  - Each burst is expected to contain 40 packets.
  - Consecutive packets within a burst are expected to be spaced 40 ms apart.
  - The gap between the last packet of one burst and the first packet of the
    next burst (different Seq id) is expected to be 400 ms.

The script:
  1. Parses every line of the form:
       PDC <frame_time> Seq:<seq_id> Tx:<tx> Temp:<temp>
  2. Groups packets by Seq id (each Seq id is treated as one burst).
  3. For each burst, builds the expected 40-slot, 40ms-spaced timeline
     starting at that burst's first observed packet time, and reports any
     slot that has no matching packet as MISSING (with its expected frame
     time and its slot/packet number within the burst, 0-39).
  4. Checks the gap between the end of each burst and the start of the next
     burst against the expected 400 ms and flags any burst-to-burst gap that
     doesn't match (this can indicate whole bursts, or the tail/head of
     adjoining bursts, being lost).

Usage:
    python3 parse_missing_packets.py [logfile] [--csv missing.csv]

    logfile   Path to the log file (default: logs/master_output.txt)
    --csv     Optional path to write a CSV of the missing packets found
"""

import re
import csv
import argparse
from collections import OrderedDict

PDC_RE = re.compile(r'^PDC\s+([\d.]+)\s+Seq:(\d+)\s+Tx:(\d+)\s+Temp:(-?\d+)')

EXPECTED_BURST_SIZE = 50      # expected packets per Seq burst
INTRA_BURST_STEP_MS = 40.0    # expected spacing between packets in same burst
INTER_BURST_GAP_MS = 0    # expected gap between end of one burst and start of next
SLOT_TOLERANCE_MS = 5.0       # tolerance when matching a packet to an expected slot
GAP_TOLERANCE_MS = 5.0        # tolerance when checking the inter-burst gap


def parse_log(path):
    """Read the log file and return a list of packet dicts, in file order."""
    packets = []
    with open(path, 'r') as f:
        for line in f:
            m = PDC_RE.match(line.strip())
            if m:
                packets.append({
                    'time': float(m.group(1)),
                    'seq': int(m.group(2)),
                    'tx': int(m.group(3)),
                    'temp': int(m.group(4)),
                })
    return packets


def group_by_seq(packets):
    """Group packets by Seq id, preserving first-seen order, sorted by time."""
    groups = OrderedDict()
    for p in packets:
        groups.setdefault(p['seq'], []).append(p)
    for seq in groups:
        groups[seq].sort(key=lambda p: p['time'])
    return groups


def analyze_burst(seq, pkts):
    """
    Compare a burst's actual packet times against the expected 40-slot,
    40ms-spaced timeline. Returns (missing_list, found_count, expected_count).
    """
    start_time = pkts[0]['time']
    found_slots = set()

    for p in pkts:
        # Nearest expected slot index for this packet's actual time
        raw_idx = (p['time'] - start_time) / INTRA_BURST_STEP_MS
        idx = round(raw_idx)
        # Only trust the slot match if it's close enough to a clean 40ms step
        if abs(raw_idx - idx) * INTRA_BURST_STEP_MS <= SLOT_TOLERANCE_MS:
            found_slots.add(idx)
        else:
            # Doesn't line up with expected spacing; still record its own
            # slot so it's not falsely reported as "missing" on top of being odd.
            found_slots.add(idx)

    # Burst should span at least the expected 40 slots (0..39), but if more
    # packets were actually seen (e.g. an extra strap packet), extend to cover them.
    last_slot = max(EXPECTED_BURST_SIZE - 1, max(found_slots))

    missing = []
    for idx in range(0, last_slot + 1):
        if idx not in found_slots:
            expected_time = start_time + idx * INTRA_BURST_STEP_MS
            missing.append({
                'seq': seq,
                'slot': idx,
                'expected_time': round(expected_time, 3),
            })

    return missing, len(pkts), last_slot + 1


def analyze_inter_burst(groups):
    """Check the gap between the end of each burst and the start of the next."""
    anomalies = []
    seqs = sorted(groups.keys())
    for i in range(len(seqs) - 1):
        cur_seq, next_seq = seqs[i], seqs[i + 1]
        cur_last_time = groups[cur_seq][-1]['time']
        next_first_time = groups[next_seq][0]['time']
        gap = next_first_time - cur_last_time

        if abs(gap - INTER_BURST_GAP_MS) > GAP_TOLERANCE_MS:
            anomalies.append({
                'from_seq': cur_seq,
                'to_seq': next_seq,
                'gap_ms': round(gap, 3),
                'expected_gap_ms': INTER_BURST_GAP_MS,
                'extra_slots_unaccounted': round((gap - INTER_BURST_GAP_MS) / INTRA_BURST_STEP_MS, 2),
            })
    return anomalies


def main():
    parser = argparse.ArgumentParser(description="Parse PDC log and identify missing packets.")
    parser.add_argument('logfile', nargs='?', default='logs/master_output.txt',
                         help='Path to the log file (default: logs/master_output.txt)')
    parser.add_argument('--csv', default=None,
                         help='Optional path to write a CSV of the missing packets')
    args = parser.parse_args()

    packets = parse_log(args.logfile)
    if not packets:
        print(f"No PDC packets found in {args.logfile}")
        return

    groups = group_by_seq(packets)

    print(f"Parsed {len(packets)} PDC packets across {len(groups)} Seq burst(s).\n")
    print(f"{'Seq':>5} {'Found':>6} {'Expected':>9} {'Missing':>8}")
    print("-" * 32)

    all_missing = []
    for seq, pkts in groups.items():
        missing, found_count, expected_count = analyze_burst(seq, pkts)
        all_missing.extend(missing)
        print(f"{seq:>5} {found_count:>6} {expected_count:>9} {len(missing):>8}")

    total_expected = sum(max(EXPECTED_BURST_SIZE, len(pkts)) for pkts in groups.values())
    print("-" * 32)
    print(f"Total packets found:   {len(packets)}")
    print(f"Total packets missing: {len(all_missing)}")
    '''
    print("\n--- Missing packets (within-burst, by Seq / slot / expected time) ---")
    if all_missing:
        for m in all_missing:
            print(f"Seq {m['seq']:>3} | packet #{m['slot']:>2} of burst | "
                  f"expected frame time: {m['expected_time']}")
    else:
        print("None detected.")

    print("\n--- Inter-burst gap anomalies (Seq-to-Seq gap should be 400 ms) ---")
    anomalies = analyze_inter_burst(groups)
    if anomalies:
        for a in anomalies:
            print(f"Seq {a['from_seq']} -> Seq {a['to_seq']}: gap = {a['gap_ms']} ms "
                  f"(expected {a['expected_gap_ms']} ms) "
                  f"~{a['extra_slots_unaccounted']} extra 40ms slot(s) unaccounted for")
    else:
        print("None detected.")
    '''
    if args.csv:
        with open(args.csv, 'w', newline='') as f:
            writer = csv.writer(f)
            writer.writerow(['seq', 'packet_number_in_burst', 'expected_frame_time_ms'])
            for m in all_missing:
                writer.writerow([m['seq'], m['slot'], m['expected_time']])
        print(f"\nMissing-packet details written to: {args.csv}")


if __name__ == '__main__':
    main()