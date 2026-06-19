# Konzept: OAuth 2.0 Device Authorization Grant (RFC 8628)

## 1. Zusammenfassung

aido soll den **OAuth 2.0 Device Authorization Grant** (RFC 8628) als zusätzlichen
Grant-Type seines bestehenden Authorization Servers anbieten. Damit kann sich ein
Client auf einem Gerät, das keine sichere Browser-Anmeldung durchführen soll
(z.B. ein Arbeitsrechner hinter einem TLS-aufbrechenden Firmenproxy oder ein
headless CLI), authentifizieren, indem **Login und Consent auf einem zweiten,
vertrauenswürdigen Gerät** (Handy über Mobilfunk) erfolgen. Der ursprüngliche
Client pollt nur den Token-Endpoint und erhält am Ende ein aido-Access-Token.

## 2. Problemstellung

Aido wird teils aus Umgebungen genutzt, in denen ein Unternehmensproxy mit
eigenem Root-Zertifikat sämtlichen TLS-Verkehr als Man-in-the-Middle mitlesen
kann. Dass der Proxy die **aido-Daten** mitliest, ist für den Nutzer akzeptabel.
Nicht akzeptabel ist jedoch, die **Google-Anmeldung** (Firebase Auth) über diesen
Kanal laufen zu lassen, weil dabei das Google-Passwort bzw. die Google-Session
für den Proxy sichtbar würden — ein ungleich höherwertiges Geheimnis als eine
einzelne aido-Session.

Die heute vorhandenen Anmeldewege decken diesen Fall nicht sauber ab:

- **Web-UI**: erfordert eine clientseitige Firebase-Session → Google-Login im
  Arbeitsbrowser → Proxy sieht das Google-Credential.
- **Personal API Key** (MCP): löst den Fall zwar (Key wird auf einem Trusted
  Device erzeugt), ist aber ein langlebiges Bearer-Secret, das manuell kopiert
  werden muss, keine Rotation kennt und außerhalb des OAuth-Standards liegt.

Es fehlt ein **standardkonformer, entkoppelter Anmeldeweg**, bei dem das
Google-Credential den unsicheren Kanal nie berührt.

## 3. Zielsetzung

- Ein Client auf einem unsicheren/eingeschränkten Gerät kann ein aido-OAuth-
  Access-Token erhalten, **ohne dass das Google-Credential den Proxy passiert**
  (Login + Consent ausschließlich auf dem Zweitgerät).
- Vollständig RFC-8628-konform (Device Authorization Endpoint, `user_code`/
  `device_code`, Polling am Token-Endpoint mit `authorization_pending`/
  `slow_down`/`access_denied`/`expired_token`).
- **Maximale Wiederverwendung** des bestehenden OAuth-Servers: gleiche
  Token-Ausstellung (JWT + Refresh-Rotation), gleiche Consent-UI, gleicher
  Admin-SDK-Store, gleiche `firestore.rules`-Disziplin.
- Resultierende Tokens sind **aido-scoped, kurzlebig und widerrufbar** (gleiches
  Sicherheitsprofil wie der Authorization-Code-Flow).
- Optionaler Andockpunkt für **DPoP / sender-constrained Tokens** als spätere
  Härtung (nicht Teil des Kerns).

Messbar erreicht, wenn: ein CLI-/Device-Client am Arbeitsrechner per
`device_code`-Grant ein gültiges MCP-Token erhält, während der Firmenproxy
zu keinem Zeitpunkt das Google-Credential zu sehen bekommt.

## 4. Lösungsidee

Erweiterung des vorhandenen Authorization Servers um den Device-Flow:

1. **Device Authorization Endpoint** (`POST /api/oauth/device_authorization`):
   nimmt `client_id` (+ `scope`), erzeugt ein `device_code` (opak, lang) und ein
   `user_code` (kurz, menschenlesbar), legt beide mit Status `pending` im
   Admin-SDK-Store ab und liefert zusätzlich `verification_uri`,
   `verification_uri_complete`, `expires_in`, `interval`.
2. **Verifikationsseite** (`/device`): der Nutzer öffnet sie auf dem Zweitgerät
   (Mobilfunk), meldet sich mit dem bestehenden Firebase-Google-Login an, gibt den
   `user_code` ein und bestätigt im Consent. Auf „Erlauben" wird das `device_code`
   serverseitig auf `approved` + `uid` gesetzt (über einen Confirm-Endpoint, der
   das Firebase-ID-Token wie beim Authorization-Code-Flow verifiziert).
3. **Token-Endpoint** (`POST /api/oauth/token`): neuer Zweig
   `grant_type=urn:ietf:params:oauth:grant-type:device_code`. Pollt der Client,
   wird je nach Status `authorization_pending` / `slow_down` / `access_denied` /
   `expired_token` geantwortet — und nach Approve die **identische**
   `issueTokens`-Ausgabe wie beim Authorization-Code-Flow (Access-JWT +
   rotierender Refresh-Token), `device_code` wird single-use konsumiert.
4. **Discovery/Rules**: `device_authorization_endpoint` + der neue Grant-Type
   werden in der AS-Metadata (RFC 8414) ergänzt; die neue Collection
   `oauthDeviceCodes` wird in `firestore.rules` wie die anderen OAuth-Collections
   komplett gesperrt (`allow read, write: if false`).

Der Login auf dem Zweitgerät (Mobilfunk) hält das Google-Credential vom Proxy
fern; der unsichere Client sieht nur das finale, scoped Token.

## 5. Betroffene Komponenten

| Bereich | Datei(en) | Art der Betroffenheit |
|---|---|---|
| OAuth-Config | `src/lib/oauth/config.ts` | Erweitern: `oauthDeviceCodes`-Collection, Device-TTL, Poll-`interval`, `user_code`-Format |
| OAuth-Store | `src/lib/oauth/store.ts` | Neu: `createDeviceCode`, Lookup per `user_code`, `approveDeviceCode`/`denyDeviceCode`, `pollDeviceCode`/`consumeDeviceCode` |
| Device-Auth-Endpoint | `src/app/api/oauth/device_authorization/route.ts` (neu) | Neu: RFC 8628 §3.1/§3.2 |
| Token-Endpoint | `src/app/api/oauth/token/route.ts` | Erweitern: `device_code`-Grant-Zweig inkl. Polling-Fehlercodes |
| Verifikationsseite | `src/app/device/page.tsx` + Form-Komponente (neu) | Neu: `user_code`-Eingabe, Consent (Wiederverwendung der `ConsentForm`-Logik) |
| Device-Confirm-Endpoint | `src/app/api/oauth/device/confirm/route.ts` (neu) | Neu: ID-Token → uid, `approveDeviceCode` |
| AS-Metadata | `src/app/.well-known/oauth-authorization-server/route.ts` | Erweitern: `device_authorization_endpoint`, Grant-Type ergänzen |
| Firestore-Rules | `firestore.rules` | Neu: `oauthDeviceCodes` sperren |
| Tests | `tests/` | Neu: Device-Flow-Pfade (Happy Path, Polling-Zustände, Expiry, Replay) |

Unverändert wiederverwendet: `src/lib/oauth/tokens.ts` (Token-Signatur),
`issueTokens` im Token-Endpoint, die Firebase-ID-Token-Verifikation aus
`authorize/confirm`, `src/lib/mcp/auth.ts` (akzeptiert das resultierende
OAuth-Token bereits).

## 6. Abgrenzung

Nicht Teil dieser Anforderung:

- **Web-UI-Login am Arbeitsrechner.** Der Device Grant liefert ein OAuth-Token
  für den **MCP-Resource-Server** (`/api/mcp/sse`), keine clientseitige
  Firebase-Session. Eine Anmeldung in der Web-UI ohne Google-über-Proxy wäre ein
  separates Thema (Firebase-Custom-Token-Handoff) und ist hier ausdrücklich
  ausgeklammert.
- **DPoP / sender-constrained Tokens.** Nur als optionaler, klar getrennter
  Folge-Schritt vorgesehen (schützt die Session zusätzlich gegen einen aktiven
  MITM). Der Kern stellt weiterhin reine Bearer-Tokens aus.
- **Neue Scopes / Berechtigungsmodell.** Es bleibt beim einzigen Scope
  `aido.tools`.
- **Ablösung** des Personal-API-Key- oder Authorization-Code-Flows. Der Device
  Grant kommt additiv hinzu.

## 7. Offene Fragen

1. **Client-Registrierung für Device-Clients.** Die DCR (`/api/oauth/register`)
   verlangt aktuell eine nicht-leere `redirect_uris`-Liste. Device-Clients haben
   keine Redirect-URI. Vorschlag (Default-Annahme): `redirect_uris` optional
   machen, wenn `grant_types` den Device-Code-Grant enthält — alternativ ein fest
   konfigurierter First-Party-Public-Client für das aido-CLI. → Bitte bestätigen.
2. **Pfad/`verification_uri`.** Vorschlag: kurzes, top-level `/device` (gut
   tippbar) statt `/oauth/device`. `verification_uri_complete` =
   `/device?user_code=…` (für QR). → ok?
3. **`user_code`-Format.** Vorschlag: 8 Zeichen, gruppiert `WDJB-MJHT`, Alphabet
   ohne mehrdeutige Zeichen (kein `0/O/1/I`). → ok?
4. **Anzeige `user_code` ↔ Bestätigung.** Soll die `/device`-Seite den Client-
   Namen (aus DCR) im Consent anzeigen, damit der Nutzer weiß, welches Gerät er
   freigibt? (Empfohlen ja.)
5. **DPoP jetzt mitdenken oder strikt später?** Annahme: später als eigenes
   Issue; im Store/Token-Pfad nur die Erweiterbarkeit nicht verbauen.
