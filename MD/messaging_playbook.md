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

## B2B: the rep speaks for the company

The cold-outreach research above says "don't pitch". Satyron's BD team found the result useless for a services company, and they were right. The messages never said who was writing, which company it was or what it does. They were written as a lone founder ("I run a small studio", "I built"), which isn't true for a BD rep.

B2B messages now work like this:

- **Who:** the rep gives their first name, their role if set, and the company name.
- **What:** one sentence on the one or two services that fit this prospect, never the full list.
- **Proof:** at most one proof point, the closest match to the prospect's industry or problem, in "we" form.
- **"We" and "I":** "we" for the company's work. "I" only for what the rep does. "I built" is blocked unless the role is founder, CTO, engineer or lead.
- **Length:**
  - Note: 130 to 200 characters.
  - First message (BD team spec, Nov 13): 50 to 75 words, three lines:
    1. One natural line about something specific they posted, built, launched or are hiring for.
    2. How the company's work connects to that, framed as the outcome for them. Only ONE service, and not AI by default.
    3. One easy, curious question about their work or plans.

    The goal is a conversation, not a sale. A first message never contains a proof point, a link, a call request, Calendly or "thanks for connecting". Code checks enforce the word range, no links and the closing question. Proof and trust points wait for message 2.
  - Follow-ups: up to 350 characters, or 550 for an answer or a case study.
- **Follow-ups** can share a matching case study, offer case studies or the portfolio, propose two call times once the prospect is interested, and explain how the company works. They never invent prices, timelines or client names.
- **Code checks:** every note and first message must name the company. "I built" from a non-engineer triggers one rewrite.
- **No client names.** Proof points can name clients for the rep's reference, but messages describe the project instead. A code check rewrites any message that names one.
- **Price:** never in a first message (code check). When asked, the answer comes from the "Typical price range" field. Satyron's says budget-friendly hourly rates, hourly or fixed-price contracts, so the reply says that plainly and offers 15 minutes to give a real number.
- **Role is personal**, like the rep's name. Settings has a "Your role" field, and importing a team setup keeps each rep's own role.

## B2C: say who you are and what you do

B2C messages had the same problem. "Say who you are only if it explains the reason" and a 350-character cap meant they often never said what the sender does.

B2C messages now work like this:

- **Who:** what the sender does, in a few words, from their title and one-liner.
- **Skills:** only the one or two that fit this person.
- **Proof:** at most one proof point, matched to the person's industry or problem.
- **Ask:** fits the situation:
  - (a) a visible opening;
  - (b) someone who could hire, with no opening;
  - (c) a peer, with no ask for work.
- **Length:**
  - Note: 100 to 180 characters.
  - First message: 3 to 5 sentences, up to 450 characters.
  - Follow-ups: up to 300 characters, or 500 when answering a question or sharing a project.
- **Follow-ups** can share a matching project, share the portfolio link once the person shows interest, propose two call times, and answer questions about availability and the kind of work wanted. They never invent rates, start dates, years of experience or employers.

## Research round 2 (Nov 13, 2026)

Three more passes looked at agency outreach, job and freelance outreach, and follow-ups. Again the evidence is almost all vendor data or practitioner opinion. There's no controlled test of message wording, so measuring our own replies is the real test.

**Agencies (B2B)**

- **Naming the company early doesn't hurt.** Expandi: notes starting "Hello from [Company]" got 60.9% acceptance against a 30.2% baseline (2,860 contacts). That's acceptance only, not replies.
- **Length:** the best replies come at 151 to 200 characters (8.5%). 301 to 500 still gets 7.6%. Over 500 drops to 5.8% (Expandi, about 150k contacts).
- **Message 2** is the best place for the substance (8.8% per send). Three messages beat five or more (9.8% vs 5.0%).
- **Structure:** observation, then one line of who we are and what we do, then one comparable project, then an easy question. Name one service, matched to their situation.
- **Wording that hurts:** buzzwords ("AI-powered", "platform", "solutions", "leading"), listing every service, selling on price, and asking for a meeting on the first touch.
- **Offshore studios:** founders worry about risk more than price. The trust points that help are code ownership, overlap hours and senior engineers. Don't lead with location.

**Individuals (B2C)**

- **What gets people hired:**
  - Referrals and sourcing do far better than inbound applications (Ashby: 38M applications).
  - Cold referrals from strangers are filed as leads, not real referrals (interviewing.io).
- **Who to message:**
  - **Hiring managers:** name the role and give one proof.
  - **Recruiters:** a factual summary.
  - **Employees:** ask a question first, ask for a referral later.
- **Remote:** say where you're based and your time-zone overlap once. Fake remote candidates have made founders cautious, so real, checkable proof matters.
- **Never in a first message:** a rate, a résumé or an attachment.

**Follow-ups**

- **Lines that get replies but cost meetings (Gong, 304k emails):** "thoughts?" (meetings booked down 20%) and "never heard back" (down 14%).
- **No-reply angles, in order:**
  1. Something new about them
  2. A comparable project with a result
  3. A useful observation
  4. "Is someone else closer to this?"
  5. A warm close
- **When they're interested:** offer two specific times, say the call length, and say what they get from it either way.
- **Price questions:** give an honest range and what drives it. Dodging reads as evasive (Gong; Blair Enns).
- **Objections:** accept it, ask one real question, and leave a way out. Never criticise their vendor. No reverse psychology. At most one "sounds like".
- **Mirroring:** match their wording early in the conversation (Swaab et al. 2011).
- **Job follow-ups:**
  - About a week after applying.
  - Thanks within a day of an interview.
  - One gracious reply after a rejection, with an optional request for feedback.

Main new sources:

- Expandi H2 2026: https://expandi.io/state-of-linkedin-outreach-h2-2026/
- Belkins follow-up statistics: https://belkins.io/blog/sales-follow-up-statistics
- Gong follow-up wording: https://www.gong.io/blog/7-tips-for-writing-the-perfect-follow-up-sales-email-according-to-science
- Josh Braun objection flashcards (via 30 Minutes to President's Club): https://blog.contactout.io/wp-content/uploads/2023/10/30MPC-09-Sep2023-Josh-Braun-Objection-Flashcards_V2.pdf
- Ashby referrals: https://www.ashbyhq.com/talent-trends-report/reports/referrals
- interviewing.io: https://interviewing.io/blog/how-to-get-in-the-door-at-top-companies-part-1
- The Pragmatic Engineer, tech jobs market 2025: https://newsletter.pragmaticengineer.com/p/tech-jobs-market-2025-part-3
- Swaab, Maddux & Sinaceur 2011: https://willmaddux.web.unc.edu/wp-content/uploads/sites/15846/2018/04/JESP-Virtual-Linguistic-Mimicry.pdf

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
