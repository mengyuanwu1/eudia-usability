import * as admin from 'firebase-admin';
import { CallableRequest, HttpsError, onCall } from 'firebase-functions/v2/https';

const REGION = 'us-central1';
const RUN_ID = 'web-pilot-v1';
const DOMAINS = [
  'Work & Learning',
  'Leisure & Enjoyment',
  'Relationships',
  'Growth & Well-being',
] as const;
const SESSION_ORDER = [
  'reflection_baseline',
  'reflection_active',
  'philosophy_baseline',
  'philosophy_active',
  'challenge_baseline',
  'challenge_active',
] as const;
type SessionKey = (typeof SESSION_ORDER)[number];

interface Profile {
  essay: string;
  domains: Record<(typeof DOMAINS)[number], string>;
  goal?: string;
}

interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  notes?: string;
}

interface SurveyAnswers {
  helpful: number;
  relevant: number;
  clarity: number;
  motivation: number;
  comment?: string;
}

interface Session {
  data: unknown;
  completedAt: string;
  survey?: SurveyAnswers;
  surveySubmittedAt?: string;
}

interface StudyState {
  protocolVersion: 1;
  onboarding?: Profile;
  calendarEvents: CalendarEvent[];
  sessions: Partial<Record<SessionKey, Session>>;
}

function uidOrThrow(request: CallableRequest<unknown>): string {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to continue.');
  const firebaseClaims = request.auth?.token['firebase'] as Record<string, unknown> | undefined;
  if (firebaseClaims?.['sign_in_provider'] !== 'google.com') {
    throw new HttpsError('permission-denied', 'Use Google sign-in to join the study.');
  }
  return uid;
}

function runRef(uid: string): admin.firestore.DocumentReference {
  return admin.firestore().collection('users').doc(uid)
    .collection('studyRuns').doc(RUN_ID);
}

function emptyState(): StudyState {
  return { protocolVersion: 1, calendarEvents: [], sessions: {} };
}

function stateFrom(data: admin.firestore.DocumentData | undefined): StudyState {
  if (!data) return emptyState();
  return {
    protocolVersion: 1,
    onboarding: data['onboarding'] as Profile | undefined,
    calendarEvents: Array.isArray(data['calendarEvents'])
      ? data['calendarEvents'] as CalendarEvent[] : [],
    sessions: data['sessions'] && typeof data['sessions'] === 'object'
      ? data['sessions'] as StudyState['sessions'] : {},
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function cleanText(value: unknown, max: number, name: string): string {
  if (typeof value !== 'string') {
    throw new HttpsError('invalid-argument', `${name} must be text.`);
  }
  const text = value.trim();
  if (text.length > max) {
    throw new HttpsError('invalid-argument', `${name} is too long.`);
  }
  return text;
}

function parseProfile(value: unknown): Profile {
  const raw = asRecord(value);
  const essay = cleanText(raw['essay'], 12000, 'Best Possible Self');
  if (!essay) {
    throw new HttpsError('invalid-argument', 'Write your Best Possible Self first.');
  }
  const rawDomains = asRecord(raw['domains']);
  const domains = Object.fromEntries(DOMAINS.map((domain) => [
    domain, cleanText(rawDomains[domain] ?? '', 3000, domain),
  ])) as Profile['domains'];
  const goal = cleanText(raw['goal'] ?? '', 1000, 'Goal');
  return { essay, domains, ...(goal ? { goal } : {}) };
}

function parseCalendarEvents(value: unknown): CalendarEvent[] {
  if (!Array.isArray(value) || value.length > 50) {
    throw new HttpsError('invalid-argument', 'Calendar must contain at most 50 events.');
  }
  const ids = new Set<string>();
  return value.map((item, index) => {
    const raw = asRecord(item);
    const id = cleanText(raw['id'], 120, `Event ${index + 1} ID`);
    const title = cleanText(raw['title'], 200, `Event ${index + 1} title`);
    const start = cleanText(raw['start'], 50, `Event ${index + 1} start`);
    const end = cleanText(raw['end'], 50, `Event ${index + 1} end`);
    const notes = cleanText(raw['notes'] ?? '', 1000, `Event ${index + 1} notes`);
    if (!id || !title || !start || !end || ids.has(id)) {
      throw new HttpsError('invalid-argument', `Event ${index + 1} is incomplete or repeated.`);
    }
    ids.add(id);
    const startMs = Date.parse(start);
    const endMs = Date.parse(end);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      throw new HttpsError('invalid-argument', `Event ${index + 1} has invalid times.`);
    }
    return { id, title, start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString(), ...(notes ? { notes } : {}) };
  });
}

function parseSessionKey(value: unknown): SessionKey {
  if (typeof value !== 'string' || !SESSION_ORDER.includes(value as SessionKey)) {
    throw new HttpsError('invalid-argument', 'Unknown study session.');
  }
  return value as SessionKey;
}

function parseSessionData(value: unknown): unknown {
  if (value === undefined || value === null) {
    throw new HttpsError('invalid-argument', 'Session response is missing.');
  }
  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw new HttpsError('invalid-argument', 'Session response is invalid.');
  }
  if (!encoded || encoded.length > 80000) {
    throw new HttpsError('invalid-argument', 'Session response is too long.');
  }
  return JSON.parse(encoded) as unknown;
}

function parseSurvey(value: unknown): SurveyAnswers {
  const raw = asRecord(value);
  const rating = (name: keyof SurveyAnswers): number => {
    const result = raw[name];
    if (typeof result !== 'number' || !Number.isInteger(result) || result < 1 || result > 7) {
      throw new HttpsError('invalid-argument', `${name} must be a 1–7 rating.`);
    }
    return result;
  };
  const comment = cleanText(raw['comment'] ?? '', 1000, 'Comment');
  return {
    helpful: rating('helpful'),
    relevant: rating('relevant'),
    clarity: rating('clarity'),
    motivation: rating('motivation'),
    ...(comment ? { comment } : {}),
  };
}

export const studyGetState = onCall({ region: REGION }, async (request) => {
  const ref = runRef(uidOrThrow(request));
  return admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) return stateFrom(snap.data());
    const state = emptyState();
    tx.set(ref, {
      ...state,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return state;
  });
});

export const studySaveOnboarding = onCall({ region: REGION }, async (request) => {
  const uid = uidOrThrow(request);
  const profile = parseProfile(asRecord(request.data)['data']);
  const ref = runRef(uid);
  return admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const state = stateFrom(snap.data());
    if (Object.keys(state.sessions).length) {
      throw new HttpsError('failed-precondition', 'Onboarding is locked after the first session.');
    }
    const next = { ...state, onboarding: profile };
    tx.set(ref, { ...next, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    return next;
  });
});

export const studySaveCalendarEvents = onCall({ region: REGION }, async (request) => {
  const uid = uidOrThrow(request);
  const events = parseCalendarEvents(asRecord(request.data)['events']);
  const ref = runRef(uid);
  return admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const state = stateFrom(snap.data());
    if (!state.onboarding) {
      throw new HttpsError('failed-precondition', 'Finish onboarding first.');
    }
    if (Object.keys(state.sessions).length) {
      throw new HttpsError('failed-precondition', 'Calendar is locked after the first session.');
    }
    const next = { ...state, calendarEvents: events };
    tx.set(ref, { ...next, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    return next;
  });
});

export const studySaveSession = onCall({ region: REGION }, async (request) => {
  const uid = uidOrThrow(request);
  const raw = asRecord(request.data);
  const key = parseSessionKey(raw['key']);
  const data = parseSessionData(raw['data']);
  const ref = runRef(uid);
  return admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const state = stateFrom(snap.data());
    if (!state.onboarding) {
      throw new HttpsError('failed-precondition', 'Finish onboarding first.');
    }
    if (!state.calendarEvents.length) {
      throw new HttpsError('failed-precondition', 'Enter yesterday’s calendar events first.');
    }
    const index = SESSION_ORDER.indexOf(key);
    for (const prior of SESSION_ORDER.slice(0, index)) {
      if (!state.sessions[prior]?.survey) {
        throw new HttpsError('failed-precondition', 'Finish the previous survey first.');
      }
    }
    const previous = state.sessions[key];
    if (previous?.survey) {
      throw new HttpsError('failed-precondition', 'Session already finished.');
    }
    const sessions = {
      ...state.sessions,
      [key]: { data, completedAt: previous?.completedAt ?? new Date().toISOString() },
    };
    const next = { ...state, sessions };
    tx.set(ref, { sessions, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    return next;
  });
});

export const studySaveSurvey = onCall({ region: REGION }, async (request) => {
  const uid = uidOrThrow(request);
  const raw = asRecord(request.data);
  const key = parseSessionKey(raw['key']);
  const answers = parseSurvey(raw['answers']);
  const ref = runRef(uid);
  return admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const state = stateFrom(snap.data());
    const session = state.sessions[key];
    if (!session) {
      throw new HttpsError('failed-precondition', 'Finish this session before its survey.');
    }
    if (session.survey) {
      if (JSON.stringify(session.survey) === JSON.stringify(answers)) return state;
      throw new HttpsError('failed-precondition', 'Survey already submitted.');
    }
    const sessions = {
      ...state.sessions,
      [key]: { ...session, survey: answers, surveySubmittedAt: new Date().toISOString() },
    };
    const next = { ...state, sessions };
    tx.set(ref, { sessions, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    return next;
  });
});
