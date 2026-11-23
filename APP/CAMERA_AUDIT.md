# Camera integration review

The front and rear roles share the same HTTP ANPR receiver, with separate IP allowlists and ports. The container role uses authenticated ISAPI snapshots and local OCR; it does not use the front/rear event listener.

## Covered by code and automated checks

- Listener validates the configured source IP, method and path. It accepts the documented TCG multipart XML event shape and bounded JSON/XML metadata, discards incoming images, reports malformed/missing metadata, and rejects multiple or inactive plate events.
- A plate is available for 30 seconds after receipt. Conflicting plate values block capture. Open listener status does not prove the camera is connected.
- Container OCR requires two matching ISO 6346 codes with valid check digits. A blank, changed or ambiguous later view clears the live reading; ambiguous or conflicting codes block capture. Camera errors clear the reading. Snapshot receipt timing does not prove image exposure time.
- Container startup cancellation and reconnect use a generation guard. Passwords are held in memory and images are not deliberately saved or sent to the cloud.
- Capture requires a current stable serial weight, all three recent roles and operator confirmation. It does not implement or claim one-second synchronization.

## Required on-site checks and known limits

- Verify all IPs, subnet/routing, stable addresses, firewall profiles, ports, path and ANPR event linkage. Obtain a redacted event from each actual camera firmware, including manual and automatic capture, then confirm the status changes and the correct plate appears in the correct field. An open listener and a plate shown in the camera web interface do not demonstrate delivery to Sentinel.
- Confirm camera event upload format, image ordering, acknowledgement and authentication mode with the installed firmware. Source IP filtering is not cryptographic authentication. Use a trusted isolated LAN and avoid exposing these listeners to the Internet.
- Test the actual container camera snapshot endpoint and credentials, bundled OCR resources, focus, code size, positioning, lighting, partial/blocked markings and realistic container numbers. ISO check digits and repeated OCR do not guarantee a correct result.
- Receipt times are not exposure times; late/replayed events and two vehicles in view cannot be ruled out. Keep only one truck in the capture area and have the operator verify every identifier. An event replay within the freshness window cannot be reliably identified without verified device timestamps/IDs or a verified trigger workflow.
- Test camera disconnect, reboot, changed addresses, dropped packets, long response delays, access restrictions and reconnect. Verify gross save is blocked when any camera is unavailable, invalid or conflicting, and that the scale and data match the actual truck. Retest all three roles and end-to-end capture at the client site.

## v1.5.7 client handoff

Priorities reflect observations on this installation. Several causes can coexist.

| Priority | Cause and evidence | v1.5.7 handling and client check |
|---|---|---|
| 1 | Conflicting plate recognition. The installed app displayed “Multiple plates detected”; the same parked motorcycle produced MC494S and MC494C in Hikvision. | The app displays the competing readings and requires agreement before recovering by direct capture. Compare the characters with the physical plate. If Hikvision still changes characters, check focus, exposure, plate size, view angle and regional recognition settings with the installer. |
| 2 | Gross Capture required the scale and all three identifiers even during a one-camera test. This was reproduced in the previous code. | With one active front or rear listener, open Gross Weighment and press Capture number plate. The corresponding locked field should fill. Weight stays empty and Save Gross stays disabled. Repeat with the other camera when available. |
| 3 | Plate upload missing, delayed, or containing status-only or unsupported metadata. Sentinel previously reported an unsupported event. No passive trace matched the exact body to the failing capture. | Check the timestamped receiver status. The app accepts supported XML/JSON and multipart variations, and can request a fresh plate using the camera login. Direct capture depends on firmware support. With no push and no direct response, trace the camera IP and TCP port 8031 or 8032 during one capture. Check POST path, response and plate text. |
| 4 | Reading expired, repeated, or carried over from an earlier weighment. | Expired readings remain diagnostic only. Identified duplicates and out-of-order timestamped notifications are filtered. Uploads already in progress during a cycle reset cannot fill the next cycle. Old events without identifiers or reliable timestamps require on-site checks. |
| 5 | Connection, routing or firmware mismatch. Previously the front camera reached Sentinel, so a persistent total network failure ranks lower. | Verify the listener is active, the source IP matches its role, the destination is the PC on the correct adapter and the push port/path are correct. For direct reads verify the camera HTTP port, login and firmware support. |

Test one parked vehicle first. Then test two successive vehicles to confirm that the second cannot inherit the first plate. Before handing over for real weighing, test all three cameras with the RS-232 indicator through capture and save. A successful single-camera test verifies the plate path only.
