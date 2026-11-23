# Sentinel 1.4.7

Published to sentinel.puniterp.com on 2026-11-13.

## Available workflow

Complete the form, check that the three camera identifiers belong to the only truck on the scale, select the confirmation, press **Capture truck & weight**, then **Save Gross** within 30 seconds. Save uses the main-process snapshot, never weight or identifiers supplied by the form. Missing, stale, conflicting or changed device readings prevent a new save. Weight still comes only from a physical serial connection. Standard mode uses recent camera events and local receipt times; it does not trigger or certify simultaneous physical exposures.

An uncertain save is journaled before sending. **Retry pending save** sends the original request and survives an app restart. It requires the same operator account. A new capture and tare save are blocked while that result is unresolved. Do not delete the journal or create replacement records after a connection failure. An initial definitive validation rejection releases the journal; an uncertain retry remains protected for reconciliation. No camera photos are included in the journal or upload.

The website records standard capture as timing-unverified. Required report fields, the inward report format and locked device fields remain in place. Install 1.4.7 to receive the new desktop workflow; Refresh API data only updates shared data and colours.

## Verified

- 73 Node tests passed, including the actual main-process Capture/Save IPC, renderer clicks, required fields, changed/stale devices, single-use capture and exact retry after a lost response.
- Web API, workflow and inward report tests passed (136 assertions); the later standard-capture record-view test passed 12 assertions. Local PHP tests report missing-.env warnings.
- Packaged OCR recognized the simulated CAIU9720214 image; packaged serial driver loaded (zero physical ports attached); packaged PDF download passed.
- Live sign-in, report preview and attachment PDF download passed. Published PHP/view contents matched the local files. No test weighments were inserted into production.
- Public installer HTTP 200, 130605193 bytes; SHA-256 matched the local installer: `400842b27be19cfc1b19107115ac636c84abb6c5e8e452d0d4963ad93ec0119b`.
- Windows installer is unsigned.

## Still requires client equipment

Verify the actual RS-232 output/settings and units; front/rear event delivery; third-camera OCR and lighting; disconnects, stale/ambiguous recognition and consecutive trucks; gross/tare/report values; and retry during a network interruption. Follow ON_SITE_TEST.md.

Strict one-second capture remains disabled. Its prototype camera adapters and transaction modules still need firmware-specific integration, authenticated trigger-to-event/image matching, known exposure and scale-measurement timing with uncertainty, durable device-event replay protection, and measured on-site worst-case bounds of at most 1000 ms. Simulation timestamps are not physical evidence. Standard mode can be commissioned separately without that timing guarantee.
