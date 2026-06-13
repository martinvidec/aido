# Handoff: aido UI‑Redesign (Spaces · Heute · Liste · Board · Mobile)

## Overview
Komplettes Redesign der aido‑Todo‑App, ausgehend vom Screenshot „direkt nach dem Login". Aus vier explorativen Richtungen (A Kommandozentrale, B Chat mit aido, C Spaces, D Karten) wurde nach mehreren Feedback‑Runden ein Zielbild zusammengeführt:

- **Spaces** als organisierendes Grundgerüst (ersetzt „My Todos / Shared with me").
- **Heute** – ein chat‑artiger Schnell‑Erfassungsbereich pro Space für kurzlebige Tages‑Todos, mit Richtungsanzeige (wer → an wen).
- **Liste** – strukturierte Todos (Titel + formatierte Beschreibung/Checklisten, der ursprüngliche TipTap‑Anwendungsfall), aufklappbar, mit @Mentions, #Tags‑Filter und „wartet auf …"‑Status.
- **Board** – dieselben Todos als Kanban, umschaltbar gruppiert „Nach Person" (bei dir / bei Michi …) oder „Nach Status" (Offen / Wartet / Erledigt), mit Drag&Drop (Desktop) bzw. „Verschieben"-Sheet (Mobile).
- Durchgängiger **Dark/Light‑Toggle** und eine eigene **Mobile‑Version** (iPhone‑Layout mit Bottom‑Tab‑Navigation).

## About the Design Files
Die Dateien in diesem Bundle sind **Design‑Referenzen, erstellt in HTML** – Prototypen, die Aussehen und Verhalten zeigen, **kein** produktiv zu übernehmender Code. Aufgabe ist, diese Designs in der **bestehenden Umgebung des aido‑Repos** nachzubauen: **Next.js 15 (App Router), React, TypeScript, Tailwind CSS, TipTap, Firebase/Firestore**. Bestehende Muster und Komponenten (z. B. `src/components/Navbar.tsx`, `TodoList.tsx`, `Todo.tsx`, `ShareTodo.tsx`, `MentionsList.tsx`, `ThemeContext`) sollen weiterverwendet bzw. ersetzt werden, statt das HTML 1:1 zu kopieren.

Die Prototypen sind **als Design Components (`.dc.html`)** gebaut. Zum Ansehen einfach im Browser öffnen (die mitgelieferten `support.js` und `ios-frame.jsx` liegen daneben). Die Logik steckt jeweils in einer `class Component extends DCLogic` am Dateiende – sie ist gut lesbar und dient als **Referenz für State & Verhalten**, nicht als zu übernehmende Architektur.

## Fidelity
**High‑fidelity.** Finale Farben (als `oklch`), Typografie, Abstände, Radien und Interaktionen sind final gemeint. Die UI soll pixelnah mit den Libraries/Patterns des Repos nachgebaut werden. Wo unten exakte Werte stehen, sind sie verbindlich; Tailwind‑Utilities dürfen gerundete Äquivalente verwenden, sofern das Ergebnis visuell identisch ist.

---

## Screens / Views

### 1) Desktop – Grundlayout (`Aido Final Kern.dc.html`)
**Zweck:** Hauptarbeitsfläche. Zweispaltig: feste Sidebar links, scrollende Hauptspalte rechts.

**Layout**
- Wurzel: `display:flex; height:100vh; overflow:hidden`.
- **Sidebar:** `width:256px`, `flex-shrink:0`, `background: var(--bg-side)`, rechte Border `1px var(--border)`, `padding:22px 14px 18px`, vertikaler Flex mit `gap:4px`.
- **Hauptspalte:** `flex:1; overflow-y:auto`. Innerer Container `max-width:780px` (Liste) bzw. `1140px` (Board), zentriert, `padding:30px 36px 90px`, vertikaler Flex `gap:18px`.

**Komponenten Sidebar**
- Logo: 28×28 Rundung `9px`, `background: var(--accent)`, zwei 5px‑Punkte (Roboter‑Augen) weiß, daneben Wortmarke „aido" `font-weight:900; font-size:17px`. Rechts ein Theme‑Toggle (38×21 Pill).
- Abschnittslabel „Spaces": `11px`, `font-weight:800`, `text-transform:uppercase`, `letter-spacing:0.1em`, `color: var(--text-dim)`.
- Space‑Zeile: `padding:10px 12px`, `border-radius:12px`; aktiver Eintrag `background: var(--row-hover)`, `font-weight:800`; farbiges 10×10‑Quadrat (Space‑Farbe, `border-radius:4px`) + Name (ellipsis) + offener‑Zähler rechts (`12px`, dim). Hover: `background: var(--row-hover)`.
- „+ Neuer Space": dim, wird bei Klick zu Inline‑Input (Bestätigen mit Enter, Abbrechen mit Esc).
- Fuß (mit oberer Border): Avatar 28×28 (Initialen MV, weiß auf User‑Farbe) + Name „Martin" + „Settings" (dim, rechts).

**Komponenten Hauptspalte – Space‑Header**
- Farbquadrat 14×14 (`radius:5px`) + Space‑Name `h1 24px/900`.
- Mitglieder‑Avatare (28×28, überlappend `margin-left:-8px`, 2px‑Border in `var(--bg)`).
- „+ einladen": `border:1.5px dashed var(--border)`, Pill, dim; öffnet Popover „Mitglieder" (Toggle pro Kontakt mit ✓).
- Rechts: Segmented Control **Liste | Board** (`bg: var(--bg-card)`, Border, Pill‑Padding 3px; aktiver Tab `background: var(--text); color: var(--bg)`).

**Heute‑Bereich** (`background: var(--accent-soft)`, `border-radius:18px`, `padding:16px 18px 14px`)
- Kopf: 24×24 Logo‑Icon + „Heute" `15px/900` + Hinweis „Kurzes für zwischendurch — landet nicht in der Liste" + rechts „N offen" (`accent-text`).
- Liegengebliebene (nicht‑heutige offene Daily‑Items): Badge „liegengeblieben" (`wait-bg`/`wait-text`, `radius:6px`), Text, Aktion „→ in die Liste", „✕".
- **Chat‑Bubbles** (heutige Items): eigene Nachrichten rechtsbündig (`bubbleRadius:14px 14px 4px 14px`), fremde linksbündig mit Avatar (26×26) und `4px 14px 14px 14px`. Über der Bubble ein Meta‑Label (`10px/800`, uppercase, dim): „du → Michi", „Michi → dich" oder „von Michi", abgeleitet aus Autor + erstem @Mention. Bubble: `background: var(--bg-card)`, Abhak‑Kreis 19×19, Text, „✕".
- Eingabe: Pill (`border-radius:99px`, `bg: var(--bg-card)`, `padding:8px 8px 8px 18px`), Input + runder Senden‑Button 30×30 (`accent`, „↑"). @/#-Autocomplete‑Popover erscheint **über** dem Feld.

**Liste**
- Zeile „Todos" + horizontale **Tag‑Chip‑Leiste** (alle Tags des Space). Chip aktiv: `background: var(--accent); color:white`. Chips sind **kombinierbar** (UND‑Filter, entspricht der bestehenden Tag‑Suche). „✕ Filter" setzt zurück.
- **Composer (eingeklappt):** Zeile `bg: var(--bg-card)`, Border `1.5px var(--activeColor)` (Space‑Farbe), „+", Input, „⌵ Mehr" (öffnet Editor), Button „Hinzufügen" (Space‑Farbe).
- **Composer (offen):** Titel‑Input (`17px/800`), Format‑Toolbar **B / I / U / ≔ / ❝ / </>** (im Prototyp dekorativ → im Repo via TipTap), `textarea` Beschreibung, „Abbrechen"/„Hinzufügen".
- **Todo‑Zeile:** Abhak‑Kreis 22×22 (`border:2px var(--check-border)`, Hover‑Border = Space‑Farbe), Titel `15px/700` mit @Mention‑ und #Tag‑Hervorhebung; optional Chips „wartet auf X" (`wait-*`) und Checklisten‑Fortschritt „1/4" (mono, dim). Rechts: Chevron (nur wenn Beschreibung vorhanden, klappt Details auf) und „…"-Menü. Hover‑Hintergrund `var(--row-hover)`.
- **Aufgeklappte Details:** gerenderter Markdown‑artiger Body – `# Überschrift` (uppercase/dim), `- Punkt` (Bullet), `- [ ] / - [x]` als **interaktive Checkboxen** 16×16 (`radius:5px`; erledigt: `accent`+✓). Toggle schreibt direkt in den Body‑Text zurück.
- **„…"-Menü (Popover):** Bearbeiten · „Wartet auf …" (Untermenü mit Space‑Mitgliedern + „Niemand") · Löschen (`danger`).
- **Erledigt:** einklappbarer Abschnitt („Erledigt (N)"), Zeilen mit Durchstreichung, Opacity 0.55, Wieder‑öffnen‑✓ und „✕".

**Board** (siehe eigener Abschnitt „Interactions")
- Gruppieren‑Umschalter (Pills): „Nach Person" / „Nach Status".
- Spaltengrid `grid-template-columns: repeat(N, minmax(190px,1fr))`, horizontal scrollbar. Spalten: dashed Border `1.5px`, `radius:16px`, `min-height:240px`. Karte: `bg: var(--bg-card)`, `radius:12px`, Titel + (Fortschritt, „bei X"-Chip) + Abhak‑Kreis; `draggable`.

### 2) Mobile (`Aido Mobile.dc.html`)
**Zweck:** dieselbe App im iPhone‑Layout (Frame 402×874, über `ios-frame.jsx`). Eine Spalte, Bottom‑Tab‑Navigation.

**Layout**
- App‑Wurzel: `height:100%`, Flex‑Spalte: **Header** (fix) → **Scroll‑Content** (`flex:1; overflow-y:auto`) → **kontextuelle Eingabe** (nur Heute) → **Bottom‑Tab‑Bar** (fix). Bottom‑Sheets und Toast `position:absolute` innerhalb der Wurzel.
- Header‑`padding-top:56px` (Statusbar/Dynamic‑Island frei). Tab‑Bar `padding-bottom:30px` (Home‑Indicator frei). Header/Footer mit `backdrop-filter: blur(12px)` und `background: var(--nav-bg)`.

**Komponenten**
- **Header:** Logo + Wortmarke; rechts Mitglieder‑Avatare + Theme‑Toggle (42×24). Darunter horizontal scrollbare **Space‑Pills** (aktiv: `accent-soft`, Border `accent`) + „+ Space" (öffnet Bottom‑Sheet).
- **Bottom‑Tabs:** Heute · Todos · Board, je Icon (24×24 SVG: Sprechblase / Linien / Balken) + Label `11px/800`; aktiv `color: var(--accent)`. Badge‑Pin (offene Anzahl) oben rechts am Icon.
- **Heute‑Tab:** Liste der Bubbles wie Desktop (Touch‑Größen), Eingabe als **fixe Chat‑Leiste** unten (Autocomplete erscheint darüber).
- **Todos‑Tab:** Quick‑Add oben (mit „⌵" zum Aufklappen), scrollbare Tag‑Chips, Karten‑Zeilen (`bg: var(--bg-card)`, Border, `radius:14px`), Tap auf Titel klappt Details auf, „…" öffnet **Aktions‑Sheet** (Bearbeiten / Wartet auf … als Chips / Löschen).
- **Board‑Tab:** Gruppieren‑Umschalter; Spalten **vertikal gestapelt** (Sektionskopf + Karten). Statt Drag&Drop pro Karte ein **„Verschieben"-Sheet** mit den übrigen Spalten als Zielen.
- **Bottom‑Sheets:** abgerundet oben (`radius:22px 22px 0 0`), Grabber 38×4, halbtransparenter Overlay dahinter (`oklch(0 0 0 /0.45)`). Touch‑Ziele ≥44px.

### 3) Explorationen (`Aido Redesign Explorationen.dc.html`)
Nur **Referenz/Kontext**: die vier ursprünglichen Richtungen A–D plus Typo/Farb‑Basis. Nicht implementieren – zeigt, woher die finalen Entscheidungen kommen.

---

## Interactions & Behavior
- **Space‑Wechsel** setzt Filter/Drafts zurück, lädt Todos+Daily des Space.
- **Todo anlegen:** Enter im Quick‑Add oder Button. Bei offenem @/#-Token wählt Enter zuerst den ersten Autocomplete‑Vorschlag.
- **@Mention‑Autocomplete:** Trigger Regex `(^|\s)@(\w*)$`, Space‑Mitglieder werden vorsortiert. **#Tag‑Autocomplete:** `(^|\s)#(\w*)$`, bekannte Tags aus allen Spaces.
- **Tag‑Klick** im Text aktiviert den Filter; mehrere Tags = UND‑Verknüpfung.
- **Checklisten‑Toggle** mutiert die Body‑Zeile (`- [ ]` ↔ `- [x]`) und aktualisiert den „n/m"-Fortschritt.
- **„Wartet auf X"** setzt `waitingOn`; im Board landet das Todo dadurch in der Personen‑/Wartet‑Spalte.
- **Board Drag&Drop (Desktop):** HTML5‑DnD; Ablegen in Spalte setzt `waitingOn` bzw. `completed`. **Mobile:** Tap „Verschieben" → Sheet → Zielspalte.
- **Liegengebliebene Daily‑Items** (Datum < heute, offen) erscheinen mit Aktion „→ in die Liste" (wandelt Daily in ein vollwertiges Todo um).
- **Theme‑Toggle** schreibt `data-theme` auf `document.documentElement` und persistiert in `localStorage['aidoF-theme']`. Übergänge: `background-color/color 0.25s`.
- **Transitions:** Toggle‑Knopf `margin-left 0.2s`; Board‑Spalten `background/border 0.15s`; Karten‑Hover `box-shadow`.
- **Toast:** kurze Bestätigung (z. B. „In die Liste übernommen."), Auto‑Hide nach 2600 ms.

## State Management
Im Repo via Firestore + React‑State/Context abbilden. Im Prototyp gehaltene Zustände:
- `spaces[]` (siehe Datenmodell), `activeSpace`.
- UI: `mobileTab` (heute|todos|board), `view` (liste|board), `groupBy` (person|status), `tagFilters[]`, `expanded[]` (aufgeklappte Todo‑IDs), `showDone`.
- Eingaben: `draft`, `bodyDraft`, `composerOpen`, `dailyDraft`, `spaceDraft`.
- Transient: `menuId`, `waitOpen`, `moveCardId`, `editId/editTitle/editBody`, `inviteOpen`, `dragId/dragOver`, `toast`.

### Vorgeschlagenes Datenmodell (Firestore)
Erweiterung des bestehenden Todo‑Modells:
```
Space   { id, name, color (oklch-Hue), members: [userId], createdBy }
Todo    { id, spaceId, title, body (rich/markdown via TipTap),
          completed: bool, waitingOn: userId|null,
          tags: [string]            // aus title/body ableitbar (#tag)
          mentions: [userId],       // aus @-Tokens
          createdBy, createdAt, order }
Daily   { id, spaceId, text, completed: bool,
          date: 'YYYY-MM-DD', author: userId }   // kurzlebige „Heute"-Items
```
Hinweise:
- „Geteilt mit mir" entfällt zugunsten von **Space‑Mitgliedschaft** (wer im Space ist, sieht alles darin). **Rechte‑Modell prüfen:** bisher dürfen geteilte Nutzer serverseitig nur abhaken – für volle Space‑Kollaboration müssen die Firestore‑Rules erweitert werden.
- `waitingOn` ist neu (treibt Board‑Spalten „bei X" und den „wartet auf"-Chip).
- `Daily` ist bewusst getrennt von `Todo` (kein Eintrag in der Hauptliste).

## Design Tokens

**Farben – Dark (Default), als CSS‑Variablen (oklch):**
| Token | Wert |
|---|---|
| `--bg` | `oklch(0.22 0.02 270)` |
| `--bg-side` | `oklch(0.19 0.02 270)` |
| `--bg-card` | `oklch(0.26 0.02 270)` |
| `--bg-pop` | `oklch(0.28 0.02 270)` |
| `--row-hover` | `oklch(0.29 0.02 270)` |
| `--border` | `oklch(0.33 0.02 270)` |
| `--text` | `oklch(0.95 0.01 80)` |
| `--text-dim` | `oklch(0.62 0.02 270)` |
| `--check-border` | `oklch(0.5 0.03 270)` |
| `--accent` (Koralle) | `oklch(0.72 0.15 40)` |
| `--accent-soft` | `oklch(0.72 0.15 40 / 0.18)` |
| `--accent-text` | `oklch(0.83 0.09 40)` |
| `--mention` | `oklch(0.8 0.08 200)` |
| `--mention-bg` | `oklch(0.72 0.15 200 / 0.18)` |
| `--tag` | `oklch(0.8 0.08 40)` |
| `--wait-text` | `oklch(0.82 0.1 75)` |
| `--wait-bg` | `oklch(0.75 0.14 75 / 0.16)` |
| `--danger` | `oklch(0.68 0.18 25)` |

**Farben – Light Override (`html[data-theme="light"]`):**
`--bg: oklch(0.965 0.008 80)`, `--bg-side: white`, `--bg-card: white` (Desktop) / `oklch(0.99 0.004 80)` (Mobile), `--bg-pop: white`, `--row-hover: oklch(0.93 0.008 80)`, `--border: oklch(0.89 0.01 80)`, `--text: oklch(0.27 0.02 270)`, `--text-dim: oklch(0.55 0.02 270)`, `--check-border: oklch(0.78 0.02 80)`, `--accent-soft: oklch(0.72 0.15 40 / 0.14)`, `--accent-text: oklch(0.5 0.12 40)`, `--mention: oklch(0.5 0.12 200)`, `--mention-bg: oklch(0.72 0.15 200 / 0.14)`, `--tag: oklch(0.55 0.12 40)`, `--wait-text: oklch(0.5 0.12 75)`, `--danger: oklch(0.55 0.2 25)`.

**Personen-/Space‑Farben:** Martin `oklch(0.72 0.15 200)` (Teal), Michi `oklch(0.72 0.15 40)` (Koralle), Jan `oklch(0.65 0.14 300)` (Violett), Lisa `oklch(0.7 0.13 160)` (Grün). Neue Spaces zyklisch aus dieser Palette.

**Typografie:** UI‑Schrift **Nunito** (400/600/700/800/900). **JetBrains Mono** (400/600) für #Tags und Zahlen (Fortschritt). Größen: H1 24, Section‑Label 11 (uppercase, `letter-spacing:0.1em`), Todo‑Titel 15/700, Body 14/600 (`line-height≈1.55`), Bubbles 14/700, Chips 12.

**Radien:** Pills/Avatare `99px`/`50%`; Karten `12–18px`; Bottom‑Sheets `22px` oben; Logo `9px`; kleine Buttons `8–10px`.
**Schatten:** `--shadow` Dark `0 8px 24–30px oklch(0 0 0 /0.35–0.4)`, Light `…/0.13–0.16`.
**Spacing:** Hauptspalte `gap:18px`; Listen/Karten‑Innen `padding:12–18px`; Sektions‑`gap:8–14px`.

## Assets
- **Keine Bild‑Assets.** Logo, Avatare und Tab‑Icons sind reine CSS/SVG‑Primitive (zwei Punkte = Roboter‑Augen, passend zum vorhandenen `src/app/icon.png`). Avatare = Initialen auf Personenfarbe.
- Fonts via Google Fonts (Nunito, JetBrains Mono) – im Repo ggf. über `next/font` einbinden.
- `ios-frame.jsx` ist nur **Vorschau‑Chrome** für das Mobile‑Mockup, gehört nicht in die App.

## Screenshots
Im Ordner `screenshots/` (High‑Res, nur zur Orientierung – verbindlich sind die Token/Maße oben):
- `01-desktop-liste-dark.png` — Desktop, Listenansicht, Dark
- `02-desktop-board.png` — Desktop, Board (Nach Person), Dark
- `03-desktop-liste-light.png` — Desktop, Listenansicht, Light
- `04-mobile-todos.png` — Mobile, Todos‑Tab
- `05-mobile-heute.png` — Mobile, Heute‑Chat (Richtungs‑Labels, Bubbles)
- `06-mobile-board.png` — Mobile, Board mit „Verschieben"-Aktion

## Files
Im Bundle (Design‑Referenzen):
- `Aido Final Kern.dc.html` — **Desktop**, finaler Stand (Spaces + Heute + Liste + Board). Hauptreferenz.
- `Aido Mobile.dc.html` — **Mobile**, iPhone‑Layout mit Bottom‑Tabs und Sheets.
- `Aido Redesign Explorationen.dc.html` — Kontext: die vier Ausgangsrichtungen + Token‑Basis.
- `ios-frame.jsx`, `support.js` — nötig, damit die `.dc.html` lokal im Browser rendern. **Nicht** Teil der App.

Zum Ansehen: die jeweilige `.dc.html` im Browser öffnen. Verhalten/State sind in der `class Component` am Dateiende dokumentiert und dienen als verbindliche Verhaltensreferenz.
