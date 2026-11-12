# Messaging playbook

This is how LinkPilot writes connection notes, first messages and follow-ups, and the evidence behind it. It is backed by research done in November 2026.

The code is in [background/writing.js](../background/writing.js) (voice, examples, follow-up playbook, AI-tells check) and [background/ai.js](../background/ai.js) (prompts).

Almost all of the numbers below come from vendors, and most measure cold email rather than LinkedIn. They show what correlates with replies, not what causes them.

## Why the old messages read as AI

- The prompts were long "never do X" lists with no examples of good messages.
- Every first message was forced to end in a question.
- "Hi <name>," was banned.
- The result was one formula: a clever, quotable observation, then a credential clause, then a question.
- Measured: the new check flags 37 of 65 earlier outputs. The most common tell was "curious" (24 times), then colons, "stuck with me" and "genuinely".

## What the research says

### Length

- Expandi's LinkedIn study (H2 2026) found the best band was 151 to 200 characters. Replies fall off past 500.
- LinkedIn's InMail data: messages under 400 characters get 22% more replies, and messages over 1,200 get 11% fewer.
- Lavender: emails of 25 to 50 words get the most replies.
- Our targets:
  - **Note:** 100 to 180 characters, with 200 as the hard limit.
  - **First message:** 2 to 4 sentences, 30 to 60 words, under 350 characters.
  - **Follow-up:** 150 to 300 characters. Answers to a question can run to 450.

### Questions

Zero or one question both work. Two or more lower replies (Lavender). An ask can be a plain sentence.

### Pitching

- Pitching in a cold message cuts replies by up to 57% (Gong).
- ROI language cuts success by 15% (Gong).
- An interest question works about twice as well as a meeting ask on a cold message (30% vs 15%, Gong).
- Once the person is engaged, offer specific times instead: 37% vs 25% for an interest question.

### Notes

- A note barely changes acceptance, but replies later go up (Belkins 2026: 8.2% vs 5.3%).
- An honest note that states the reason books more calls than a vague one (La Growth Machine).
- Notes themselves rarely get replies (2 to 3%). A note's job is acceptance plus context.

### First message after a note

Refer back to the note lightly. Never repeat its detail or its question, and never open with just "thanks for connecting".

### Personalisation

One real, recent, checkable detail beats any amount of flattery. The test: the line should not make sense if you sent it to someone else.

### Follow-ups

- Three messages in total does best. Five or more does worse than one (Expandi).
- The second message gets the most replies per message sent.
- Every follow-up must add something new. Generic "bubble-up" nudges are 15 times less likely to book a meeting (Gong).

### AI-sounding text

- People can't reliably detect AI text (Jakesch, PNAS 2023). But once they suspect it, they judge the sender harshly.
- Suspicion comes from stacked tells.
- Banning tells one by one makes the model swap in another, so we pair a ban list with a positive voice spec, examples, and a code check.
- Claude-specific tells (Graphite, Opus 5.5 study) include "this matters", "rather than simply", "is more than a" and evaluative adjectives such as "dependable", "thoughtful" and "meaningful".

## Rules the code enforces

[findAiTells](../background/writing.js) checks every message for:

- **Banned words and phrases:** for example "curious", "I noticed", "rather than", "not just", "resonate", "would love to", "hope you're well".
- **Banned punctuation:** dashes used as punctuation, colons, semicolons, exclamation marks, ellipses and emoji.
- **Banned shapes:**
  - "It's not X, it's Y"
  - "X never…, Y always…"
  - "Not X. Not Y."
  - Trailing "-ing" clauses
  - A question that answers itself
- **More than one question.**

If a check fails, the message is rewritten once with the exact problems named. After that, punctuation is cleaned up mechanically. Words are never changed mechanically.

The last 20 opening lines a sender used are kept, so new messages don't all start the same way.

## Follow-ups

- The thread reader loads older messages, then sends each message with its sender and date: `[Oct 9, 6:20 PM] Sara: …`.
- The prompt first works out the state of the conversation:
  - who sent the last message
  - how long ago it was sent
  - whether there's an unanswered question
- It never repeats what was already said, mirrors the other person's length, and handles gaps in time.
- It then follows one of 16 situations (A to P in `FOLLOWUP_PLAYBOOK`), such as:
  - no reply 1, no reply 2, final message
  - interested, so propose times
  - they asked a question
  - six objection types
  - referral or wrong person
  - went quiet
  - after a call
  - job-specific situations

## Main sources

- Expandi: https://expandi.io/state-of-linkedin-outreach-h2-2026/
- LinkedIn InMail data: https://www.linkedin.com/business/talent/blog/talent-strategy/these-inmails-get-best-response-rates
- Lavender: https://lavender.ai/blog/the-cold-email-benchmark-report
- Gong Labs (call to action and follow-ups): https://www.gong.io/resources/labs/
- Belkins: https://belkins.io/blog/linkedin-outreach-study
- La Growth Machine: https://lagrowthmachine.com/should-i-add-a-note-to-my-linkedin-connection-request/
- Wikipedia, Signs of AI writing: https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing
- Kobak et al. 2025: https://arxiv.org/html/2406.07016
- Reinhart et al. 2025: https://arxiv.org/abs/2410.16107
- Graphite, Opus 5.5 tells: https://graphite.io/five-percent/research/ai-tells-opus-5-5-update
- 30MPC × Josh Braun objection guides: linked in the follow-up research notes.
