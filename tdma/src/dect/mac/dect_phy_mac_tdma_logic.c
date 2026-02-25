#include <zephyr/sys/byteorder.h>

#include <zephyr/kernel.h>
#include <zephyr/init.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

#include "desh_print.h"

#include "dect_common.h"
#include "dect_phy_common.h"
#include "dect_common_utils.h"
#include "dect_common_settings.h"

#include "dect_phy_api_scheduler.h"
#include "dect_phy_ctrl.h"
#include "dect_phy_scan.h"
#include "dect_phy_rx.h"

#include "dect_phy_mac_cluster_beacon.h"

#include "dect_phy_mac_common.h"
#include "dect_phy_mac_pdu.h"
#include "dect_phy_mac_ctrl.h"

#define MAX_SLOTS 256  // number of slots in a beacon frame
#define SLOT_FREE 0
#define SLOT_RESERVED 1

struct dect_phy_mac_slot_map {
    uint8_t slots[MAX_SLOTS]; // 0 = free, 1 = reserved
};


struct dect_phy_mac_slot_map global_slot_map; // assume initialized elsewhere

// Utility: find first contiguous free slots
static int find_free_slots(uint8_t needed_slots) {
    int start = -1;
    int count = 0;

    for (int i = 0; i < MAX_SLOTS; i++) {
        if (global_slot_map.slots[i] == SLOT_FREE) {
            if (start == -1) start = i;
            count++;
            if (count == needed_slots) {
                return start; // found enough contiguous slots
            }
        } else {
            start = -1;
            count = 0;
        }
    }
    return -1; // no free slots found
}

// Assign slots to a client
int dect_phy_mac_assign_slots(struct dect_phy_mac_client_info *client) {
    if (!client || client->num_slots_needed == 0) return -1;

    int slot_start = find_free_slots(client->num_slots_needed);
    if (slot_start < 0) {
        printf("No free slots available for client %u\n", client->client_id);
        return -1;
    }

    // Reserve the slots
    for (int i = 0; i < client->num_slots_needed; i++) {
        global_slot_map.slots[slot_start + i] = SLOT_RESERVED;
    }

    client->assigned_slot_start = slot_start;
    printf("Assigned client %u slots [%d .. %d]\n",
           client->client_id, slot_start, slot_start + client->num_slots_needed - 1);

    // TODO: call PHY scheduler update function here
    // dect_phy_mac_scheduler_update(slot_start, client->num_slots_needed);

    return 0;
}

// Free slots when client disconnects
void dect_phy_mac_free_slots(struct dect_phy_mac_client_info *client) {
    if (!client) return;

    for (int i = 0; i < client->num_slots_needed; i++) {
        global_slot_map.slots[client->assigned_slot_start + i] = SLOT_FREE;
    }

    printf("Freed client %u slots [%d .. %d]\n",
           client->client_id, client->assigned_slot_start,
           client->assigned_slot_start + client->num_slots_needed - 1);
    client->assigned_slot_start = 0xFF;
}