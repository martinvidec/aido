# Ist-Analyse: Web-Login per Device-Flow (Zweitgerät-Anmeldung)

## 1. Aktueller Zustand

Die Web-UI authentifiziert sich ausschließlich über **Firebase Auth (Google)** im
Browser. `AuthProvider` (`src/lib/contexts/AuthContext.tsx`) hört auf
`onAuthStateChanged`, legt lazy `users/{uid}` an, upsertet `publicProfiles/{uid}`
und migriert Legacy-Todos. `(protected)/layout.tsx` leitet Unangemeldete per
Client-Redirect um; der eigentliche Schutz sind die Firestore-Rules. Der Login
selbst läuft über `signInWithGoogle` (Client-SDK) — am Arbeitsrechner also direkt
durch den Proxy.

Es existiert **kein** Weg, eine Firebase-Web-Session ohne diesen direkten
Google-Login zu etablieren. Server-seitig ist das Admin SDK vorhanden und wird
bereits genutzt (`verifyIdToken` im OAuth-Confirm), aber `createCustomToken` wird
nirgends verwendet, und `signInWithCustomToken` wird clientseitig nicht genutzt.

Verwandt: Epic #175 (OAuth-Device-Grant) führt einen Device-Flow ein, dessen
Ergebnis jedoch ein OAuth-JWT für MCP ist — keine Web-Session.

## 2. Relevante Dateien und Komponenten

| Datei/Komponente | Beschreibung | Relevanz |
|---|---|---|
| `src/lib/firebase/admin.ts` | Admin-SDK-Init; `getAdminAuth()` (nullbar ohne Service-Account → 503) | **Zentral**: `createCustomToken(uid)` + `verifyIdToken` |
| `src/lib/firebase/firebase.ts` | Client-SDK (`auth`, `db`) | **Zentral**: `signInWithCustomToken(auth, token)` |
| `src/lib/contexts/AuthContext.tsx` / `useAuth` | Auth-State, `signInWithGoogle`, lazy User-/Profil-Anlage | Wiederverwendet (Session-Folgeprozesse greifen automatisch); ggf. Helper für Custom-Token-Login |
| `src/app/login/*` | Login-Seite (Google-Button) | Erweitern: Panel „Anmelden über Zweitgerät" |
| `src/app/oauth/authorize/ConsentForm.tsx` | Consent-Muster: Firebase-Login + ID-Token an Confirm-Endpoint posten; Design-Tokens | Vorbild/Muster für die `/device`-Consent-Seite |
| `src/app/api/oauth/authorize/confirm/route.ts` | `verifyIdToken(idToken) → uid`, Client/redirect-Validierung | Vorbild für den Device-Confirm-Endpoint (gleiche ID-Token-Verifikation) |
| `src/lib/apiKeys.ts` | `rateLimit(key, {max, windowMs})` | Wiederverwendet für Start-/Confirm-/Poll-Endpoints |
| `firestore.rules` | OAuth-Collections `allow read, write: if false` | Muster: `deviceLoginCodes` ebenso sperren |
| `src/lib/oauth/store.ts` | Admin-SDK-Store mit single-use-Codes (Transaktion), gehashten Tokens | **Vorbild** für den Device-Login-Store (sha256-Doc-ID, atomarer Konsum) |
| `tests/mcp-tools.test.mts` / `tests/firestore-rules.test.mjs` | Emulator-Tests (tsx bzw. node) | Vorbild für die neuen Tests |

## 3. Bestehende Abhängigkeiten

- **Intern:** Web-UI → Firebase-Client (`auth`); neue Endpoints → Admin SDK
  (`getAdminAuth`); Confirm → `verifyIdToken`; Poll → `createCustomToken`;
  Folge-State (User-/Profil-Anlage) → `AuthProvider`.
- **Extern:** `firebase` (Client-SDK: `signInWithCustomToken`), `firebase-admin`
  (`verifyIdToken`, `createCustomToken`, Firestore-Store), ggf. QR-Lib für die
  Code-Anzeige.
- **Konfiguration:** `FIREBASE_SERVICE_ACCOUNT_KEY` (Admin SDK; ohne ihn 503;
  `createCustomToken` braucht den Service-Account). `NEXT_PUBLIC_FIREBASE_*` für
  den Client.

## 4. Bekannte Einschränkungen

- **`createCustomToken` braucht den Service-Account** (privater Schlüssel zum
  Signieren). Fehlt `FIREBASE_SERVICE_ACCOUNT_KEY`, muss der Poll-Endpoint sauber
  503/`server_error` liefern (wie die OAuth-Routen).
- **Custom-Token-Gültigkeit ist fix ~1 h** (Firebase) und nicht verkürzbar; das
  Token ist bis dahin mehrfach einlösbar. Begrenzung erfolgt über kurze
  `device_code`-TTL, Single-use-Konsum des Codes und sofortigen Exchange.
- **Firebase-Sessions sind nicht DPoP-fähig** — anders als der MCP-OAuth-Pfad
  (#175/#174) gibt es hier keine sender-constrained-Option.
- **Serverless-Persistenz:** der Device-Login-State muss in Firestore liegen, damit
  Polling über mehrere Instanzen funktioniert (in-memory reicht nicht).
- **Rate-Limiting** ist in-memory pro Instanz; Polling wird primär über
  `interval`/`slow_down`/`expires_in` gedrosselt.

## 5. Risiken bei Änderung

- **Session-Bootstrap ist sicherheitskritisch:** ein fehlerhafter Poll-/Confirm-
  Pfad könnte Custom Tokens an Unbefugte ausgeben. `verifyIdToken` (Confirm) und
  Single-use-Konsum (Poll) müssen strikt greifen.
- **Custom-Token-Residual:** der Proxy sieht das Token; akzeptiert, aber
  Härtung (kurze TTL, Revoke-Tooling) einplanen.
- **Brute-Force auf `user_code`:** kurze TTL + ausreichende Entropie +
  Eingabe-Rate-Limit auf Confirm/`/device` nötig.
- **`firestore.rules`:** neue Collection muss gesperrt werden — Regel **und** Test
  gemeinsam (CLAUDE.md-Vorgabe), sonst wäre der State clientseitig lesbar.
- **Login-UI-Änderung:** der bestehende Google-Login darf unverändert
  funktionieren; das Device-Panel kommt additiv hinzu.
- **AuthProvider-Folgeprozesse:** nach `signInWithCustomToken` müssen User-/
  Profil-Anlage und Migration genauso laufen wie nach Google-Login (sie hängen an
  `onAuthStateChanged`, also automatisch — verifizieren).
