# Device and turnstile integration

Atlas uses a vendor-neutral inbound adapter. Face and fingerprint templates stay on the terminal; Atlas stores only the vendor user identifier and its employee mapping.

1. In **Settings → Clock devices**, register the terminal and copy the one-time API key.
2. Link each employee to the user ID configured on that terminal.
3. Configure the terminal or its local bridge to send `POST /api/device/events` with `X-Device-Serial` and `X-Device-Key` headers.

```json
{
  "eventId": "vendor-event-unique-id",
  "externalUserId": "terminal-user-42",
  "eventType": "ENTRY",
  "occurredAt": "2026-09-07T08:55:00.000Z",
  "confidence": 0.99,
  "livenessPassed": true,
  "metadata": { "door": "main" }
}
```

`eventType` is `ENTRY`, `EXIT`, `ACCESS_GRANTED`, or `ACCESS_DENIED`. Face matches require `livenessPassed: true` before a punch is created. Repeated `eventId` values are idempotent. `ENTRY` and `EXIT` create kiosk or turnstile punches when an identity is linked; every raw event remains in the access audit trail.

For devices that cannot call HTTPS webhooks directly, run a vendor bridge on the site network that reads the manufacturer SDK and posts this contract. Use TLS at the reverse proxy and store the API key in the device secret store.

## Employee mobile attendance verification

Employee self-punches are accepted only from the Flutter mobile client and require a
fresh front-camera JPEG, precise GPS coordinates, and the installation identity that
was bound during mobile login. The API allows one active device per employee account
and prevents the same installation from being shared by multiple accounts. A manager
can review the protected selfie and deliberately reset the binding when an employee
replaces a phone. The raw installation identity is hashed before database storage.

This workflow records verification evidence; it does not itself perform face matching,
liveness scoring, or hardware-backed device attestation. Those stronger checks should
be integrated before using the workflow as proof of biometric identity in a hostile
device environment.

## Scheduled live location

A manager can enable live location while assigning or editing an individual shift.
The employee app displays a visible tracking banner and sends a high-accuracy update
approximately every 30 seconds or after 20 metres of movement. Android uses a visible
foreground-service notification for background operation; iOS displays its background
location indicator when the required system permission is granted.

On Android, scheduled tracking requires the system Location permission to be set to
**Allow all the time**. Davomat first requests ordinary location access, then shows an
in-app explanation and a button to the Android app-permission screen. Tracking does not
start while the permission remains **Only while using the app**.

`POST /api/me/live-location` rejects updates unless the published shift is currently
active and tracking was enabled for it. It also verifies the bound mobile installation,
capture freshness, and reported accuracy. The manager-only `GET /api/live-locations`
returns active authorized shifts and their latest point. The database stores one latest
point per shift, not an employee route history, and the scheduler removes it after the
shift ends or tracking is disabled.
