# Sentinel 1.4.8 — website-only reports

Reports are generated and downloaded only through the cloud website. Desktop report buttons, IPC handlers, API client download method and local report writer have been removed. The server rejects the legacy desktop report endpoint even with a valid API token, so old app versions cannot bypass the new rule.

Opening Report studio requires the currently signed-in Sentinel account password. Successful confirmation grants a 15-minute report workflow; reopening Report studio asks again and revokes the previous grant. Preview, report PDF and individual weighment PDF URLs check the same grant. Grants are bound to the user and password hash; wrong-password attempts are rate limited. Passwords are not embedded in the app or report page.

Verification: 72 desktop tests passed; web API/report/access tests passed 184 assertions, with local missing-.env warnings. Packaged 1.4.8 was checked for absence of desktop report functionality. Live browser-session HTTP tests passed for protected report entry/direct URLs, wrong and correct passwords, inward preview, PDF attachment download, and reentry. Deployed source/view/route contents matched local files. The authenticated legacy-API denial is covered by a local integration test; a separate live test using the saved desktop token could not run because that saved token could not be decrypted. No new API token was issued and no production records were changed during verification.

Published on sentinel.puniterp.com on 2026-11-13. The login-page download link and full public installer download were verified: HTTP 200, 130604498 bytes, matching SHA-256.

Installer SHA-256: `4098e8a6ac12ff07f2abcccefb6ec0158f3f197964b2dd1e030b6073aaa8e651`.

Install 1.4.8 to remove old report buttons. Server protection also applies to older installed apps. Standard capture, camera/scale locking and the remaining one-second commissioning requirements are unchanged.
