# Eudia web study

Standalone web pilot for Best Possible Self onboarding and six short study sessions. Built for GitHub Pages; Firebase saves progress and makes server-side AI calls. Participants do not need a personal account.

## Participant flow

1. Open the anonymous study link from Prolific. The app records `PROLIFIC_PID`, `STUDY_ID`, and `SESSION_ID` from its URL.
2. Imagine and type a Best Possible Self reflection, or record one and edit its transcript, then review four editable life-domain summaries.
3. Enter yesterday's calendar events once.
4. Complete these fixed-order sessions, with the same four-item survey after every session:
   - Calendar reflection baseline, then affect and meaning reflection
   - Three fixed philosophy questions, then a philosopher-guided Eudia conversation
   - Self-guided values choice point, then a personalized five-minute Eudia challenge

Firebase anonymously assigns a browser-scoped study identity. Progress is saved under `users/{uid}/studyRuns/web-pilot-v1` in the `eudaimonia-reflection` Firebase project. The app resumes at the first unfinished session or survey in the same browser. This protocol has fixed order and no randomization. A new visit without Prolific parameters is a preview run; a participant with an existing paid run can resume from the base URL in the same browser.

## Local development

```bash
npm install
npm run dev
```

Local development uses browser-local demo storage and deterministic sample AI replies. It does not call Firebase or OpenAI, so audio transcription requires the live deployment. Build the production app with `npm run build`.

For a quick walkthrough, open a preview run with `?admin=1`. The **Admin skip** control advances through onboarding, yesterday's calendar, and each activity using clearly marked synthetic responses. It is unavailable on runs linked to a Prolific participant ID. Do not use preview responses in study analysis.

## Firebase Functions

The `functions/` directory is a separate Firebase codebase named `study`. AI calls require anonymous Firebase authentication and use the existing `OPENAI_KEY` Secret Manager secret. No AI key is sent to the browser. Function code also caps calls per participant and per day.

Best Possible Self audio is recorded in the browser, sent to a short-lived server transcription call, and inserted as editable text before submission. The raw audio is not stored in the study record. The server uses OpenAI's current [file transcription API](https://developers.openai.com/api/docs/guides/speech-to-text).

```bash
npm --prefix functions install
npm --prefix functions run build
firebase deploy --only functions:study --project eudaimonia-reflection
```

The Firebase Web SDK values in `.env.production` are public app identifiers, not server credentials. Enable the Anonymous provider in Firebase Authentication before using the deployed study.

## Prolific setup

Use the deployed Pages URL as an external study link and select **I'll use URL parameters** in Prolific. The app expects the default `PROLIFIC_PID`, `STUDY_ID`, and `SESSION_ID` parameter names. It stores them with the run so submissions can be matched later. Plain URL parameters are unverified and must not be treated as proof of eligibility. Prolific's optional Secure external URL requires separate server-side JWT verification before it can provide that assurance.

Set `VITE_PROLIFIC_COMPLETION_URL` to the exact study-specific completion URL provided by Prolific, then rebuild and redeploy. The completion link should only be available after the final survey has been saved. Without that URL, the pilot completion screen has no automatic return path. [Prolific's integration guidance](https://researcher-help.prolific.com/en/articles/445178-what-survey-experimental-software-is-compatible-with-prolific) describes anonymous access, ID capture, and completion URLs.

## Behavior data and Vertex AI

The app records meaningful transitions and action metadata as timestamped, append-only events in a Firestore subcollection of each study run. Events should include the phase, session/condition, outcome, and timing, without essay text, calendar titles, chat messages, or contact details. Full study responses remain in the owner-scoped run document. This makes a pseudonymous event table possible without exposing reflective writing in routine analytics.

Vertex AI is an analysis layer, not the event store. For analysis at scale, export a de-identified event table to BigQuery and use SQL, BigQuery notebooks, or Vertex AI there. Keep the Prolific ID mapping restricted and separate from that table. See [BigQuery's analysis tools](https://docs.cloud.google.com/bigquery/docs/programmatic-analysis) and [BigQuery AI](https://docs.cloud.google.com/bigquery/docs/generative-ai-overview).

## GitHub Pages

Vite uses `/eudia-usability/` as its production base path. The `.github/workflows/pages.yml` workflow builds and deploys `dist/` on pushes to `main`. Enable Pages with **GitHub Actions** as the publishing source for the repository. The expected URL is `https://mengyuanwu1.github.io/eudia-usability/`.

This is a pilot protocol. Replace the synthetic survey and finalize consent, research copy, completion URL, and compensation timing before participant recruitment.

The self-guided challenge baseline is inspired by the values and choice-point exercise described in [Amo and Lieder's InsightApp evaluation](https://mental.jmir.org/2025/1/e57201/). It is a brief adaptation for this web study, not a reproduction of that app or its control condition.
