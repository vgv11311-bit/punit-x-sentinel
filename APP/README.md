# Sentinel Weighbridge Desktop

Sentinel Weighbridge is a Windows desktop implementation of the supplied weighment requirements. It connects to the live Sentinel API, downloads configured fields and weighments, sends supported record updates, and supports live RS-232 weight capture.

## Start the app

1. Install Node.js 20 or newer if it is not already installed.
2. Open PowerShell in this folder.
3. Run `npm install`.
4. Run `npm start`.

At startup, sign in with your Sentinel web credentials. The password is never stored. The returned Bearer token is encrypted with Windows secure storage.

## Scale connection

Configure the physical COM port and matching serial parameters in **Camera & Scale → RS-232 scale**, then connect the scale on a gross or tare screen. Use **Refresh ports** if the adapter was connected after opening settings. The default is 9600 baud, 8 data bits, no parity and 1 stop bit; confirm this against the actual indicator. Opening the port does not prove it is sending valid data. The latest stable positive reading fills the entry automatically; it cannot be edited. Save the entry once the vehicle and reading are correct.

Windows Device Manager → Ports (COM & LPT) identifies the adapter's COM number. The indicator's serial-output menu, manual or supplier must provide the baud rate, data bits, parity, stop bits, line ending, output mode, and example output; the COM number alone cannot identify them. The initial line ending is CR + LF. Choose and save the matching values, then disconnect and reconnect the scale for changed settings to take effect. A port-open/waiting message means no valid reading has yet been received. Verify readings against the indicator, then disconnect the adapter and confirm the app clears the weight.

The parser accepts common line-delimited text readings such as `ST,GS,28460kg`. Stability is estimated from repeated similar values. The real indicator's protocol, units, stability flags, and output samples must be checked before operational use.

## Physical RS-232 scale

Open **Configuration → RS-232 scale**, select the COM port and serial parameters, then save. The parser accepts common text readings containing a numeric value, such as `ST,GS,28460kg`. The real indicator's sample output is still required to finalize model-specific stability flags and framing.

## Live web API

The app uses `https://sentinel.puniterp.com/api/v1` for authentication, fields, settings, weighment lists, record details, Gross creation, and Tare updates. New Gross entries are created with `POST /weighments`; the returned server ID is stored and later used with `PUT /weighments/{id}` for Tare synchronization.

While signed in, the desktop app checks `/fields` every five seconds. New fields and field changes made on the website appear automatically in the Gross form without restarting the app or pressing Refresh.

Reports are available only on the cloud website at https://sentinel.puniterp.com. Open **Completed Records** to search completed entries and download an individual inward-cargo report, or **Report studio** to preview and download filtered reports. Confirm your signed-in account password once per browser tab; there is no separate 15-minute report timeout. Navigation within the website preserves report access. Closing or reloading the tab clears access and requires the password again; Last report login shows the latest confirmation in the current account session. Direct PDF requests are protected too. Desktop report buttons and API downloads are removed/denied, including requests from older apps. The browser uses its configured download location (normally Windows Downloads).

## Commands

- `npm start` — run the desktop app
- `npm test` — run business-rule tests
- `npm run dist` — create a Windows installer in `release/`
- `npm run dist:portable` — create a portable Windows ZIP that avoids installer/Temp DLL errors
- `npm run dist:single-exe` — create one portable Windows EXE with no installation required

## Main files

- `main.js` — desktop lifecycle, persistence, serial communication, and save operations
- `preload.js` — secure renderer bridge
- `src/app.js` — screens and operator workflow
- `src/styles.css` — desktop user interface
- `src/logic.js` — validation, scale parsing, numbering, and net calculation
- `src/api-client.js` — live API authentication, normalization, downloads, and updates

## Hikvision ANPR event listener

Configuration includes separate front and rear listeners for Hikvision DS-TCG406-E HTTP-host ANPR events. Enter a different camera IPv4 address and listener port for each (defaults 8031 and 8032), then start each listener. Configure each camera's HTTP host to send events to the laptop's LAN IP address and `/anpr` on its assigned port. Configure the cameras' detection areas and video triggers. Windows may need firewall rules for incoming camera traffic. Only text metadata is retained; attached pictures are discarded, not uploaded to the Sentinel API.

Each listener accepts only its configured camera IP, but IP filtering is not cryptographic authentication; use an isolated trusted network. A plate expires after 30 seconds, conflicting events within a role block saving, and a consumed cycle clears when the scale returns to stable zero. Tare requires a recent matching front plate and live stable scale reading. Gross also requires a rear plate and a container number. To configure the third camera, enter its IPv4 address, HTTP port and camera credentials under Container number camera, and start local OCR. The app requests JPEG snapshots from its ISAPI channel, processes the images in memory with Tesseract, and accepts an ISO 6346 code only after matching readings in two frames and a valid check digit. Images are not stored or uploaded; camera credentials remain in memory until the reader stops or the app exits. Camera HTTP can expose credentials or imagery to other devices on the network, so use an isolated trusted network. The camera firmware, snapshot endpoint, image quality, timing, scale protocol and physical lane arrangement must be verified with actual devices before operational use.

## Website palette and desktop releases

The serial reader accepts XK3190-DS3 continuous frames with start/end markers, six weight digits, decimal position and XOR checksum. The observed frame containing `+00150001F` represents 1,500 kg; the final characters encode decimal position and checksum, not weight digits. The indicator sends displayed gross or net weight without a stability or overload flag. The app estimates stability from repeated readings and cannot confirm indicator mode or overload. Verify zero, several known stable loads, decimal settings, movement, overload and disconnection against the actual indicator before operational use.

The desktop app reads the background, surface, and accent colors from `https://sentinel.puniterp.com/desktop-theme.json` at startup, every minute, and when refreshing the API. It accepts only six-digit hex colors and keeps the built-in palette when offline. The website reads the same file. The file changes colors, not application code or screen layout. Desktop feature and layout changes require a new Windows release and installation.
