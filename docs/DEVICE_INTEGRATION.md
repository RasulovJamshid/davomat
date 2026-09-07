# Device and turnstile integration

Atlas uses a vendor-neutral inbound adapter. Face and fingerprint templates stay on the terminal; Atlas stores only the vendor user identifier and its employee mapping.

1. In **Advanced → Devices**, register the terminal and copy the one-time API key.
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
