/*
 * Copyright (c) 2024 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-5-Clause
 */

#ifndef DECT_PHY_MAC_CLUSTER_BEACON_H
#define DECT_PHY_MAC_CLUSTER_BEACON_H

#include <zephyr/kernel.h>
#include "dect_phy_mac_common.h"
#include "dect_phy_mac_pdu.h"

#define DECT_PHY_MAC_CLUSTER_BEACON_INTERVAL_MS (2000)

#define DECT_PHY_MAC_CLUSTER_BEACON_RA_START_SUBSLOT (12)
#define DECT_PHY_MAC_CLUSTER_BEACON_RA_LENGTH_SLOTS  (18)

/* Validity = full superframe in frames (revert the doubling — it only
 * changes the loop's stopping bound, not how many items MAX_RACH_RX_ITEMS
 * actually lets you create, so doubling it never helped) */
#define DECT_PHY_MAC_CLUSTER_BEACON_RA_VALIDITY \
    (DECT_PHY_MAC_CLUSTER_BEACON_INTERVAL_MS / DECT_RADIO_FRAME_DURATION_MS)   /* = 200 */

/* Repetition must match the client's tdma_tx_iteration_multiplier (4),
 * not an arbitrary RACH-style cadence of 2 */
#define DECT_PHY_MAC_CLUSTER_BEACON_RA_REPETITION (4)
/******************************************************************************/

int dect_phy_mac_cluster_beacon_tx_start(struct dect_phy_mac_beacon_start_params *params);
void dect_phy_mac_cluster_beacon_tx_stop(void);

void dect_phy_mac_cluster_beacon_update(void);

void dect_phy_mac_cluster_beacon_status_print(void);

void dect_phy_mac_ctrl_cluster_beacon_phy_api_direct_rssi_cb(
	const struct nrf_modem_dect_phy_rssi_event *meas_results);

bool dect_phy_mac_cluster_beacon_is_running(void);

uint64_t dect_phy_mac_cluster_beacon_last_tx_frame_time_get(void);

/******************************************************************************/

void dect_phy_mac_cluster_beacon_association_req_handle(
	struct dect_phy_commmon_op_pdc_rcv_params *rcv_params,
	dect_phy_mac_common_header_t *common_header,
	dect_phy_mac_association_req_t *association_req);

/******************************************************************************/

int64_t dect_phy_mac_cluster_beacon_rcv_time_shift_calculate(
	dect_phy_mac_cluster_beacon_period_t interval,
	uint64_t last_rcv_time,
	uint64_t now_rcv_time);

#endif /* DECT_PHY_MAC_CLUSTER_BEACON_H */
