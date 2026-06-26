# Husnain LinkedIn Helper

A Chrome extension that brings AI-powered intelligence to LinkedIn profiles — for B2B sales, freelance/consulting outreach, and job search.

---

## Features

### Three Modes
| Mode | What it does |
|---|---|
| **💼 B2B Sales** | Score prospects against your ICP, get decision-maker signals, industry fit, and personalized outreach |
| **🧑‍💻 Freelance / Consulting** | Identify client potential, hiring-freelancer signals, pain points, and approach angles |
| **🎯 Job Search** | Detect hiring signals, check if the person is a recruiter, and get actionable networking insights |

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
Pick **B2B Sales**, **Freelance**, or **Job Search** in Settings. Each mode changes what gets analyzed and how outreach is written.

### Step 2 — Fill In Your Profile
- **B2B Sales:** Set your ICP industries, exclusions, business description, and message tone
- **Freelance:** Add your name, service, niche, and selling points
- **Job Search:** Add your name, target roles, target industries, background, and years of experience

### Step 3 — Add API Keys
- **OpenAI API key** (required) — powers all AI analysis and message generation
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
- OpenAI `gpt-4o-mini` via Chat Completions API
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

- All analysis is done via your own OpenAI API key — no data is sent to any third-party server other than OpenAI and HubSpot (if configured)
- Profile data and analysis results are cached locally in your browser's IndexedDB
- API keys are stored in `chrome.storage.local` and never leave your device

---

## License

MIT
