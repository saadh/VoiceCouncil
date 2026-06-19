# VoiceCouncil 🎙️⚖️

**AI Interview Panel** — practice high-stakes interviews against a multi-model AI panel that grills you by voice, then confers and hands back a scored feedback report.

Built for the Voice AI Hackathon. Lead vertical: **tech / behavioral job interviews**. Expansion: consulting case interviews → PhD viva → medical boards (same engine, swappable persona pack + question bank).

## How it works

1. Upload a **job description + resume** → the panel tailors its questions to *you*.
2. A **3-persona panel** interviews you by voice (turn-based):
   - **Hiring Manager** — behavioral ("tell me about a time…")
   - **Domain Expert** — deep technical follow-ups
   - **Bar-raiser / Skeptic** — pressure-tests weak answers
3. After the session the panel **deliberates** → a **scorecard** (communication, depth, structure, red flags) + top-3 things to fix.

## Stack

| Layer | Tool |
|---|---|
| Voice (telephony, STT/TTS, turn-taking, barge-in) | **Vapi** |
| Panelist personas + final deliberation (multi-model) | **Nebius Token Factory** |
| Backend: resume/JD storage, sessions, scorecards | **Insforge** |
| Panel UI + live feedback report | Web dashboard |

**Architecture:** Vapi → custom LLM endpoint (on Insforge) → routes each panelist turn to a Nebius model; at session end, fans out to all models for the deliberation/scorecard. Turn-based interview = no risky parallel fan-out mid-conversation, so latency stays low.

## Repo layout

```
/backend     — custom LLM endpoint + Insforge integration (Nebius calls, scorecard logic)
/frontend    — panel dashboard + live feedback report
/vapi        — Vapi assistant config, system prompts, tool definitions
/docs        — pitch, demo script, persona packs
```

## Getting started

> ⚠️ Credits: each teammate has **$100 Nebius**, **$50 Vapi**, **$25 Insforge**. Put keys in `.env` (never commit them).

```bash
cp .env.example .env   # fill in API keys
```

## Team

- (add names / GitHub handles)
