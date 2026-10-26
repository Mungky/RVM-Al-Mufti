# RFID reference revision — 2026-10-05

Diagnostic firmware 1.2.1 aligns the RC522 configuration with the standalone sketch provided by the user:

- MFRC522 instance uses SS 5 and RST 17.
- Reset 50 ms, init 100 ms, antenna on, RxGain_avg, settling 100 ms.
- SPI restored to the library's standard 4 MHz; the manual editor compiler uses the same flag.
- Each poll restores TxMode/RxMode/ModWidth as PICC_IsNewCardPresent does, then sends RequestA. On timeout, WakeupA checks a previously halted card to retain live presence.
- UID selection, HaltA, live disappearance timeout and error telemetry remain. This differs intentionally from the standalone sketch's read-once/one-second delay because the app needs live removal and card replacement.

This is a software revision based on a reference sketch, not a claim of physical RFID success. Firmware source, binaries and automatic-install manifest must be updated together. The previous package and firmware are retained in backups/rfid-reference-20261005.

User clarification: loadcell has NOT been tested with a basic Arduino sketch after supply repair. No changes to raw ADC acquisition, tare, or calibration are made in this revision. A new raw-data measurement is required before attributing the problem to calibration, firmware, or hardware.

User identifies the stepper driver as TB6600, ENA unwired, with vibration present before app launch and before programming. The initial symptom is therefore not caused by an app-issued motion command. Firmware starts with STEP low and timer disabled; Stop ends pulses, not driver holding current. No automatic motion to 3200 or guessed ENA polarity/wiring was added. Driver wiring, current setting and exact module need physical checking.

The ESP USB serial port was absent during preparation; no upload, motor movement, zero or calibration was performed.

## Live check after user reported ready

Host sandbox hides the USB device node even while `/sys/class/tty/ttyUSB0` exists. Running the serial probe with device access opened `/dev/ttyUSB0`; previous absence reports therefore do not establish physical USB disconnection.

Live ping confirms 1.2.1. No UID was read. Four isolation windows (~12 s each) are recorded in sensor-reference-isolation-20261005.json. HX sample counter increased 95→100 in combined mode, 100→101 with HX-only 3 µs timing, 102→111 with HX-only 10 µs timing. Observed raw values include -1, -5, -129 and -4194305. RC522 version fluctuated among 0/0x92 and other invalid values; the antenna-on register check frequently failed even in RFID-only mode. Motor telemetry remained stopped; factor and offset both remained zero.

The sampler restored mode=all and pulseUs=3 and closed the serial port. No tare, calibration, actuator motion or upload was performed. An isolated RFID reference sketch has been prepared, but physical comparison requires continued user coordination, including motor-driver supply isolation and actual sensor supply measurements. These observations do not prove which component or connection is faulty.

## Standalone physical comparison

User confirmed TB6600 supply switched off and subsequently reported 3.3 V at the sensor supply measurement request. With driver off, combined firmware still gave variable RC522 version and erratic/infrequent HX samples. ESP MAC during upload is b4:bf:e9:6a:50:cc (different from earlier 70:4b:ca:69:42:00).

Uploaded sensor-only `firmware/arduino/rfid_reference/rfid_reference.ino` using standard MFRC522 SPI clock. It follows user reset/init/gain and RequestA/ReadCardSerial/HaltA sequence, holds STEP/DIR low, and does not access calibration. Three live windows yielded no UID; after the user confirmed lifting/replacing the card, ten fresh UID-failure messages occurred and chip-version reports included 0x00, 0x39, 0x92. Initial buffered serial data (<1 s) is excluded from summaries. See rfid-standalone-results-20261005.json.

Restored compiled app firmware 1.2.1 via Arduino CLI successfully; flash hashes verified. This comparison reproduces failure outside the app polling implementation, but does not identify the exact electrical cause. Need physical verification of common ground, pin continuity and sensor connections before further software/calibration changes.
