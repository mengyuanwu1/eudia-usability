import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInAnonymously, signOut, type User } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';

export const DOMAINS = [
  'Work & Learning',
  'Leisure & Enjoyment',
  'Relationships',
  'Growth & Well-being',
] as const;

export type Domain = (typeof DOMAINS)[number];
export type DomainSummaries = Record<Domain, string>;
export type SessionKey =
  | 'reflection_baseline'
  | 'reflection_active'
  | 'philosophy_baseline'
  | 'philosophy_active'
  | 'challenge_baseline'
  | 'challenge_active';

export const SESSION_ORDER: SessionKey[] = [
  'reflection_baseline',
  'reflection_active',
  'philosophy_baseline',
  'philosophy_active',
  'challenge_baseline',
  'challenge_active',
];

export interface ParticipantProfile {
  essay: string;
  domains: DomainSummaries;
  goal?: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  notes?: string;
}

export interface SurveyAnswers {
  helpful: number;
  relevant: number;
  clarity: number;
  motivation: number;
  comment?: string;
}

export interface StudySession {
  data: unknown;
  completedAt: string;
  survey?: SurveyAnswers;
  surveySubmittedAt?: string;
}

export interface StudyState {
  protocolVersion: number;
  onboarding?: ParticipantProfile;
  calendarEvents: CalendarEvent[];
  sessions: Partial<Record<SessionKey, StudySession>>;
  launchContext?: StoredLaunchContext;
}

export interface LaunchContext {
  prolificPid?: string;
  studyId?: string;
  sessionId?: string;
  source: 'prolific' | 'preview';
  error?: string;
}

export interface StoredLaunchContext extends LaunchContext {
  verified: false;
  capturedAt: string;
}

export type StudyEventName =
  | 'study_screen_view'
  | 'activity_started'
  | 'activity_completed'
  | 'survey_submitted'
  | 'calendar_saved'
  | 'onboarding_saved'
  | 'ai_request'
  | 'challenge_started'
  | 'challenge_returned'
  | 'completion_redirect'
  | 'study_resumed'
  | 'visibility_changed';

export interface StudyEventMetadata {
  screen?: 'signin' | 'onboarding' | 'onboarding_intro' | 'onboarding_imagery' |
    'onboarding_essay' | 'onboarding_domains' | 'calendar' | 'session' | 'survey' | 'complete';
  sessionKey?: SessionKey;
  count?: number;
  operation?: 'categorize_bps' | 'recommend_philosopher' | 'philosophy_turn' | 'generate_challenge';
  outcome?: 'success' | 'error' | 'done' | 'partly' | 'not_today';
  visibility?: 'visible' | 'hidden';
  latencyMs?: number;
  elapsedSeconds?: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface Philosopher {
  id: string;
  name: string;
  education: string;
}

export interface PhilosopherRecommendation extends Philosopher {
  reason: string;
}

export interface GeneratedChallenge {
  title: string;
  action: string;
  why: string;
  durationMinutes: 5;
}

export interface StudyUser {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
}

export const PHILOSOPHERS: Philosopher[] = [
  {
    id: 'aristotle',
    name: 'Aristotle',
    education:
      'Aristotle explored how repeated choices shape character and how a flourishing life grows through purposeful activity and relationships.',
  },
  {
    id: 'epictetus',
    name: 'Epictetus',
    education:
      'Epictetus asked people to distinguish what they can choose from what lies outside their control, then practice acting well within that space.',
  },
  {
    id: 'simone_de_beauvoir',
    name: 'Simone de Beauvoir',
    education:
      'Simone de Beauvoir examined freedom as something lived through choices, commitments, and responsibility toward other people.',
  },
  {
    id: 'confucius',
    name: 'Confucius',
    education:
      'Confucius emphasized learning, everyday conduct, and the care shown in relationships as ways to cultivate a good life.',
  },
];

export const getPhilosophers = (): Philosopher[] => PHILOSOPHERS;

const backendMode =
  import.meta.env.VITE_STUDY_BACKEND_MODE ?? (import.meta.env.DEV ? 'demo' : 'firebase');
const STORAGE_KEY = 'eudia-study-web-v1';
const LAUNCH_KEY = 'eudia-study-prolific-launch-v1';

function launchValue(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed && /^[A-Za-z0-9_-]{1,128}$/.test(trimmed) ? trimmed : undefined;
}

function validProlificPid(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed && /^[A-Za-z0-9]{24}$/.test(trimmed) ? trimmed : undefined;
}

function captureLaunchContext(): LaunchContext {
  if (typeof window === 'undefined') return { source: 'preview' };
  const url = new URL(window.location.href);
  const names = ['PROLIFIC_PID', 'STUDY_ID', 'SESSION_ID'] as const;
  const hasQuery = names.some((name) => url.searchParams.has(name));
  if (hasQuery) {
    const prolificPid = validProlificPid(url.searchParams.get('PROLIFIC_PID'));
    const studyId = launchValue(url.searchParams.get('STUDY_ID'));
    const sessionId = launchValue(url.searchParams.get('SESSION_ID'));
    const optionalIdsValid =
      (!url.searchParams.has('STUDY_ID') || !!studyId) &&
      (!url.searchParams.has('SESSION_ID') || !!sessionId);
    const context: LaunchContext = prolificPid && optionalIdsValid
      ? { prolificPid, ...(studyId ? { studyId } : {}),
          ...(sessionId ? { sessionId } : {}), source: 'prolific' }
      : { source: 'preview', error: 'Invalid Prolific participant link.' };
    if (context.source === 'prolific') {
      sessionStorage.setItem(LAUNCH_KEY, JSON.stringify(context));
    } else {
      sessionStorage.removeItem(LAUNCH_KEY);
    }
    for (const name of names) url.searchParams.delete(name);
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    return context;
  }
  try {
    const raw = sessionStorage.getItem(LAUNCH_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const prolificPid = validProlificPid(
        typeof parsed.prolificPid === 'string' ? parsed.prolificPid : null,
      );
      const context: LaunchContext = {
        prolificPid,
        studyId: launchValue(typeof parsed.studyId === 'string' ? parsed.studyId : null),
        sessionId: launchValue(typeof parsed.sessionId === 'string' ? parsed.sessionId : null),
        source: 'prolific',
      };
      if (prolificPid) return context;
      sessionStorage.removeItem(LAUNCH_KEY);
    }
  } catch {
    // Invalid cached launch metadata is ignored; no raw URL is retained.
  }
  return { source: 'preview' };
}

const launchContext = captureLaunchContext();
export function getLaunchContext(): LaunchContext {
  return { ...launchContext };
}
const emptyState = (): StudyState => ({
  protocolVersion: 1,
  calendarEvents: [],
  sessions: {},
});

function demoState(): StudyState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as Partial<StudyState>;
    return {
      protocolVersion: 1,
      onboarding: parsed.onboarding,
      calendarEvents: Array.isArray(parsed.calendarEvents) ? parsed.calendarEvents : [],
      sessions: parsed.sessions ?? {},
      launchContext: parsed.launchContext,
    };
  } catch {
    return emptyState();
  }
}

function saveDemoState(state: StudyState): StudyState {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  return state;
}

function authInstance() {
    const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
    const appId = import.meta.env.VITE_FIREBASE_APP_ID;
    const apiKey = import.meta.env.VITE_FIREBASE_API_KEY;
    const authDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN;
    if (!projectId || !appId || !apiKey || !authDomain) {
      throw new Error('Study backend configuration is missing. Contact the study team.');
    }
    const app = getApps().length
      ? getApp()
      : initializeApp({ projectId, appId, apiKey, authDomain });
    return getAuth(app);
}

function publicUser(user: User): StudyUser {
  return {
    uid: user.uid,
    displayName: user.displayName,
    email: user.email,
    photoURL: user.photoURL,
  };
}

let resolvingUser: Promise<StudyUser | null> | null = null;

export async function getCurrentUser(): Promise<StudyUser | null> {
  if (backendMode === 'demo') {
    return { uid: 'demo', displayName: 'Demo participant', email: null, photoURL: null };
  }
  if (!resolvingUser) {
    resolvingUser = (async () => {
      const auth = authInstance();
      const user = await new Promise<User | null>((resolve) => {
        let unsubscribe = () => {};
        unsubscribe = onAuthStateChanged(auth, (current) => {
          unsubscribe();
          resolve(current);
        }, () => {
          unsubscribe();
          resolve(null);
        });
      });
      if (user?.isAnonymous) return publicUser(user);
      if (user) await signOut(auth);
      return publicUser((await signInAnonymously(auth)).user);
    })().finally(() => {
      resolvingUser = null;
    });
  }
  return resolvingUser;
}

export async function signIn(): Promise<StudyUser> {
  if (backendMode === 'demo') return (await getCurrentUser())!;
  return (await getCurrentUser())!;
}

export async function signOutStudy(): Promise<void> {
  if (backendMode === 'demo') return;
  await signOut(authInstance());
}

async function studyUser(): Promise<StudyUser> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Study session could not start. Try reloading.');
  return user;
}

async function callStudy<T>(name: string, data: unknown): Promise<T> {
  await studyUser();
  const app = getApp();
  const fn = httpsCallable<unknown, T>(getFunctions(app, 'us-central1'), name);
  const result = await fn(data);
  return result.data;
}

function cleanState(value: StudyState): StudyState {
  return {
    protocolVersion: 1,
    onboarding: value.onboarding,
    calendarEvents: Array.isArray(value.calendarEvents) ? value.calendarEvents : [],
    sessions: value.sessions ?? {},
    launchContext: value.launchContext,
  };
}

export async function getStudy(): Promise<StudyState> {
  if (backendMode === 'demo') {
    const state = demoState();
    if (!state.launchContext && launchContext.source === 'prolific') {
      state.launchContext = { ...launchContext, verified: false, capturedAt: new Date().toISOString() };
      saveDemoState(state);
    }
    return state;
  }
  const state = await callStudy<StudyState>('studyGetState', { launchContext });
  return cleanState(state);
}

export async function trackEvent(
  name: StudyEventName,
  metadata: StudyEventMetadata = {},
): Promise<void> {
  if (backendMode === 'demo') return;
  await callStudy<{ ok: true }>('studyLogEvent', { name, metadata });
}

export async function saveOnboarding(data: ParticipantProfile): Promise<StudyState> {
  if (backendMode === 'demo') return saveDemoState({ ...demoState(), onboarding: data });
  return cleanState(await callStudy<StudyState>('studySaveOnboarding', { data }));
}

export async function saveCalendarEvents(events: CalendarEvent[]): Promise<StudyState> {
  if (backendMode === 'demo') return saveDemoState({ ...demoState(), calendarEvents: events });
  return cleanState(await callStudy<StudyState>('studySaveCalendarEvents', { events }));
}

export async function saveSession(key: SessionKey, data: unknown): Promise<StudyState> {
  if (backendMode === 'demo') {
    const state = demoState();
    const previous = state.sessions[key];
    return saveDemoState({
      ...state,
      sessions: {
        ...state.sessions,
        [key]: { ...previous, data, completedAt: previous?.completedAt ?? new Date().toISOString() },
      },
    });
  }
  return cleanState(await callStudy<StudyState>('studySaveSession', { key, data }));
}

export async function saveSurvey(key: SessionKey, answers: SurveyAnswers): Promise<StudyState> {
  if (backendMode === 'demo') {
    const state = demoState();
    const session = state.sessions[key];
    if (!session) throw new Error('Finish the session before its survey.');
    return saveDemoState({
      ...state,
      sessions: {
        ...state.sessions,
        [key]: { ...session, survey: answers, surveySubmittedAt: new Date().toISOString() },
      },
    });
  }
  return cleanState(await callStudy<StudyState>('studySaveSurvey', { key, answers }));
}

function demoCategories(essay: string): DomainSummaries {
  const sentences = essay.match(/[^.!?]+[.!?]?/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
  const result = Object.fromEntries(DOMAINS.map((domain) => [domain, ''])) as DomainSummaries;
  const patterns: Record<Domain, RegExp> = {
    'Work & Learning': /work|career|job|study|learn|school|business|create|research/i,
    'Leisure & Enjoyment': /leisure|play|fun|travel|hobby|music|art|enjoy|rest/i,
    Relationships: /friend|family|partner|love|community|connect|relationship/i,
    'Growth & Well-being': /grow|health|well|exercise|mind|body|develop|improve/i,
  };
  for (const sentence of sentences) {
    const match = DOMAINS.find((domain) => patterns[domain].test(sentence));
    const domain = match ?? 'Growth & Well-being';
    result[domain] = [result[domain], sentence].filter(Boolean).join(' ');
  }
  return result;
}

export async function categorizeBps(essay: string): Promise<DomainSummaries> {
  if (backendMode === 'demo') return demoCategories(essay);
  const result = await callStudy<{ domains: DomainSummaries }>('studyCategorizeBps', { essay });
  return result.domains;
}

export async function recommendPhilosopher(
  profile: ParticipantProfile,
): Promise<PhilosopherRecommendation> {
  if (backendMode === 'demo') {
    const text = `${profile.essay} ${Object.values(profile.domains).join(' ')}`;
    const match = /family|friend|relationship|community/i.test(text)
      ? PHILOSOPHERS[3]
      : /control|stress|uncertain|anxious/i.test(text)
        ? PHILOSOPHERS[1]
        : PHILOSOPHERS[0];
    return { ...match, reason: `This perspective may connect with the direction you described.` };
  }
  return callStudy<PhilosopherRecommendation>('studyRecommendPhilosopher', { profile });
}

export async function runPhilosophy(input: {
  philosopher: string;
  messages: ChatMessage[];
  profile: ParticipantProfile;
}): Promise<{ reply: string }> {
  if (backendMode === 'demo') {
    const last = [...input.messages].reverse().find((message) => message.role === 'user')?.content;
    const excerpt = last?.trim().slice(0, 120).replace(/[.!?…]+$/u, '');
    return {
      reply: excerpt
        ? `What does “${excerpt}” reveal about the way you want to live?`
        : `What part of your best possible self feels most important to you right now?`,
    };
  }
  return callStudy<{ reply: string }>('studyPhilosophyTurn', input);
}

export async function generateChallenge(input: {
  goal: string;
  situation: string;
  profile: ParticipantProfile;
}): Promise<GeneratedChallenge> {
  if (backendMode === 'demo') {
    return {
      title: 'One small move',
      action: `Spend five minutes making one concrete step toward ${input.goal.trim() || 'your goal'} in your current situation.`,
      why: 'A small action can make your chosen direction tangible today.',
      durationMinutes: 5,
    };
  }
  return callStudy<GeneratedChallenge>('studyGenerateChallenge', input);
}
