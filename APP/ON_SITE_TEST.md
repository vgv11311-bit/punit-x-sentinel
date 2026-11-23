# Sentinel: client-site commissioning checklist

Release 1.4.8 provides Standard capture: confirm the only truck, press Capture truck & weight, then Save Gross within 30 seconds. The fields are frozen at Capture; device changes invalidate an unsaved snapshot. It uses recent events and does not guarantee one-second timing. The strict one-second mode is not enabled. Do not approve the system for production use with the one-second requirement until that workflow has been completed and all timing checks below pass with measured evidence. Run tests on the client's computer with authorized test records.

## Record the equipment

- Record each camera's exact model, serial number, firmware, IP address, channel and role: front plate, rear/trailer plate, or container side. Configure a single controlled truck zone and a clear view for each camera.
- Record the indicator make/model and actual RS-232 protocol, stability flags, units, baud rate, data bits, parity, stop bits, line ending and output mode. The app's defaults must be confirmed with the indicator; preserve the password-protected manual settings.
- Put the computer and cameras on an isolated trusted network. Confirm compatible power and network access, unique IP addresses, and a common time source. Record measured clock offsets and uncertainty, not merely NTP configuration.

## Scale and serial port

1. In Windows Device Manager, identify the adapter's COM port. In Sentinel Configuration, refresh ports, select it, set the indicator's documented parameters and save with the authorized Sentinel account password.
2. Verify a wrong password leaves settings unchanged. Restart Sentinel and confirm saved settings persist for the same Windows user. Connect the scale; a port-open status alone must not be treated as a valid weight.
3. Compare zero and several known stable weights with the indicator, including a realistic truck load if safe. Verify units, decimal places, stable/unstable behavior, refresh rate and positive gross/tare values.
4. Unplug the scale and verify the displayed/captured reading clears and saving is blocked. Reconnect and verify valid readings recover. Test wrong port and wrong serial parameters and confirm no invented weight appears.
5. Obtain indicator samples and independently measure or bound the delay between physical measurement and the timestamp made available to the application. PC receipt time alone is not proof of measurement time.

## Cameras and recognition

1. Configure the front and rear HTTP event destinations to the client PC and their distinct listener ports, and start both listeners. Set the third camera's IP, HTTP port and credentials and start local OCR. Confirm network firewall access and each camera's view; a listener-open status alone is not proof of a camera event.
2. With one truck in the zone, verify the front camera reads its front plate, the rear camera reads the different rear/trailer plate, and the container camera reads the correct ISO 6346 number. Compare every value to the actual vehicle; all three app fields must be read-only.
3. Verify an obscured, unreadable, incorrect or multiple plate/container view does not silently use another truck's value. Test camera disconnection, reconnect, network delay, restart, no-plate container view and repeated events. Confirm no camera image is saved or uploaded.
4. For each actual firmware, record a redacted raw triggered event, its UUID and timestamp, the matching image metadata and image-delivery behavior, including with no plate visible. Check the container image clearly contains the complete code. Never share passwords.

## Gross, tare and report

1. With authorized test data, verify each required inward-cargo field must be completed, device fields cannot be edited, and missing or disconnected device inputs block the intended operation. Compare gross and tare with the physical indicator; verify the correct vehicle, net weight and record on the website.
2. On the cloud website, open Completed Records and check only completed gross/tare entries appear. Search a known plate and download its inward-cargo report. Compare field order, values and gold logo with the reference. Verify direct PDF requests are blocked before password confirmation and wrong passwords are rejected. Navigate away and back to Report studio: the same tab stays unlocked without a 15-minute report timeout and shows Last report login. Close and reopen, then reload the tab: each must require password confirmation. A separate new tab must also require confirmation. Confirm the browser saves to its configured Downloads folder. Verify no report download buttons are present in desktop 1.4.8 and older desktop report requests fail.
3. Interrupt the network during Save, then restart the app. Use Retry pending save; verify exactly one record with the original readings. A new Capture must be blocked until the pending save is resolved. Verify Capture without a confirmation, changed plates, changed weight, stale data and elapsed 30 seconds all block saving.
4. Repeat across app restart, a network interruption and a second truck. Check that stale or conflicting camera readings and scale readings are not reused. Record failures with timestamps without exposing credentials.

## One-second capture acceptance (after integration)

- With only one positioned truck, have the operator press Capture. Use an independent calibrated timing reference or a documented shared hardware trigger and synchronized clocks to measure the weight acquisition and each camera exposure—not receipt time or OCR completion.
- Record raw event identifiers, image-to-event association, timestamp resolution, measured clock errors, serial measurement delay and uncertainty. Each camera's worst-case absolute exposure-to-weight difference, including uncertainty, must be at most 1,000 ms. If timing cannot be established, the capture must fail rather than claim success.
- Repeat for many loads and lighting conditions and test delayed, duplicate, missing, stale or unrelated events; a changed or unstable scale; camera and network failure; and two vehicles in view. Confirm the whole capture is rejected whenever identity or the timing bound cannot be established.
- Verify accepted weight and all three results are from the same capture session and that reports and saved records preserve the required audit evidence. Review every failed case before approving operational use.
