# Husnain LinkedIn Helper

A Chrome extension that brings AI-powered intelligence to LinkedIn profiles — for B2B sales, freelance/consulting outreach, and job search.

---

## Features

### Two Modes
| Mode | What it does |
|---|---|
| **B2C** (default) | You, finding work: jobs, freelance projects or a place on a team. Scores whether a person can hire you, refer you or bring you in, and writes peer-to-peer outreach that never reads like an application |
| **B2B** | Your company, finding clients. Scores prospects against your ICP (industries, sub-segments, locations, size, seniority) and writes outreach that doesn't pitch |

### Core Capabilities
- **Profile Analysis** — AI scores every LinkedIn profile against your configured goals
- **Connection Request** — generates a personalized, character-counted (≤200 chars) connection note
- **First Message** — writes a tailored cold outreach message
- **Open Messaging** — opens LinkedIn's native message window pre-filled
- **Contact Extraction** — surfaces visible email, phone, and social links from the profile
- **HubSpot Integration** — push contacts as deals with pipeline, stage, owner, and notes in one click

---

## Installation

1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select this folder
5. Click the extension icon → **Open Settings** to configure

---

## Setup

### Step 1 — Choose Your Mode
Pick **B2C** (default) or **B2B** in Settings, the popup, or the panel. Each mode keeps its own setup, saved profiles and message style.

### Step 2 — Fill In Your Profile
- **B2C:** What you're looking for (work type, roles, level), your pitch (one-liner, skills, proof points), and who can hire you (people to reach, industries, locations, company size)
- **B2B:** What you offer (offer, problems you solve, proof points), who you target (industries and sub-segments, locations, headcount, seniority, titles), and why-now signals
- **Both:** what to skip (industries, company types, roles, companies) and message style (tone, how messages end). Industries come from a 24-group / 208-segment list aligned with LinkedIn's own industry names.

### Step 3 — Add API Keys
- **Anthropic API key** (required) — powers all AI analysis and message generation
- **HubSpot Private App token** (optional) — enables the "Push to HubSpot" deal creation feature

---

## Usage

1. Go to any LinkedIn profile at `linkedin.com/in/…`
2. Click the blue **Analyze** button on the right edge of the page
3. Choose what you want: Analyze, Connection Request, First Message, or Open Messaging
4. Optionally push the contact to HubSpot as a deal

---

## Tech Stack

- Chrome Extension Manifest V3
- Vanilla JS (no build step, no dependencies)
- Anthropic `claude-sonnet-5-5` via the Messages API
- HubSpot CRM v3/v4 API
- IndexedDB for per-profile analysis caching

---

## File Structure

```
├── manifest.json       # Extension config (MV3)
├── background.js       # Service worker — AI calls, HubSpot API
├── content.js          # LinkedIn page injection — panel UI
├── content.css         # Panel styles
├── options.html        # Settings page (3-step wizard)
├── options.css
├── options.js
├── popup.html          # Toolbar popup
├── popup.css
├── popup.js
├── icon16.png          # LinkedIn-style extension icons
├── icon48.png
└── icon128.png
```

---

## Privacy

- All analysis is done via your own Anthropic API key — no data is sent to any third-party server other than Anthropic and HubSpot (if configured)
- Profile data and analysis results are cached locally in your browser's IndexedDB
- API keys are stored in `chrome.storage.local` and never leave your device

---

## License

MIT
