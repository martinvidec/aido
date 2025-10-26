# Security Audit Report - Aido Application
**Datum:** 26. Oktober 2025
**Audit-Typ:** Umfassende Code-Sicherheitsanalyse
**Application:** Aido - Collaborative TODO Management System
**Version:** 0.1.0

---

## Executive Summary

Dieses Security Audit identifiziert mehrere kritische und moderate Sicherheitsschwachstellen in der Aido-Anwendung. Die Anwendung ist eine Full-Stack Next.js-Applikation mit Firebase-Backend, die kollaborative TODO-Verwaltung, Echtzeit-Synchronisierung und KI-Integrationen bietet.

### Risiko-Übersicht

| Schweregrad | Anzahl | Details |
|-------------|---------|---------|
| **KRITISCH** | 1 | API-Key Exposure |
| **HOCH** | 3 | Input-Validierung, Rate Limiting, CSRF |
| **MITTEL** | 5 | Dependencies, Error Handling, XSS-Risiken |
| **NIEDRIG** | 4 | Logging, Code-Qualität |

---

## 1. KRITISCHE SCHWACHSTELLEN

### 1.1 API-Key Exposure über ungesicherten Endpunkt
**Schweregrad:** KRITISCH
**Datei:** `src/app/api/deepgram/route.ts:5-9`
**CWE:** CWE-200 (Information Exposure)

#### Problem
Der Deepgram API-Key wird über einen öffentlich zugänglichen GET-Endpunkt ohne jegliche Authentifizierung exponiert:

```typescript
export async function GET() {
    return NextResponse.json({
      key: process.env.DEEPGRAM_API_KEY ?? "",
    });
}
```

#### Auswirkung
- **Credential Theft:** Jeder Angreifer kann den API-Key ohne Authentifizierung abrufen
- **API Abuse:** Der exponierte Key kann für unbegrenzte Deepgram-API-Anfragen missbraucht werden
- **Financial Loss:** Unberechtigte Nutzung führt zu Kosten auf Ihrem Deepgram-Account
- **Service Disruption:** Quota-Erschöpfung durch Missbrauch

#### Empfehlung (DRINGEND)
1. **Sofortige Maßnahme:** Rotieren Sie den Deepgram API-Key
2. **Authentifizierung hinzufügen:**
```typescript
import { auth } from '@/lib/firebase/firebase';
import { getAuth } from 'firebase-admin/auth';

export async function GET(request: Request) {
    // Verify Firebase Auth token
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.split('Bearer ')[1];
    try {
        await getAuth().verifyIdToken(token);
        return NextResponse.json({
            key: process.env.DEEPGRAM_API_KEY ?? "",
        });
    } catch (error) {
        return NextResponse.json({ error: 'Invalid token' }, { status: 403 });
    }
}
```

3. **Alternative (besser):** Implementieren Sie ein Backend-Proxy-Pattern, bei dem die API-Calls serverseitig durchgeführt werden

---

## 2. HOHE SCHWACHSTELLEN

### 2.1 Fehlende Input-Validierung in API-Endpunkten
**Schweregrad:** HOCH
**Dateien:**
- `src/app/api/replicate/generate-image/route.ts:15`
- `src/lib/firebase/firebaseUtils.ts` (diverse Funktionen)

**CWE:** CWE-20 (Improper Input Validation)

#### Problem
API-Endpunkte validieren Benutzereingaben nicht oder nur unzureichend:

**Beispiel 1 - Image Generation:**
```typescript
const { prompt } = await request.json();
// Keine Validierung von 'prompt' - könnte undefined, zu lang, oder bösartig sein
```

**Beispiel 2 - Contact Request:**
```typescript
export const sendContactRequest = async (targetEmailInput: string) => {
    const targetEmail = targetEmailInput.trim().toLowerCase();
    // Keine Email-Format-Validierung
    // Keine Längen-Überprüfung
}
```

#### Auswirkung
- Injection-Angriffe (NoSQL Injection via Firestore)
- Resource Exhaustion durch übermäßig lange Eingaben
- Fehlerhafte Geschäftslogik durch unerwartete Datentypen

#### Empfehlung
1. **Input-Validierung mit Zod implementieren:**
```typescript
import { z } from 'zod';

const ImageGenerationSchema = z.object({
    prompt: z.string()
        .min(1, "Prompt cannot be empty")
        .max(1000, "Prompt too long")
        .trim()
});

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { prompt } = ImageGenerationSchema.parse(body);
        // ... rest of the code
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json(
                { error: "Invalid input", details: error.errors },
                { status: 400 }
            );
        }
    }
}
```

2. **Email-Validierung:**
```typescript
const emailSchema = z.string().email().max(254);
```

### 2.2 Fehlende Rate Limiting
**Schweregrad:** HOCH
**Betroffene Dateien:** Alle API-Routes
**CWE:** CWE-770 (Allocation of Resources Without Limits)

#### Problem
Keine der API-Routen implementiert Rate Limiting, was zu:
- DoS-Angriffen führen kann
- API-Missbrauch ermöglicht (besonders bei KI-APIs)
- Unerwarteten Kosten durch übermäßige externe API-Calls

#### Empfehlung
1. **Implementieren Sie Rate Limiting mit Vercel Edge Config oder Upstash Redis:**
```typescript
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, "1 m"), // 10 requests per minute
});

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for") ?? "127.0.0.1";
  const { success } = await ratelimit.limit(ip);

  if (!success) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429 }
    );
  }
  // ... rest of the code
}
```

### 2.3 Fehlende CSRF-Protection
**Schweregrad:** HOCH
**Betroffene Dateien:** Alle API POST/DELETE-Routes
**CWE:** CWE-352 (Cross-Site Request Forgery)

#### Problem
API-Endpunkte haben keine CSRF-Protection. Während Firebase Authentication einen gewissen Schutz bietet, sind die API-Routes selbst nicht geschützt.

#### Empfehlung
1. **Verwenden Sie den `SameSite` Cookie-Attribut:**
```typescript
// In next.config.mjs
const nextConfig = {
  // ...
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Set-Cookie',
            value: 'SameSite=Lax; Secure'
          }
        ]
      }
    ]
  }
}
```

2. **Implementieren Sie Double-Submit-Cookie-Pattern oder verwenden Sie Next.js CSRF-Middleware**

---

## 3. MITTLERE SCHWACHSTELLEN

### 3.1 Dependency-Schwachstellen
**Schweregrad:** MITTEL
**Quelle:** npm audit

#### Gefundene Vulnerabilities
```
- @ai-sdk/anthropic: moderate severity (nanoid vulnerability)
- @ai-sdk/openai: moderate severity (nanoid vulnerability)
- @firebase/auth: moderate severity (undici vulnerability)
- firebase: moderate severity (multiple transitive dependencies)
```

#### Empfehlung
```bash
# Aktualisieren Sie Dependencies
npm update @ai-sdk/anthropic @ai-sdk/openai
npm install firebase@latest

# Überprüfen Sie Breaking Changes vor Major-Updates
npm audit fix
```

### 3.2 XSS-Risiko durch Tiptap-Editor
**Schweregrad:** MITTEL
**Datei:** `src/components/TodoList.tsx`
**CWE:** CWE-79 (Cross-Site Scripting)

#### Problem
Der Tiptap-Editor erlaubt Rich-Text-Eingaben inklusive HTML. Ohne ordnungsgemäße Sanitization könnte dies zu XSS führen.

#### Analyse
```typescript
// TodoList.tsx verwendet Tiptap-Extensions
const { extensions, editorProps } = useTiptapConfig({
    editable: true,
    enableMentionSuggestion: true,
    // Keine explizite HTML-Sanitization sichtbar
});
```

#### Empfehlung
1. **Stellen Sie sicher, dass DOMPurify verwendet wird:**
```typescript
import DOMPurify from 'dompurify';

// Bei der Anzeige von User-Content
const sanitizedContent = DOMPurify.sanitize(htmlContent);
```

2. **Konfigurieren Sie Tiptap mit allowed tags/attributes:**
```typescript
import { StarterKit } from '@tiptap/starter-kit';

const extensions = [
  StarterKit.configure({
    // Beschränken Sie erlaubte HTML-Tags
  })
];
```

### 3.3 Error Information Disclosure
**Schweregrad:** MITTEL
**Dateien:** Diverse API-Routes
**CWE:** CWE-209 (Information Exposure Through Error Message)

#### Problem
Error Messages enthalten teilweise sensitive Informationen:

```typescript
// src/app/api/replicate/generate-image/route.ts:34
catch (error) {
    console.error("Error from Replicate API:", error);
    return NextResponse.json(
        { error: (error as Error).message },
        { status: 500 }
    );
}
```

Dies könnte Stack-Traces, Pfade oder API-Details leaken.

#### Empfehlung
```typescript
catch (error) {
    console.error("Error from Replicate API:", error);
    // Sende nur generische Fehler an Client
    return NextResponse.json(
        { error: "Image generation failed. Please try again." },
        { status: 500 }
    );
}
```

### 3.4 Fehlende Content Security Policy
**Schweregrad:** MITTEL
**Datei:** `next.config.mjs`
**CWE:** CWE-1021 (Improper Restriction of Rendered UI Layers)

#### Problem
Es gibt nur eine CSP für SVG-Images, aber keine globale Content Security Policy.

#### Empfehlung
```javascript
// next.config.mjs
const nextConfig = {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https://firebasestorage.googleapis.com https://replicate.delivery",
              "connect-src 'self' https://*.googleapis.com https://api.deepgram.com wss://api.deepgram.com",
              "font-src 'self' data:",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'"
            ].join('; ')
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY'
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff'
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin'
          },
          {
            key: 'Permissions-Policy',
            value: 'geolocation=(), microphone=(self), camera=()'
          }
        ]
      }
    ]
  }
}
```

### 3.5 Firebase Security Rules - Potenzielle Schwachstellen
**Schweregrad:** MITTEL
**Datei:** `firestore.rules`

#### Analyse
Die Security Rules sind generell gut strukturiert, aber es gibt Optimierungspotential:

**Positive Aspekte:**
- Authentifizierung wird überprüft
- Ownership-Checks sind implementiert
- Sharing-Logic ist korrekt

**Verbesserungspotential:**

1. **Collection Group Query Zugriff (Zeile 74-80):**
```javascript
match /{path=**}/todos/{todoId} {
   allow read: if isAuthenticated() && (
       request.auth.uid == path[1] ||
       (resource.data.sharedWith != null && request.auth.uid in resource.data.sharedWith) ||
       (resource.data.mentionedUsers != null && request.auth.uid in resource.data.mentionedUsers)
   );
}
```
Dies ist korrekt, aber stellen Sie sicher, dass `sharedWith` und `mentionedUsers` Arrays validiert werden.

2. **Fehlende Größenlimits:**
```javascript
// Empfehlung: Fügen Sie Validierung hinzu
match /users/{userId}/todos/{todoId} {
    allow create: if isOwner(userId) &&
        request.resource.data.content.size() < 50000 && // Max 50KB
        (request.resource.data.sharedWith == null ||
         request.resource.data.sharedWith.size() <= 50); // Max 50 shared users
}
```

---

## 4. NIEDRIGE SCHWACHSTELLEN

### 4.1 Übermäßiges Logging sensibler Informationen
**Schweregrad:** NIEDRIG
**Dateien:** Diverse (AuthContext, firebaseUtils, etc.)

#### Problem
Console.log-Statements enthalten User-IDs, Emails und andere sensitive Daten:
```typescript
// src/lib/contexts/AuthContext.tsx:31
console.log("Auth state changed:", authUser ? `User logged in (${authUser.uid})` : "No user");
```

#### Empfehlung
- Entfernen Sie Debug-Logs aus Production-Code
- Verwenden Sie ein strukturiertes Logging-Framework (z.B. Winston, Pino)
- Implementieren Sie Log-Filtering basierend auf Umgebung

### 4.2 Fehlende Environment Variable Validierung
**Schweregrad:** NIEDRIG
**Datei:** `src/lib/firebase/firebase.ts:6-13`

#### Problem
Fehlende Environment Variables werden nicht validiert beim App-Start.

#### Empfehlung
```typescript
// Validieren Sie alle erforderlichen Env-Vars beim Start
const requiredEnvVars = [
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  // ...
];

requiredEnvVars.forEach(varName => {
  if (!process.env[varName]) {
    throw new Error(`Missing required environment variable: ${varName}`);
  }
});
```

### 4.3 Potenzielle Race Conditions
**Schweregrad:** NIEDRIG
**Datei:** `src/lib/firebase/firebaseUtils.ts:160-182`

#### Problem
Bei gleichzeitigen Contact-Requests könnte es zu Race Conditions kommen.

#### Empfehlung
Verwenden Sie Firestore Transactions statt Batches wo atomare Operationen erforderlich sind.

### 4.4 Fehlende Typing in Firestore-Queries
**Schweregrad:** NIEDRIG
**Dateien:** firebaseUtils.ts

#### Problem
Verwendet `any` Typen für Firestore-Daten, was Runtime-Fehler verursachen kann.

#### Empfehlung
```typescript
interface UserProfile {
  email: string;
  displayName: string;
  photoURL?: string;
  createdAt: Date;
  theme: 'light' | 'dark' | 'system';
  // ...
}

export const getUserProfile = async (userId: string): Promise<UserProfile | null> => {
  // ...
}
```

---

## 5. POSITIVE SICHERHEITSASPEKTE

Die Anwendung implementiert auch mehrere gute Sicherheitspraktiken:

1. **Firebase Authentication:** Google OAuth ist korrekt implementiert
2. **Protected Routes:** Authentifizierungs-Middleware in `(protected)` Layout
3. **Firestore Security Rules:** Gute Basis-Implementierung mit Owner/Sharing-Checks
4. **TypeScript:** Verwendung von TypeScript reduziert Type-Fehler
5. **Environment Variables:** Secrets werden über Env-Vars gespeichert (nicht hardcoded)
6. **HTTPS:** Firebase und Vercel erzwingen HTTPS
7. **SHA-256 Hashing:** Email-Invites verwenden Hashing (firebaseUtils.ts:65-81)
8. **serverTimestamp():** Verwendung von serverseitigen Timestamps verhindert Client-Manipulation

---

## 6. EMPFOHLENE SOFORTMASSNAHMEN

### Priorität 1 (Sofort)
1. **Sichern Sie den Deepgram API-Endpunkt** (1.1)
2. **Rotieren Sie alle API-Keys** als Vorsichtsmaßnahme
3. **Implementieren Sie Rate Limiting** (2.2)

### Priorität 2 (Diese Woche)
4. **Fügen Sie Input-Validierung hinzu** (2.1)
5. **Aktualisieren Sie Dependencies** (3.1)
6. **Implementieren Sie Content Security Policy** (3.4)
7. **Fügen Sie CSRF-Protection hinzu** (2.3)

### Priorität 3 (Nächste 2 Wochen)
8. **Verbessern Sie Error Handling** (3.3)
9. **Implementieren Sie strukturiertes Logging** (4.1)
10. **Fügen Sie Firestore Size-Limits hinzu** (3.5)
11. **XSS-Prevention überprüfen** (3.2)

---

## 7. COMPLIANCE & BEST PRACTICES

### OWASP Top 10 (2021) Abdeckung
| Risiko | Status | Kommentar |
|--------|--------|-----------|
| A01 - Broken Access Control | ⚠️ Teilweise | Firestore Rules gut, API-Auth fehlt |
| A02 - Cryptographic Failures | ✅ Gut | Firebase handhabt Crypto |
| A03 - Injection | ⚠️ Risiko | Input-Validierung fehlt |
| A04 - Insecure Design | ⚠️ Teilweise | Rate Limiting fehlt |
| A05 - Security Misconfiguration | ❌ Kritisch | API-Key Exposure |
| A06 - Vulnerable Components | ⚠️ Mittel | Dependencies veraltet |
| A07 - Authentication Failures | ✅ Gut | Firebase Auth korrekt |
| A08 - Software/Data Integrity | ✅ Gut | Dependencies via npm |
| A09 - Logging Failures | ⚠️ Teilweise | Zu viel Logging |
| A10 - SSRF | ✅ Gut | Keine SSRF-Vektoren gefunden |

### DSGVO/GDPR Überlegungen
- **Datenminimierung:** Überlegen Sie, welche User-Daten wirklich nötig sind
- **Recht auf Löschung:** Implementieren Sie Account-Deletion-Funktion
- **Datenexport:** Funktion zum Exportieren von User-Daten fehlt
- **Logging:** Stellen Sie sicher, dass Logs keine personenbezogenen Daten enthalten

---

## 8. TESTING-EMPFEHLUNGEN

### Sicherheitstests die durchgeführt werden sollten:
1. **Penetration Testing** auf API-Endpunkten
2. **Authentication Bypass Testing**
3. **Firestore Rules Testing** mit Firebase Emulator
4. **XSS Testing** im Tiptap-Editor
5. **CSRF Testing** auf allen State-Changing-Operations
6. **Rate Limiting Testing**
7. **Dependency Scanning** (Snyk, Dependabot)

### Automatisierte Security-Tools
```bash
# 1. npm audit
npm audit --production

# 2. Snyk installieren und scannen
npm install -g snyk
snyk test

# 3. ESLint Security Plugin
npm install --save-dev eslint-plugin-security
```

---

## 9. ZUSAMMENFASSUNG & RISK SCORE

### Gesamt-Risiko-Score: **6.5 / 10** (HOCH)

**Begründung:**
- Eine kritische Schwachstelle (API-Key Exposure) erhöht das Risiko erheblich
- Mehrere hohe Risiken (Input-Validierung, Rate Limiting, CSRF)
- Gute Basis-Sicherheit durch Firebase Authentication
- Solide Firestore Security Rules

### Zeit-Aufwand für Fixes:
- **Kritische Issues:** 2-4 Stunden
- **Hohe Issues:** 8-12 Stunden
- **Mittlere Issues:** 16-20 Stunden
- **Niedrige Issues:** 4-8 Stunden

**Gesamt:** ~30-44 Stunden Entwicklungszeit

---

## 10. KONTAKT & NÄCHSTE SCHRITTE

### Empfohlene nächste Schritte:
1. Review dieses Audits mit dem Entwicklungsteam
2. Priorisierung der Fixes nach Business-Impact
3. Implementierung der Priorität-1-Fixes
4. Einrichtung von automatisiertem Security-Scanning (CI/CD)
5. Regelmäßige Security-Audits (quartalsweise)

### Hilfreiche Ressourcen:
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Firebase Security Rules Best Practices](https://firebase.google.com/docs/rules/best-practices)
- [Next.js Security Headers](https://nextjs.org/docs/advanced-features/security-headers)
- [Vercel Security](https://vercel.com/docs/concepts/security)

---

**Ende des Security Audit Reports**

*Dieses Audit wurde automatisiert mit Claude Code durchgeführt und sollte von einem Security-Experten überprüft werden.*
