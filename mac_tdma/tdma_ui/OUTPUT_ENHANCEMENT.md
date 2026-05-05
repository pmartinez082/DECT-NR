# Optional: Shell Output Enhancement Guide

## Overview

You mentioned wanting to enhance the master output to display:
- Message/Fragment ID
- Assigned Slot  
- Frame Time
- In MCS format

This document describes potential C code modifications to achieve this.

## Current Output

Currently, when a slave sends data via RACH TX to the master, the output looks like:

```
PDC received (stf start time 32017011258): status: "valid - PDC can be received", snr 91, RSSI-2 -123
phy header: short nw id 120 (0x78), transmitter id 27761
len 0, MCS 0, TX pwr: 0 dBm
DECT NR+ MAC PDU:
  MAC header: Version: 0, Type: DATA MAC PDU header, Seq Nbr: 1
  SDU 1: User plane data - flow 1, Payload: "Test Data"
```

## Desired Enhanced Output

The enhanced output format could be:

```
[RACH-RX] Frame Time: 32017011258 | MCS: 0 | Assigned Slot: 42 | Fragment ID: 1 | Seq#: 1
Received from TX ID: 27761 | SNR: 91dB | RSSI: -61dBm
Data: "Test Data" | Length: 9 bytes
```

## Files to Modify

### 1. **dect_phy_mac.c** (Primary)
Location: `tdma/src/dect/mac/dect_phy_mac.c`

This file handles PDC reception and decoding. Key areas:

```c
// Around line 401-420 where PDC is received and decoded
desh_print("PDC received (stf start time %llu, handle %d): snr %d, "
           "RSSI-2 %d (RSSI %d), len %u",
           stf, handle, rx_data->pdu_rx_data.snr,
           ...);
```

### 2. **dect_phy_mac_cluster_beacon.c** (Secondary)
Location: `tdma/src/dect/mac/dect_phy_mac_cluster_beacon.c`

Handles beacon scheduling and slot assignment tracking.

### 3. **dect_phy_mac_pdu.c** (PDU Parsing)
Location: `tdma/src/dect/mac/dect_phy_mac_pdu.c`

Contains MAC PDU encoding/decoding logic.

## Implementation Approach

### Step 1: Add Enhanced Output Function

Create a new function in `dect_phy_mac.c`:

```c
static void dect_phy_mac_print_rach_rx_enhanced(
    uint64_t frame_time,
    uint8_t mcs,
    uint8_t assigned_slot,
    uint8_t fragment_id,
    uint8_t seq_nbr,
    uint16_t tx_id,
    int snr,
    int rssi_dbm,
    const char *data,
    size_t data_len)
{
    desh_print("[RACH-RX] Frame Time: %llu | MCS: %u | Slot: %u | Frag ID: %u | Seq#: %u",
               frame_time, mcs, assigned_slot, fragment_id, seq_nbr);
    desh_print("From TX ID: %u | SNR: %ddB | RSSI: %ddBm",
               tx_id, snr, rssi_dbm);
    desh_print("Data: \"%s\" | Length: %u bytes",
               data, data_len);
}
```

### Step 2: Track Slot Information

In beacon's PDC handling, pass assigned slot info:

```c
// In cluster_beacon handling
struct dect_phy_mac_client_info *client = get_client_by_tx_id(tx_id);
if (client) {
    dect_phy_mac_print_rach_rx_enhanced(
        frame_time,
        mcs,
        client->assigned_slot_start,  // Assigned slot
        fragment_id,                   // From MAC header
        seq_nbr,                       // From MAC header
        tx_id,
        snr,
        rssi_dbm,
        payload_data,
        payload_len);
}
```

### Step 3: Extract MCS from PHY Layer

The MCS is already available in the RX data:

```c
// Already available in dect_phy_rx_common_header_t
uint8_t mcs = phy_header->mcs;  // 0-4
```

### Step 4: Extract Fragment/Sequence Info

From MAC PDU header:

```c
// In dect_phy_mac_pdu.c decoding
struct dect_phy_mac_common_header *mac_hdr = &decoded_pdu->common_header;
uint8_t seq_nbr = mac_hdr->seq_nbr;        // Sequence number
uint8_t reset = mac_hdr->reset;            // Reset flag (new fragment)
```

## Example Modifications

### In dect_phy_mac.c (around line 400)

**Before:**
```c
desh_print("PDC received (stf start time %llu, handle %d): snr %d, "
           "RSSI-2 %d (RSSI %d), len %u",
           stf, handle, rx_data->pdu_rx_data.snr,
           rx_data->pdu_rx_data.rssi_2, rx_data->pdu_rx_data.rssi,
           rx_data->pdu_len);
```

**After:**
```c
// Extract additional info
uint8_t mcs = rx_data->pdu_rx_data.mcs;
struct dect_phy_mac_client_info *client = 
    get_associated_client_by_short_rd_id(phy_hdr->transmitter_id);
uint8_t assigned_slot = (client) ? client->assigned_slot_start : 0xFF;

// Print enhanced info
desh_print("[RACH-RX] Frame Time: %llu | MCS: %u | Assigned Slot: %u",
           stf, mcs, assigned_slot);
desh_print("From TX ID: %u | SNR: %ddB | RSSI: %ddBm",
           phy_hdr->transmitter_id, rx_data->pdu_rx_data.snr,
           rx_data->pdu_rx_data.rssi);

// Parse MAC header for fragment/seq info
struct dect_phy_mac_pdu_rx *decoded = decode_mac_pdu(...);
if (decoded) {
    desh_print("Fragment ID: %u | Seq#: %u | Data: %s",
               decoded->common_header.reset,
               decoded->common_header.seq_nbr,
               payload_buffer);
}
```

## Benefits of Enhanced Output

1. **Clearer logging**: Easier to understand RACH RX events
2. **Slot tracking**: Visibility into TDMA slot allocation
3. **MCS visibility**: See actual MCS for each reception
4. **Frame time**: Precise timing information
5. **UI parsing**: Easier to parse structured output in the Electron UI

## Integration with UI

Once modified, the UI can parse these lines more easily:

```javascript
// In renderer.js
if (line.includes('[RACH-RX]')) {
    // Extract frame time, MCS, slot, etc.
    // Could display in a table format
    parseRachRxLine(line);
}
```

## Testing the Changes

1. Modify the C files as described
2. Rebuild: `west build -p always`
3. Flash to devices
4. Run test scenario with UI
5. Verify enhanced output appears

## Rollback

If you want to revert to original output, simply comment out the new print statements and uncomment the old ones.

## Performance Considerations

- The enhanced print statements are minimal overhead
- Each reception adds 2-3 extra print lines
- Should have minimal impact on real-time performance

## Debugging Tips

If you implement this:
1. Add timestamps: `desh_print("[%llu] [RACH-RX]...", k_uptime_get())`
2. Add device identifiers: `[DEVICE_ID] [RACH-RX]...`
3. Add metrics: Success rate, MCS distribution

## Next Steps

Would you like me to:
1. **Implement these changes** in the C files?
2. **Create modified versions** of `dect_phy_mac.c` and related files?
3. **Update the UI** to parse and display this enhanced output in a table?
4. **Leave as-is** and use current output format?

Let me know your preference!
