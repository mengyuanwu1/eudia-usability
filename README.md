# Eudia web study

Standalone web pilot for Best Possible Self onboarding and six short study sessions. Built for GitHub Pages; Firebase provides participant sign-in, saved progress, and server-side AI calls.

## Participant flow

1. Sign in with Google.
2. Imagine and write a Best Possible Self reflection, then review four editable life-domain summaries.
3. Enter yesterday's calendar events once.
4. Complete these fixed-order sessions, with the same four-item survey after every session:
   - Calendar reflection baseline, then affect and meaning reflection
   - Three fixed philosophy questions, then a philosopher-guided Eudia conversation
   - Self-guided values choice point, then a personalized five-minute Eudia challenge

Progress is saved under `users/{uid}/studyRuns/web-pilot-v1` in the `eudaimonia-reflection` Firebase project. The app resumes at the first unfinished session or survey. This protocol has fixed order and no randomization.

## Local development

```bash
npm install
npm run dev
```

Local development uses browser-local demo storage and deterministic sample AI replies. It does not call Firebase or OpenAI. Build the production app with `npm run build`.

## Firebase Functions

The `functions/` directory is a separate Firebase codebase named `study`. AI calls require Firebase authentication and use the existing `OPENAI_KEY` Secret Manager secret. No AI key is sent to the browser. Function code also caps calls per participant and per day.

```bash
npm --prefix functions install
npm --prefix functions run build
firebase deploy --only functions:study --project eudaimonia-reflection
```

The Firebase Web SDK values in `.env.production` are public app identifiers, not server credentials. Google sign-in needs the deployed Pages hostname in Firebase Authentication authorized domains.

## GitHub Pages

Vite uses `/eudia-usability/` as its production base path. The `.github/workflows/pages.yml` workflow builds and deploys `dist/` on pushes to `main`. Enable Pages with **GitHub Actions** as the publishing source for the repository. The expected URL is `https://mengyuanwu1.github.io/eudia-usability/`.

This is a pilot protocol. Replace the synthetic survey and finalize research copy before participant recruitment.

The self-guided challenge baseline is inspired by the values and choice-point exercise described in [Amo and Lieder's InsightApp evaluation](https://mental.jmir.org/2025/1/e57201/). It is a brief adaptation for this web study, not a reproduction of that app or its control condition.
