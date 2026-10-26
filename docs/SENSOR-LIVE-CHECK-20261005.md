# Live sensor check, 2026-10-05

User reports an empty scale with large noise and RFID no longer reading after earlier success.

A 12-second serial ping-only probe opened /dev/ttyUSB0 and received matching acknowledgements from almufti-diag-1.2.1. Initial buffered fragments were not used as evidence. Late live telemetry showed:

- Loadcell raw samples -560153, -229617, -7882412 and -2724738; rolling raw spread reached 16262955 ADC counts. Stability was false. Factor and offset remained zero: these readings are ADC counts, not calibrated grams.
- RFID version included 146 (0x92) and 0, antenna-on readback was false, stage health, and recovery reason SPI version invalid. No live UID was present in these frames.
- Motor moving false, continuous motion zero.

No upload, tare, calibration, relay or motor command was issued. Serial port was closed. These observations establish unstable acquisition/register communication but do not establish the exact defective connection or component. Await user clarification about the earlier successful RFID test, intervening changes and TB6600 power state before the physical comparison.

User clarified that a separate Arduino sketch read the card successfully, wiring was unchanged, and TB6600 supply is off. Follow-up software isolation ran all/3us, loadcell/3us, loadcell/10us, RFID/3us for about 12 seconds per window. Loadcell-only raw samples remained erratic (summary after initial samples: -8105904 to -1 at 3us, -6435017 to -1 at 10us). RFID-only produced no UID. This isolation disables polling, not physical sensor power. Mode all/3us was restored and the port closed. Full telemetry is in sensor-isolation-followup-20261005.json. Requested the exact successful sketch to establish a controlled firmware comparison; no cause or repair is yet verified.

User supplied the full standalone sketch. Saved as firmware/arduino/rfid_user_test/rfid_user_test.ino with comments/formatting shortened and the same executable logic and messages. MFRC522 is 1.4.12 in both project and ~/Arduino libraries. Compiled with ESP32 core 2.0.17, default SPI clock, 273065 bytes flash and 21504 bytes RAM. Upload verified on ESP MAC b4:bf:e9:6a:50:cc. First 20-second window produced repeated UID failures. Initial buffered fragments/duplicates under 1 second were excluded. User confirmed lifting/replacing the card after the first window; because app restoration had already started, the standalone sketch was uploaded again. Fresh 12-second window after confirmation contained eleven UID failures at ms 1095 through 12021, no successful UID. Ping-only probe sends JSON lines which this sketch ignores; absence of JSON ACK is expected. No tare/calibration commands or preference changes occurred. App firmware restoration follows the comparison. Current failure reproduces outside app firmware, but past success and exact physical cause remain unresolved; next comparison requires complete sensor power cycle.
