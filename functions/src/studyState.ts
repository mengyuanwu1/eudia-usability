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
const EVENT_NAMES = [
  'study_screen_view', 'activity_started', 'activity_completed',
  'survey_submitted', 'calendar_saved', 'ai_request',
  'challenge_started', 'challenge_returned',
  'onboarding_saved', 'completion_redirect',
  'study_resumed', 'visibility_changed',
  'admin_skip',
] as const;
type StudyEventName = (typeof EVENT_NAMES)[number];
const SCREEN_NAMES = [
  'signin', 'onboarding', 'onboarding_intro', 'onboarding_imagery',
  'onboarding_essay', 'onboarding_domains', 'calendar', 'session',
  'survey', 'complete',
] as const;
const AI_OPERATIONS = [
  'categorize_bps', 'recommend_philosopher', 'philosophy_turn',
  'generate_challenge', 'transcribe_bps',
] as const;
const OUTCOMES = ['success', 'error', 'done', 'partly', 'not_today'] as const;
const VISIBILITY_STATES = ['visible', 'hidden'] as const;

interface Profile {
  essay: string;
  domains: Record<(typeof DOMAINS)[number], string>;
  goal?: string;
  adminSkipped?: true;
}

interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  notes?: string;
  adminSkipped?: true;
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
  launchContext?: StoredLaunchContext;
}

interface StoredLaunchContext {
  prolificPid?: string;
  studyId?: string;
  sessionId?: string;
  source: 'prolific';
  verified: false;
  capturedAt: string;
}

function uidOrThrow(request: CallableRequest<unknown>): string {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to continue.');
  const firebaseClaims = request.auth?.token['firebase'] as Record<string, unknown> | undefined;
  if (!['google.com', 'anonymous'].includes(String(firebaseClaims?.['sign_in_provider'] ?? ''))) {
    throw new HttpsError('permission-denied', 'Use the study sign-in to continue.');
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
    launchContext: data['launchContext'] as StoredLaunchContext | undefined,
  };
}

function parseLaunchContext(value: unknown): StoredLaunchContext | null {
  const raw = asRecord(value);
  if (raw['source'] !== 'prolific') return null;
  const id = (name: 'prolificPid' | 'studyId' | 'sessionId'): string | undefined => {
    const input = raw[name];
    if (input === undefined || input === null || input === '') return undefined;
    if (typeof input !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(input)) {
      throw new HttpsError('invalid-argument', `Invalid ${name} launch parameter.`);
    }
    return input;
  };
  const prolificPid = id('prolificPid');
  const studyId = id('studyId');
  const sessionId = id('sessionId');
  if (!prolificPid || !/^[A-Za-z0-9]{24}$/.test(prolificPid)) {
    throw new HttpsError('invalid-argument', 'A valid Prolific participant ID is required.');
  }
  return {
    ...(prolificPid ? { prolificPid } : {}),
    ...(studyId ? { studyId } : {}),
    ...(sessionId ? { sessionId } : {}),
    source: 'prolific',
    verified: false,
    capturedAt: new Date().toISOString(),
  };
}

function parseEventName(value: unknown): StudyEventName {
  if (typeof value !== 'string' || !EVENT_NAMES.includes(value as StudyEventName)) {
    throw new HttpsError('invalid-argument', 'Unknown study event.');
  }
  return value as StudyEventName;
}

function parseEventMetadata(name: StudyEventName, value: unknown): Record<string, string | number> {
  const raw = asRecord(value);
  const allowedKeys = new Set([
    'screen', 'sessionKey', 'count', 'operation', 'outcome',
    'latencyMs', 'elapsedSeconds', 'visibility',
  ]);
  if (Object.keys(raw).some((key) => !allowedKeys.has(key))) {
    throw new HttpsError('invalid-argument', 'Event metadata contains an unsupported field.');
  }
  if (name === 'admin_skip' && Object.keys(raw).some((key) =>
    key !== 'screen' && key !== 'sessionKey')) {
    throw new HttpsError('invalid-argument', 'Admin skip records only screen or session key.');
  }
  const parsed: Record<string, string | number> = {};
  const enumField = (key: string, allowed: readonly string[]) => {
    if (raw[key] === undefined) return;
    if (typeof raw[key] !== 'string' || !allowed.includes(raw[key])) {
      throw new HttpsError('invalid-argument', `Invalid ${key} event metadata.`);
    }
    parsed[key] = raw[key];
  };
  const intField = (key: string, maximum: number) => {
    if (raw[key] === undefined) return;
    if (typeof raw[key] !== 'number' || !Number.isInteger(raw[key]) || raw[key] < 0 || raw[key] > maximum) {
      throw new HttpsError('invalid-argument', `Invalid ${key} event metadata.`);
    }
    parsed[key] = raw[key];
  };
  enumField('screen', SCREEN_NAMES);
  enumField('sessionKey', SESSION_ORDER);
  enumField('operation', AI_OPERATIONS);
  enumField('outcome', OUTCOMES);
  enumField('visibility', VISIBILITY_STATES);
  intField('count', 50);
  intField('latencyMs', 120000);
  intField('elapsedSeconds', 3600);
  if (name === 'study_screen_view' && !parsed['screen']) {
    throw new HttpsError('invalid-argument', 'Screen is required.');
  }
  if (['activity_started', 'activity_completed', 'survey_submitted',
    'challenge_started', 'challenge_returned'].includes(name) && !parsed['sessionKey']) {
    throw new HttpsError('invalid-argument', 'Session key is required.');
  }
  if (name === 'calendar_saved' && parsed['count'] === undefined) {
    throw new HttpsError('invalid-argument', 'Event count is required.');
  }
  if (name === 'ai_request' && (!parsed['operation'] || !parsed['outcome'])) {
    throw new HttpsError('invalid-argument', 'AI operation and outcome are required.');
  }
  if (name === 'visibility_changed' && !parsed['visibility']) {
    throw new HttpsError('invalid-argument', 'Visibility state is required.');
  }
  if (name === 'admin_skip' && !parsed['screen'] && !parsed['sessionKey']) {
    throw new HttpsError('invalid-argument', 'Admin skip target is required.');
  }
  return parsed;
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
  if (raw['adminSkipped'] !== undefined && typeof raw['adminSkipped'] !== 'boolean') {
    throw new HttpsError('invalid-argument', 'Invalid admin skip marker.');
  }
  return { essay, domains, ...(goal ? { goal } : {}),
    ...(raw['adminSkipped'] === true ? { adminSkipped: true as const } : {}) };
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
    if (raw['adminSkipped'] !== undefined && typeof raw['adminSkipped'] !== 'boolean') {
      throw new HttpsError('invalid-argument', `Event ${index + 1} has invalid admin skip marker.`);
    }
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
      end: new Date(endMs).toISOString(), ...(notes ? { notes } : {}),
      ...(raw['adminSkipped'] === true ? { adminSkipped: true as const } : {}) };
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
  const launchContext = parseLaunchContext(asRecord(request.data)['launchContext']);
  return admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      const state = stateFrom(snap.data());
      if (state.launchContext && launchContext && (
        state.launchContext.prolificPid !== launchContext.prolificPid ||
        state.launchContext.studyId !== launchContext.studyId ||
        state.launchContext.sessionId !== launchContext.sessionId
      )) {
        throw new HttpsError('failed-precondition',
          'This browser has a different participant session. Use a separate browser profile.');
      }
      if (state.launchContext || !launchContext) return state;
      throw new HttpsError('failed-precondition',
        'A preview study already exists in this browser. Use a separate browser profile.');
    }
    const state = { ...emptyState(), ...(launchContext ? { launchContext } : {}) };
    tx.set(ref, {
      ...state,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return state;
  });
});

export const studyLogEvent = onCall({ region: REGION }, async (request) => {
  const uid = uidOrThrow(request);
  const raw = asRecord(request.data);
  const name = parseEventName(raw['name']);
  const metadata = parseEventMetadata(name, raw['metadata']);
  const db = admin.firestore();
  const ref = runRef(uid);
  const quotaRef = db.collection('studyEventQuota').doc(uid);
  const eventRef = ref.collection('events').doc();
  await db.runTransaction(async (tx) => {
    const [runSnap, quotaSnap] = await Promise.all([tx.get(ref), tx.get(quotaRef)]);
    if (!runSnap.exists) {
      throw new HttpsError('failed-precondition', 'Open the study before logging events.');
    }
    if (name === 'admin_skip' && stateFrom(runSnap.data()).launchContext) {
      throw new HttpsError('permission-denied', 'Admin skip is unavailable in participant studies.');
    }
    const quota = asRecord(quotaSnap.data());
    const total = Number(quota['total'] ?? 0);
    if (!Number.isFinite(total) || total >= 500) {
      throw new HttpsError('resource-exhausted', 'Study event limit reached.');
    }
    const now = Date.now();
    const minuteStart = Number(quota['minuteStart'] ?? 0);
    const minuteCount = now - minuteStart < 60000 ? Number(quota['minuteCount'] ?? 0) : 0;
    if (!Number.isFinite(minuteCount) || minuteCount >= 60) {
      throw new HttpsError('resource-exhausted', 'Too many study events.');
    }
    tx.create(eventRef, {
      name,
      metadata,
      protocolVersion: 1,
      recordedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    tx.set(quotaRef, {
      total: total + 1,
      minuteStart: minuteCount === 0 ? now : minuteStart,
      minuteCount: minuteCount + 1,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  });
  return { ok: true };
});

export const studySaveOnboarding = onCall({ region: REGION }, async (request) => {
  const uid = uidOrThrow(request);
  const profile = parseProfile(asRecord(request.data)['data']);
  const ref = runRef(uid);
  return admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const state = stateFrom(snap.data());
    if (state.launchContext && (profile.adminSkipped ||
      profile.essay.startsWith('Preview admin skip:'))) {
      throw new HttpsError('permission-denied', 'Admin skip is unavailable in participant studies.');
    }
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
    if (state.launchContext && events.some((event) =>
      event.adminSkipped || event.id.startsWith('preview-admin-'))) {
      throw new HttpsError('permission-denied', 'Admin skip is unavailable in participant studies.');
    }
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
    const sessionData = asRecord(data);
    if (state.launchContext &&
      (sessionData['adminSkipped'] === true || sessionData['preview'] === true)) {
      throw new HttpsError('permission-denied', 'Admin skip is unavailable in participant studies.');
    }
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
