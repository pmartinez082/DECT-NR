# Thingy Config

## Overview
This README explains how to prepare and run the TDMA Thingy setup. The master device runs the TDMA application while slave devices run the TDMA Thingy firmware.

## Prerequisites
- DECT modem firmware must be installed on all Thingy devices.
- Follow the installation guide:
  https://nrfconnectdocs.nordicsemi.com/ncs/3.1.0/nrf/app_dev/device_guides/thingy91x/thingy91x_updating_fw_programmer.html

## Flash the slave firmware
Flash the slave devices with the TDMA Thingy application package.

Example command:

```bash
nrfutil device program --firmware dfu_application.zip --serial-number <THINGY91X_ID>
```

Replace `<THINGY91X_ID>` with the actual serial number of the target Thingy device.

## First use
Before using a slave device, assign it a unique TX ID:

```bash
dect sett -t uniqueId
```

This ensures each slave has a unique identifier for the TDMA network.

## Master configuration
The master device must be running the TDMA program, not the TDMA Thingy application.
The master should be connected via UART to view logs and monitor status.

To start a cluster beacon on the master:

```bash
dect mac beacon_start -c 1677
```

The `-c` option selects the beacon channel. Adjust the channel value as needed for your deployment.

## Slave configuration
- Power on each slave device after flashing.
- Ensure each slave has a unique TX ID set with `dect sett -t uniqueId`.
- Slaves should automatically participate once the master beacon is active.

## Notes
- Use UART logs on the master to verify beacon startup and runtime behavior.


