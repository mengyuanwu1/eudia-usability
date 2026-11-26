import { useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import {
  DOMAINS,
  SESSION_ORDER,
  categorizeBps,
  generateChallenge,
  getCurrentUser,
  getPhilosophers,
  getStudy,
  recommendPhilosopher,
  runPhilosophy,
  saveCalendarEvents,
  saveOnboarding,
  saveSession,
  saveSurvey,
  signIn,
  signOutStudy,
  type CalendarEvent,
  type ChatMessage,
  type Domain,
  type DomainSummaries,
  type GeneratedChallenge,
  type ParticipantProfile,
  type PhilosopherRecommendation,
  type SessionKey,
  type StudyState,
  type StudyUser,
  type SurveyAnswers,
} from './studyApi';

const avatarUrl = `${import.meta.env.BASE_URL}eudia.png`;
const FIXED_PHILOSOPHY_QUESTIONS = [
  'What does it mean to live a good life?',
  'Can a difficult experience still be meaningful? Why?',
  'How should someone decide what matters most when values conflict?',
];
const SURVEY_QUESTIONS: Array<{ key: keyof Omit<SurveyAnswers, 'comment'>; label: string }> = [
  { key: 'helpful', label: 'How useful was this activity for you?' },
  { key: 'relevant', label: 'How relevant did it feel to your life?' },
  { key: 'clarity', label: 'How much clarity do you have about what matters to you right now?' },
  { key: 'motivation', label: 'How ready do you feel to take a small next step?' },
];
const SESSION_LABELS: Record<SessionKey, string> = {
  reflection_baseline: 'Calendar reflection',
  reflection_active: 'Affect & meaning reflection',
  philosophy_baseline: 'Philosophy questions',
  philosophy_active: 'Philosophical conversation',
  challenge_baseline: 'Choice point',
  challenge_active: 'Five-minute challenge',
};
const SESSION_GROUPS = ['Reflection', 'Philosophy', 'Five-minute action'];

type OnboardingStage = 'intro' | 'imagery' | 'essay' | 'domains';
type MainStep =
  | { kind: 'onboarding' }
  | { kind: 'calendar' }
  | { kind: 'session'; key: SessionKey; index: number }
  | { kind: 'survey'; key: SessionKey; index: number }
  | { kind: 'complete' };
type OnboardingDraft = {
  essay: string;
  domains: DomainSummaries;
  goal: string;
  imageryEndsAt: number | null;
};
type DraftRecord = Record<string, Record<string, unknown>>;

function emptyDomains(): DomainSummaries {
  return Object.fromEntries(DOMAINS.map((domain) => [domain, ''])) as DomainSummaries;
}

function useStoredState<T>(key: string, initial: T): [T, (value: T | ((prior: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(key);
      return saved ? JSON.parse(saved) as T : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);
  return [value, setValue];
}

function deriveStep(state: StudyState): MainStep {
  if (!state.onboarding?.essay) return { kind: 'onboarding' };
  if (!state.calendarEvents.length) return { kind: 'calendar' };
  for (let index = 0; index < SESSION_ORDER.length; index += 1) {
    const key = SESSION_ORDER[index];
    const saved = state.sessions[key];
    if (!saved?.completedAt) return { kind: 'session', key, index };
    if (!saved.surveySubmittedAt) return { kind: 'survey', key, index };
  }
  return { kind: 'complete' };
}

function yesterdayDateKey(): string {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

function localDateKey(iso: string): string {
  const date = new Date(iso);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

function reflectionDay(state: StudyState): { text: string; key: string } {
  const key = state.calendarEvents[0] ? localDateKey(state.calendarEvents[0].start) : yesterdayDateKey();
  return { key, text: key === yesterdayDateKey() ? 'yesterday' : dayLabel(key) };
}

function dayLabel(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(year, month - 1, day));
}

function clockTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

function inputTime(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function minutesAndSeconds(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Try again.';
}

function IconCheck() {
  return <span aria-hidden="true">✓</span>;
}

function EudiaMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="eudia-message">
      <img src={avatarUrl} alt="" />
      <div className="eudia-bubble">{children}</div>
    </div>
  );
}

function RatingScale({
  label, hint, low, high, value, onChange, name,
}: {
  label: string; hint?: string; low: string; high: string;
  value?: number; onChange: (value: number) => void; name: string;
}) {
  return (
    <fieldset className="rating">
      <legend>{label}</legend>
      {hint && <p className="rating-desc">{hint}</p>}
      <div className="rating-options">
        {[1, 2, 3, 4, 5].map((number) => (
          <label className="rating-option" key={number}>
            <input type="radio" name={name} value={number} checked={value === number} onChange={() => onChange(number)} />
            <span>{number}</span>
          </label>
        ))}
      </div>
      <div className="rating-ends"><span>{low}</span><span>{high}</span></div>
    </fieldset>
  );
}

function EventPicker({ events, selectedId, onSelect, label }: {
  events: CalendarEvent[]; selectedId?: string; onSelect: (id: string) => void; label: string;
}) {
  return (
    <fieldset className="rating">
      <legend>{label}</legend>
      <div className="event-list">
        {events.map((event) => (
          <label className="event-pick" key={event.id}>
            <input type="radio" name="selected-event" checked={selectedId === event.id} onChange={() => onSelect(event.id)} />
            <span className="event-card">
              <span className="event-icon" aria-hidden="true">▦</span>
              <span className="event-info"><strong>{event.title}</strong><span>{clockTime(event.start)}–{clockTime(event.end)}</span></span>
              <span className="event-radio" aria-hidden="true" />
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function SurveyScreen({ sessionKey, initial, busy, onChange, onSubmit }: {
  sessionKey: SessionKey;
  initial: Partial<SurveyAnswers>;
  busy: boolean;
  onChange: (answers: Partial<SurveyAnswers>) => void;
  onSubmit: (answers: SurveyAnswers) => void;
}) {
  const [answers, setAnswers] = useState<Partial<SurveyAnswers>>(initial);
  const change = (next: Partial<SurveyAnswers>) => { setAnswers(next); onChange(next); };
  const ready = SURVEY_QUESTIONS.every(({ key }) => typeof answers[key] === 'number');
  const submit = () => {
    if (!ready) return;
    onSubmit(answers as SurveyAnswers);
  };
  return (
    <>
      <p className="eyebrow">Quick check-in · {SESSION_LABELS[sessionKey]}</p>
      <h2>How did that feel?</h2>
      <p className="lead survey-intro">Four short questions. Your answers help us understand each activity.</p>
      {SURVEY_QUESTIONS.map(({ key, label }) => (
        <div className="survey-question" key={key}>
          <p id={`survey-${key}`}>{label}</p>
          <div className="survey-scale" role="group" aria-labelledby={`survey-${key}`}>
            {[1, 2, 3, 4, 5, 6, 7].map((number) => (
              <label key={number}>
                <input type="radio" name={`survey-${key}`} value={number} checked={answers[key] === number} onChange={() => change({ ...answers, [key]: number })} />
                <span>{number}</span>
              </label>
            ))}
          </div>
          <div className="survey-scale-ends"><span>Not at all</span><span>Very much</span></div>
        </div>
      ))}
      <label className="field" style={{ marginTop: 22 }}>
        <span className="field-label">Anything else? <span className="muted small">Optional</span></span>
        <textarea className="textarea" value={answers.comment ?? ''} onChange={(event) => change({ ...answers, comment: event.target.value })} placeholder="What stood out to you?" />
      </label>
      <div className="actions"><button className="btn" disabled={!ready || busy} onClick={submit}>{busy ? 'Saving…' : 'Continue'}</button></div>
    </>
  );
}

function SessionContent({
  sessionKey, state, draft, update, busy, onComplete,
}: {
  sessionKey: SessionKey;
  state: StudyState;
  draft: Record<string, unknown>;
  update: (patch: Record<string, unknown>) => void;
  busy: boolean;
  onComplete: (data: unknown) => void;
}) {
  switch (sessionKey) {
    case 'reflection_baseline': return <ReflectionBaseline state={state} draft={draft} update={update} busy={busy} onComplete={onComplete} />;
    case 'reflection_active': return <ReflectionActive state={state} draft={draft} update={update} busy={busy} onComplete={onComplete} />;
    case 'philosophy_baseline': return <PhilosophyBaseline draft={draft} update={update} busy={busy} onComplete={onComplete} />;
    case 'philosophy_active': return <PhilosophyActive profile={state.onboarding!} draft={draft} update={update} busy={busy} onComplete={onComplete} />;
    case 'challenge_baseline': return <ChallengeBaseline state={state} draft={draft} update={update} busy={busy} onComplete={onComplete} />;
    case 'challenge_active': return <ChallengeActive state={state} draft={draft} update={update} busy={busy} onComplete={onComplete} />;
  }
}

export default function App() {
  const [study, setStudy] = useState<StudyState | null>(null);
  const [user, setUser] = useState<StudyUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [onboardingStage, setOnboardingStage] = useStoredState<OnboardingStage>('eudia-study-onboarding-stage', 'intro');
  const [onboarding, setOnboarding] = useStoredState<OnboardingDraft>('eudia-study-onboarding-draft', {
    essay: '', domains: emptyDomains(), goal: '', imageryEndsAt: null,
  });
  const [targetDay, setTargetDay] = useStoredState('eudia-study-target-day', yesterdayDateKey());
  const [calendarDraft, setCalendarDraft] = useStoredState<CalendarEvent[]>('eudia-study-calendar-draft', []);
  const [sessionDrafts, setSessionDrafts] = useStoredState<DraftRecord>('eudia-study-session-drafts', {});
  const [surveyDrafts, setSurveyDrafts] = useStoredState<Record<string, Partial<SurveyAnswers>>>('eudia-study-survey-drafts', {});
  const [now, setNow] = useState(Date.now());
  const [eventTitle, setEventTitle] = useState('');
  const [eventStart, setEventStart] = useState('09:00');
  const [eventEnd, setEventEnd] = useState('10:00');
  const [eventNotes, setEventNotes] = useState('');
  const [eventError, setEventError] = useState('');
  const [editingEventId, setEditingEventId] = useState<string | null>(null);

  const ensureDraftOwner = (uid: string) => {
    const prior = localStorage.getItem('eudia-study-draft-owner');
    if (prior !== uid) {
      setOnboardingStage('intro');
      setOnboarding({ essay: '', domains: emptyDomains(), goal: '', imageryEndsAt: null });
      setTargetDay(yesterdayDateKey());
      setCalendarDraft([]);
      setSessionDrafts({});
      setSurveyDrafts({});
    }
    localStorage.setItem('eudia-study-draft-owner', uid);
  };

  const reload = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const current = await getCurrentUser();
      setUser(current);
      if (current) {
        ensureDraftOwner(current.uid);
        setStudy(await getStudy());
      } else {
        setStudy(null);
      }
    } catch (cause) {
      setLoadError(errorText(cause));
    } finally {
      setLoading(false);
    }
  };

  const handleSignIn = async () => {
    setBusy(true); setLoadError('');
    try {
      const signed = await signIn();
      ensureDraftOwner(signed.uid);
      setUser(signed);
      setStudy(await getStudy());
    } catch (cause) { setLoadError(errorText(cause)); }
    finally { setBusy(false); }
  };

  const handleSignOut = async () => {
    setBusy(true); setLoadError('');
    try {
      await signOutStudy();
      setStudy(null);
      setUser(null);
    } catch (cause) { setLoadError(errorText(cause)); }
    finally { setBusy(false); }
  };

  useEffect(() => { void reload(); }, []);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const step = useMemo(() => study ? deriveStep(study) : { kind: 'onboarding' } as MainStep, [study]);
  const calendarDay = step.kind === 'calendar' && !calendarDraft.length ? yesterdayDateKey() : targetDay;
  useEffect(() => {
    if (step.kind === 'calendar' && !calendarDraft.length && targetDay !== yesterdayDateKey()) {
      setTargetDay(yesterdayDateKey());
    }
  }, [step.kind, calendarDraft.length, targetDay]);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [step.kind, step.kind === 'session' || step.kind === 'survey' ? step.key : '', onboardingStage]);

  const commit = async (operation: () => Promise<StudyState>) => {
    setError('');
    setBusy(true);
    try {
      setStudy(await operation());
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const updateSessionDraft = (key: SessionKey, patch: Record<string, unknown>) => {
    setSessionDrafts((previous) => ({ ...previous, [key]: { ...previous[key], ...patch } }));
  };

  const handleCategorize = async () => {
    if (!onboarding.essay.trim()) return;
    setBusy(true);
    setError('');
    try {
      const domains = await categorizeBps(onboarding.essay.trim());
      setOnboarding((previous) => ({ ...previous, domains }));
    } catch (cause) {
      setError(`Eudia could not organize your writing automatically. You can fill the four areas yourself. ${errorText(cause)}`);
    } finally {
      setOnboardingStage('domains');
      setBusy(false);
    }
  };

  const handleSaveOnboarding = () => {
    const profile: ParticipantProfile = {
      essay: onboarding.essay.trim(),
      domains: Object.fromEntries(DOMAINS.map((domain) => [domain, onboarding.domains[domain].trim()])) as DomainSummaries,
      goal: onboarding.goal.trim(),
    };
    void commit(() => saveOnboarding(profile));
  };

  const addEvent = () => {
    const title = eventTitle.trim();
    const start = new Date(`${calendarDay}T${eventStart}:00`);
    const end = new Date(`${calendarDay}T${eventEnd}:00`);
    if (!title) { setEventError('Give this event a name.'); return; }
    if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf()) || end <= start) {
      setEventError('Choose an end time after the start time.'); return;
    }
    const event: CalendarEvent = {
      id: editingEventId ?? (globalThis.crypto?.randomUUID?.() ?? `event-${Date.now()}-${Math.random()}`),
      title, start: start.toISOString(), end: end.toISOString(), notes: eventNotes.trim(),
    };
    setCalendarDraft((previous) => (editingEventId ? previous.map((item) => item.id === editingEventId ? event : item) : [...previous, event]).sort((a, b) => a.start.localeCompare(b.start)));
    setEventTitle(''); setEventNotes(''); setEventError(''); setEditingEventId(null);
  };

  const editEvent = (event: CalendarEvent) => {
    setEditingEventId(event.id);
    setEventTitle(event.title);
    setEventStart(inputTime(event.start));
    setEventEnd(inputTime(event.end));
    setEventNotes(event.notes ?? '');
    setEventError('');
  };

  const handleSurvey = (key: SessionKey, answers: SurveyAnswers) => {
    setSurveyDrafts((previous) => ({ ...previous, [key]: answers }));
    void commit(() => saveSurvey(key, answers));
  };

  const currentGroup = step.kind === 'session' || step.kind === 'survey' ? Math.floor(step.index / 2) : -1;
  const completedSessions = study ? SESSION_ORDER.filter((key) => !!study.sessions[key]?.surveySubmittedAt).length : 0;
  const progress = step.kind === 'complete' ? 100 : step.kind === 'onboarding' ? 4 : step.kind === 'calendar' ? 15 : 20 + (completedSessions / 6) * 80;
  const progressTitle = step.kind === 'onboarding' ? 'Getting to know you' : step.kind === 'calendar' ? 'Yesterday’s calendar' : step.kind === 'complete' ? 'All complete' : `Experience ${step.index + 1} of 6`;

  if (loading) {
    return <div className="app-shell loading-wrap"><div className="card loading-card"><div className="spinner" aria-label="Loading" /><strong>Opening your Eudia study…</strong></div></div>;
  }
  if (!user) {
    return <div className="app-shell"><header className="topbar"><span className="brand"><span className="brand-mark"><img src={avatarUrl} alt="" /></span><span>eudia</span></span><span className="topbar-note">A guided self-discovery study</span></header><div className="page-wrap" style={{ maxWidth: 680 }}><div className="card main-card"><p className="eyebrow">Welcome to Eudia</p><h1>Your reflection journey starts here.</h1><p className="lead">Sign in to save your progress across the six short experiences.</p><div className="hero-illustration"><img src={avatarUrl} alt="Eudia, your reflection companion" /></div>{loadError && <div className="inline-error" role="alert">{loadError}</div>}<button className="btn" disabled={busy} onClick={() => void handleSignIn()}>{busy ? 'Signing in…' : 'Continue with Google'}</button></div></div></div>;
  }
  if (loadError || !study) {
    return <div className="app-shell loading-wrap"><div className="card loading-card"><h2>We couldn’t open your study.</h2><p className="body-copy">{loadError}</p><button className="btn" onClick={() => void reload()}>Try again</button></div></div>;
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#main" aria-label="Eudia study home"><span className="brand-mark"><img src={avatarUrl} alt="" /></span><span>eudia</span></a>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}><span className="topbar-note">{user.displayName ?? 'A guided self-discovery study'}</span><button className="btn ghost small" disabled={busy} onClick={() => void handleSignOut()}>Sign out</button></div>
      </header>
      <div className="page-wrap">
        <div className="progress-panel" aria-label="Study progress">
          <div className="progress-copy"><span className="progress-kicker">Your journey</span><strong>{progressTitle}</strong></div>
          <div className="progress-track"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
          <span className="progress-count">{completedSessions} / 6 done</span>
        </div>
        <div className="content-layout">
          <main id="main" className="content-main">
            <div className="card main-card">
              {error && <div className="inline-error" role="alert">{error}</div>}
              {step.kind === 'onboarding' && renderOnboarding()}
              {step.kind === 'calendar' && renderCalendar()}
              {step.kind === 'session' && (
                <SessionContent key={step.key} sessionKey={step.key} state={study} draft={sessionDrafts[step.key] ?? {}} update={(patch) => updateSessionDraft(step.key, patch)} busy={busy} onComplete={(data) => void commit(() => saveSession(step.key, data))} />
              )}
              {step.kind === 'survey' && <SurveyScreen key={step.key} sessionKey={step.key} initial={surveyDrafts[step.key] ?? {}} busy={busy} onChange={(answers) => setSurveyDrafts((previous) => ({ ...previous, [step.key]: answers }))} onSubmit={(answers) => handleSurvey(step.key, answers)} />}
              {step.kind === 'complete' && <><div className="complete-mark"><IconCheck /></div><p className="eyebrow">Journey complete</p><h1>Thank you for exploring with Eudia.</h1><p className="lead">You completed all six experiences and their check-ins. Your responses have been saved.</p><div className="panel tint"><p className="body-copy">You can close this page now.</p></div></>}
            </div>
          </main>
          <aside className="content-side" aria-label="Study overview">
            <div className="card side-card"><p className="side-title">Your path</p><ul className="side-list">
              <li className={step.kind === 'onboarding' ? 'current' : 'done'}><span className="side-dot">{step.kind === 'onboarding' ? '1' : '✓'}</span>Best possible self</li>
              <li className={step.kind === 'calendar' ? 'current' : study.calendarEvents.length ? 'done' : ''}><span className="side-dot">{study.calendarEvents.length ? '✓' : '2'}</span>Yesterday’s calendar</li>
              {SESSION_GROUPS.map((label, index) => {
                const done = !!study.sessions[SESSION_ORDER[index * 2 + 1]]?.surveySubmittedAt;
                return <li key={label} className={done ? 'done' : currentGroup === index ? 'current' : ''}><span className="side-dot">{done ? '✓' : index + 3}</span>{label}</li>;
              })}
            </ul></div>
            <div className="card side-card eudia-side"><img src={avatarUrl} alt="" /><p>Take your time. Your progress stays here if you leave and come back.</p></div>
          </aside>
        </div>
      </div>
    </div>
  );

  function renderOnboarding() {
    const remaining = onboarding.imageryEndsAt ? Math.max(0, Math.min(60, Math.ceil((onboarding.imageryEndsAt - now) / 1000))) : 60;
    switch (onboardingStage) {
      case 'intro': return <>
        <p className="eyebrow">Welcome to Eudia</p>
        <h1>Imagine the life you want to grow into.</h1>
        <p className="lead">We’ll begin with your best possible self, then look back at yesterday and try a few short experiences together.</p>
        <div className="hero-illustration"><img src={avatarUrl} alt="Eudia, your reflection companion" /></div>
        <EudiaMessage><p>Hii, I’m Eudia. Let’s start with the person you hope to become. There are no perfect answers here.</p></EudiaMessage>
        <div className="actions"><button className="btn" onClick={() => setOnboardingStage('imagery')}>Begin</button></div>
      </>;
      case 'imagery': return <>
        <p className="eyebrow">Best possible self · imagine</p>
        <h2>Give your future self a moment.</h2>
        <p className="lead">Picture a life that has gone as well as it reasonably could. Think about work and learning, enjoyment, relationships, growth, and well-being.</p>
        <div className="timer-card">
          <div className="timer-ring" style={{ '--timer-progress': `${((60 - remaining) / 60) * 100}%` } as React.CSSProperties}><div className="timer-ring-inner">{minutesAndSeconds(remaining)}</div></div>
          <div className="timer-copy"><strong>{onboarding.imageryEndsAt ? remaining ? 'Imagine the details' : 'Ready when you are' : 'One quiet minute'}</strong><p>What are you doing? Who is around you? What feels meaningful?</p></div>
        </div>
        <div className="actions">
          {!onboarding.imageryEndsAt ? <button className="btn" onClick={() => { const started = Date.now(); setNow(started); setOnboarding((previous) => ({ ...previous, imageryEndsAt: started + 60000 })); }}>Start one-minute reflection</button> : <button className="btn" disabled={remaining > 0} onClick={() => setOnboardingStage('essay')}>Write about your future self</button>}
          <button className="btn ghost" onClick={() => setOnboardingStage('intro')}>Back</button>
        </div>
      </>;
      case 'essay': return <>
        <p className="eyebrow">Best possible self · write</p>
        <h2>Put that future into your own words.</h2>
        <p className="lead">Imagine life a few years from now. Describe what matters in your work, leisure, relationships, and growth.</p>
        <label className="field"><span className="field-label">Your best possible self</span><span className="field-hint">Write as much as you need. Details help Eudia understand your direction.</span><textarea className="textarea lined" value={onboarding.essay} onChange={(event) => setOnboarding((previous) => ({ ...previous, essay: event.target.value }))} placeholder="In the life I’m building, I…" /></label>
        <div className="actions"><button className="btn" disabled={!onboarding.essay.trim() || busy} onClick={() => void handleCategorize()}>{busy ? 'Organizing…' : 'Continue'}</button><button className="btn ghost" onClick={() => setOnboardingStage('imagery')}>Back</button></div>
      </>;
      case 'domains': return <>
        <p className="eyebrow">Best possible self · review</p>
        <h2>Shape your future across four areas.</h2>
        <p className="lead">Eudia grouped your writing. Edit each area until it sounds like you. Add anything that belongs.</p>
        <div className="domain-grid">{DOMAINS.map((domain, index) => <div className="domain-card" key={domain}><span className="domain-number">{index + 1}</span><label className="field"><span className="field-label">{domain}</span><textarea className="textarea" value={onboarding.domains[domain]} onChange={(event) => setOnboarding((previous) => ({ ...previous, domains: { ...previous.domains, [domain]: event.target.value } }))} placeholder={`What does your best possible self look like in ${domain.toLowerCase()}?`} /></label></div>)}</div>
        <label className="field" style={{ marginTop: 22 }}><span className="field-label">One goal that matters to you <span className="muted small">Optional</span></span><input className="text-input" value={onboarding.goal} onChange={(event) => setOnboarding((previous) => ({ ...previous, goal: event.target.value }))} placeholder="For example, reconnect with a friend" /></label>
        <div className="actions"><button className="btn" disabled={busy || DOMAINS.some((domain) => !onboarding.domains[domain].trim())} onClick={handleSaveOnboarding}>{busy ? 'Saving…' : 'Save and continue'}</button><button className="btn ghost" onClick={() => setOnboardingStage('essay')}>Back</button></div>
      </>;
    }
  }

  function renderCalendar() {
    return <>
      <p className="eyebrow">{calendarDay === yesterdayDateKey() ? 'Yesterday’s calendar' : `Calendar for ${dayLabel(calendarDay)}`}</p>
      <h2>What filled your day?</h2>
      <p className="lead">Add the events you remember from {dayLabel(calendarDay)}. You’ll use this same list for both reflection activities.</p>
      <EudiaMessage><p>A meal, a conversation, work, a quiet moment—anything that felt part of your day can go here.</p></EudiaMessage>
      {calendarDraft.length > 0 && <div className="event-list" style={{ marginBottom: 25 }}>{calendarDraft.map((event) => <div className="event-card" key={event.id}><span className="event-icon" aria-hidden="true">▦</span><span className="event-info"><strong>{event.title}</strong><span>{clockTime(event.start)}–{clockTime(event.end)}</span></span><button className="btn ghost small" aria-label={`Edit ${event.title}`} onClick={() => editEvent(event)}>Edit</button><button className="event-remove" aria-label={`Remove ${event.title}`} onClick={() => setCalendarDraft((previous) => previous.filter((item) => item.id !== event.id))}>×</button></div>)}</div>}
      <div className="panel"><h3>{editingEventId ? 'Edit event' : 'Add an event'}</h3><p className="body-copy" style={{ marginTop: 0 }}>Only a title and time needed. Add as many as you want.</p>
        <label className="field"><span className="field-label">What happened?</span><input className="text-input" value={eventTitle} onChange={(event) => setEventTitle(event.target.value)} placeholder="For example, lunch with Maya" /></label>
        <div className="two-cols"><label className="field"><span className="field-label">Start</span><input className="text-input" type="time" value={eventStart} onChange={(event) => setEventStart(event.target.value)} /></label><label className="field"><span className="field-label">End</span><input className="text-input" type="time" value={eventEnd} onChange={(event) => setEventEnd(event.target.value)} /></label></div>
        <label className="field"><span className="field-label">Notes <span className="muted small">Optional</span></span><input className="text-input" value={eventNotes} onChange={(event) => setEventNotes(event.target.value)} placeholder="Anything you want to remember" /></label>
        {eventError && <p className="field-error" role="alert">{eventError}</p>}<button className="btn secondary small" onClick={addEvent}>{editingEventId ? 'Save changes' : 'Add event'}</button>{editingEventId && <button className="btn ghost small" onClick={() => { setEditingEventId(null); setEventTitle(''); setEventNotes(''); }}>Cancel</button>}
      </div>
      <div className="actions"><button className="btn" disabled={!calendarDraft.length || busy} onClick={() => void commit(() => saveCalendarEvents(calendarDraft))}>{busy ? 'Saving…' : 'Continue to reflection'}</button></div>
    </>;
  }
}

function ReflectionBaseline({ state, draft, update, busy, onComplete }: {
  state: StudyState; draft: Record<string, unknown>; update: (patch: Record<string, unknown>) => void;
  busy: boolean; onComplete: (data: unknown) => void;
}) {
  const eventId = typeof draft.eventId === 'string' ? draft.eventId : '';
  const reflection = typeof draft.reflection === 'string' ? draft.reflection : '';
  const selected = state.calendarEvents.find((event) => event.id === eventId);
  const day = reflectionDay(state);
  return <>
    <p className="eyebrow">Reflection · first activity</p>
    <h2>Look back at {day.text}.</h2>
    <p className="lead">Choose a calendar event. Write any additional reflection about it in your own way.</p>
    <EventPicker events={state.calendarEvents} selectedId={eventId} onSelect={(id) => update({ eventId: id })} label="Which event would you like to write about?" />
    {selected && <label className="field"><span className="field-label">Your reflection on {selected.title}</span><span className="field-hint">Whatever comes to mind is fine.</span><textarea className="textarea lined" value={reflection} onChange={(event) => update({ reflection: event.target.value })} placeholder="Looking back, I remember…" /></label>}
    <div className="actions"><button className="btn" disabled={!selected || !reflection.trim() || busy} onClick={() => onComplete({ day: day.key, eventId, eventTitle: selected?.title, reflection: reflection.trim() })}>{busy ? 'Saving…' : 'Finish reflection'}</button></div>
  </>;
}

type EventReflection = {
  domain?: Domain;
  alignment?: number;
  affectDuring?: number;
  affectNow?: number;
  arousalDuring?: number;
  arousalNow?: number;
  meaning?: number;
  meaningNote?: string;
};

function getEventReflections(draft: Record<string, unknown>): Record<string, EventReflection> {
  const value = draft.eventReflections;
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, EventReflection> : {};
}

function ReflectionActive({ state, draft, update, busy, onComplete }: {
  state: StudyState; draft: Record<string, unknown>; update: (patch: Record<string, unknown>) => void;
  busy: boolean; onComplete: (data: unknown) => void;
}) {
  const selectedIds = Array.isArray(draft.selectedIds) ? draft.selectedIds.filter((id): id is string => typeof id === 'string') : [];
  const reflections = getEventReflections(draft);
  const selected = state.calendarEvents.filter((event) => selectedIds.includes(event.id));
  const day = reflectionDay(state);
  const updateEvent = (id: string, patch: Partial<EventReflection>) => update({ eventReflections: { ...reflections, [id]: { ...reflections[id], ...patch } } });
  const toggleEvent = (id: string) => update({ selectedIds: selectedIds.includes(id) ? selectedIds.filter((value) => value !== id) : [...selectedIds, id] });
  const complete = selected.length > 0 && selected.every((event) => {
    const item = reflections[event.id];
    return item && item.domain && item.alignment && item.affectDuring && item.affectNow && item.arousalDuring && item.arousalNow && item.meaning && item.meaningNote?.trim();
  });
  return <>
    <p className="eyebrow">Reflection · second activity</p>
    <h2>How did {day.text} feel—and what mattered?</h2>
    <p className="lead">Choose one or more moments from {day.text}. For each, notice both its emotional feel and its meaning to you.</p>
    <div className="bullseye-card"><div className="bullseye" aria-hidden="true"><span className="bullseye-center" /></div><div className="bullseye-copy"><h3>Two ways to see a moment</h3><p>Something can feel difficult and still move you toward what matters. Or it can feel pleasant without feeling meaningful.</p></div></div>
    <fieldset className="rating"><legend>Which moments stand out?</legend><p className="rating-desc">Choose at least one. You can reflect on several.</p><div className="event-list">
      {state.calendarEvents.map((event) => <label className="event-pick" key={event.id}><input type="checkbox" checked={selectedIds.includes(event.id)} onChange={() => toggleEvent(event.id)} /><span className="event-card"><span className="event-icon" aria-hidden="true">▦</span><span className="event-info"><strong>{event.title}</strong><span>{clockTime(event.start)}–{clockTime(event.end)}</span></span><span className="event-radio" aria-hidden="true" /></span></label>)}
    </div></fieldset>
    {selected.map((event) => {
      const item = reflections[event.id] ?? {};
      return <div className="panel" key={event.id}><p className="prompt-meta">YOUR MOMENT</p><h3>{event.title}</h3><p className="body-copy" style={{ marginTop: 0 }}>{clockTime(event.start)}–{clockTime(event.end)}</p>
        <p className="field-label">Which part of life does this moment belong to?</p>
        <div className="domain-choices" role="group" aria-label={`Life area for ${event.title}`}>{DOMAINS.map((domain) => <button key={domain} type="button" className={`chip ${item.domain === domain ? 'selected' : ''}`} aria-pressed={item.domain === domain} onClick={() => updateEvent(event.id, { domain })}>{domain}</button>)}</div>
        <RatingScale name={`align-${event.id}`} label="How aligned was it with your best possible self?" low="Far away" high="Very aligned" value={item.alignment} onChange={(value) => updateEvent(event.id, { alignment: value })} />
        <div className="rating-grid"><RatingScale name={`pleasant-during-${event.id}`} label="Pleasantness during" low="Unpleasant" high="Pleasant" value={item.affectDuring} onChange={(value) => updateEvent(event.id, { affectDuring: value })} /><RatingScale name={`pleasant-now-${event.id}`} label="Pleasantness looking back" low="Unpleasant" high="Pleasant" value={item.affectNow} onChange={(value) => updateEvent(event.id, { affectNow: value })} /><RatingScale name={`arousal-during-${event.id}`} label="Activation during" low="Low energy" high="High energy" value={item.arousalDuring} onChange={(value) => updateEvent(event.id, { arousalDuring: value })} /><RatingScale name={`arousal-now-${event.id}`} label="Activation looking back" low="Low energy" high="High energy" value={item.arousalNow} onChange={(value) => updateEvent(event.id, { arousalNow: value })} /></div>
        <RatingScale name={`meaning-${event.id}`} label="How meaningful was this moment?" low="Not meaningful" high="Very meaningful" value={item.meaning} onChange={(value) => updateEvent(event.id, { meaning: value })} />
        <label className="field"><span className="field-label">What made it meaningful—or not?</span><textarea className="textarea" value={item.meaningNote ?? ''} onChange={(change) => updateEvent(event.id, { meaningNote: change.target.value })} placeholder="This moment mattered because…" /></label>
      </div>;
    })}
    <div className="actions"><button className="btn" disabled={!complete || busy} onClick={() => onComplete({ day: day.key, events: selected.map((event) => ({ eventId: event.id, eventTitle: event.title, ...reflections[event.id], meaningNote: reflections[event.id].meaningNote?.trim() })) })}>{busy ? 'Saving…' : 'Finish reflection'}</button></div>
  </>;
}

function PhilosophyBaseline({ draft, update, busy, onComplete }: {
  draft: Record<string, unknown>; update: (patch: Record<string, unknown>) => void;
  busy: boolean; onComplete: (data: unknown) => void;
}) {
  const answers = Array.isArray(draft.answers) ? draft.answers.map((answer) => typeof answer === 'string' ? answer : '') : ['', '', ''];
  const setAnswer = (index: number, value: string) => {
    const next = [...answers]; next[index] = value; update({ answers: next });
  };
  return <>
    <p className="eyebrow">Philosophy · first activity</p><h2>Three questions to think with.</h2>
    <p className="lead">Take a few minutes with each question. There are no right answers.</p>
    {FIXED_PHILOSOPHY_QUESTIONS.map((question, index) => <div className="panel" key={question}><p className="prompt-meta">QUESTION {index + 1} OF 3</p><p className="prompt-title">{question}</p><label className="field" style={{ marginBottom: 0 }}><span className="field-label">Your thoughts</span><textarea className="textarea" value={answers[index] ?? ''} onChange={(event) => setAnswer(index, event.target.value)} placeholder="I think…" /></label></div>)}
    <div className="actions"><button className="btn" disabled={busy || answers.slice(0, 3).some((answer) => !answer.trim())} onClick={() => onComplete({ questions: FIXED_PHILOSOPHY_QUESTIONS, answers: answers.slice(0, 3).map((answer) => answer.trim()) })}>{busy ? 'Saving…' : 'Finish questions'}</button></div>
  </>;
}

function PhilosophyActive({ profile, draft, update, busy, onComplete }: {
  profile: ParticipantProfile; draft: Record<string, unknown>; update: (patch: Record<string, unknown>) => void;
  busy: boolean; onComplete: (data: unknown) => void;
}) {
  const savedRecommendation = draft.recommendation && typeof draft.recommendation === 'object' ? draft.recommendation as PhilosopherRecommendation : null;
  const [recommendation, setRecommendation] = useState<PhilosopherRecommendation | null>(savedRecommendation);
  const [recommending, setRecommending] = useState(!savedRecommendation && !draft.philosopherId && (!draft.phase || draft.phase === 'choose'));
  const [sending, setSending] = useState(false);
  const [localError, setLocalError] = useState('');
  const chatEnd = useRef<HTMLDivElement>(null);
  const selectedId = typeof draft.philosopherId === 'string' ? draft.philosopherId : '';
  const phase = typeof draft.phase === 'string' ? draft.phase : 'choose';
  const input = typeof draft.input === 'string' ? draft.input : '';
  const messages = Array.isArray(draft.messages) ? draft.messages.filter((message): message is ChatMessage => !!message && typeof message === 'object' && (message as ChatMessage).role !== undefined && typeof (message as ChatMessage).content === 'string') : [];
  const philosophers = getPhilosophers();
  const selected = philosophers.find((person) => person.id === selectedId) ?? (recommendation?.id === selectedId ? recommendation : undefined);
  const userTurns = messages.filter((message) => message.role === 'user').length;

  useEffect(() => {
    if (savedRecommendation || selectedId || phase !== 'choose') return;
    let cancelled = false;
    void recommendPhilosopher(profile).then((result) => {
      if (cancelled) return;
      setRecommendation(result);
      update({ recommendation: result });
    }).catch((cause) => {
      if (!cancelled) setLocalError(`Eudia could not suggest a philosopher. You can choose one below. ${errorText(cause)}`);
    }).finally(() => { if (!cancelled) setRecommending(false); });
    return () => { cancelled = true; };
  }, [profile.essay]);
  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [messages.length]);

  const beginChat = async () => {
    if (!selected) return;
    setSending(true); setLocalError('');
    try {
      const result = await runPhilosophy({ philosopher: selected.id, messages: [], profile });
      update({ phase: 'chat', messages: [{ role: 'assistant', content: result.reply }] });
    } catch (cause) { setLocalError(errorText(cause)); }
    finally { setSending(false); }
  };
  const sendTurn = async () => {
    if (!selected || !input.trim() || sending || userTurns >= 3) return;
    const next: ChatMessage[] = [...messages, { role: 'user', content: input.trim() }];
    update({ messages: next, input: '' });
    setSending(true); setLocalError('');
    try {
      const result = await runPhilosophy({ philosopher: selected.id, messages: next, profile });
      update({ messages: [...next, { role: 'assistant', content: result.reply }] });
    } catch (cause) { update({ messages, input }); setLocalError(errorText(cause)); }
    finally { setSending(false); }
  };
  const education = selectedId === recommendation?.id ? recommendation.education : selected?.education;
  return <>
    <p className="eyebrow">Philosophy · second activity</p><h2>A perspective chosen for you—and by you.</h2>
    <p className="lead">Choose a philosopher. Eudia will introduce one idea, then explore your own life through that perspective.</p>
    {localError && <div className="inline-error" role="alert">{localError}</div>}
    {phase === 'choose' && <>
      {recommendation && <div className="panel tint"><p className="prompt-meta">EUDIA’S SUGGESTION</p><h3>{recommendation.name}</h3><p className="body-copy">{recommendation.reason}</p></div>}
      {recommending && <p className="body-copy">Eudia is finding a perspective that fits your writing…</p>}
      <div className="philosopher-grid">{philosophers.map((person) => <button type="button" key={person.id} className={`philosopher-option ${selectedId === person.id ? 'selected' : ''}`} aria-pressed={selectedId === person.id} onClick={() => update({ philosopherId: person.id })}><strong>{person.name}{recommendation?.id === person.id && <span className="recommended-tag">Suggested</span>}</strong><span>{person.education}</span></button>)}</div>
      <div className="actions"><button className="btn" disabled={!selected} onClick={() => update({ phase: 'education' })}>Learn about {selected?.name ?? 'this philosopher'}</button></div>
    </>}
    {phase === 'education' && selected && <>
      <div className="education-card"><p className="prompt-meta">A SHORT INTRODUCTION</p><h3>{selected.name}</h3><p>{education}</p></div>
      <EudiaMessage><p>Now let’s see what this perspective brings out in your own story. Your words matter most here.</p></EudiaMessage>
      <div className="actions"><button className="btn" disabled={sending} onClick={() => void beginChat()}>{sending ? 'Beginning…' : 'Start conversation'}</button><button className="btn ghost" onClick={() => update({ phase: 'choose' })}>Choose someone else</button></div>
    </>}
    {phase === 'chat' && selected && <>
      <div className="panel tint"><p className="prompt-meta">YOUR CONVERSATION WITH EUDIA</p><h3>Through {selected.name}’s perspective</h3><p className="body-copy">Three short turns, shaped by what you share.</p></div>
      <div className="chat-stream" aria-live="polite">{messages.map((message, index) => <div className={`chat-line ${message.role}`} key={`${index}-${message.role}`}>{message.content}</div>)}{sending && <div className="chat-line assistant">Eudia is thinking…</div>}<div ref={chatEnd} /></div>
      {userTurns < 3 && <div className="chat-compose"><label className="field" style={{ flex: 1, margin: 0 }}><span className="field-label">Your reply · {userTurns + 1} of 3</span><textarea className="textarea" value={input} onChange={(event) => update({ input: event.target.value })} placeholder="Tell Eudia what comes to mind…" /></label><button className="btn" disabled={!input.trim() || sending} onClick={() => void sendTurn()}>Send</button></div>}
      {userTurns >= 3 && <div className="actions"><button className="btn" disabled={busy || sending} onClick={() => onComplete({ philosopher: selected.id, philosopherName: selected.name, education, recommendation: recommendation?.id, messages })}>{busy ? 'Saving…' : 'Finish conversation'}</button></div>}
    </>}
  </>;
}

function ActionWindow({ action, startedAt, onReturn }: { action: string; startedAt: number; onReturn: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(id); }, []);
  const remaining = Math.max(0, 300 - Math.floor((now - startedAt) / 1000));
  return <>
    <div className="challenge-card"><p className="prompt-meta">YOUR FIVE-MINUTE ACTION</p><h3>{action}</h3></div>
    <div className="timer-card"><div className="timer-ring" style={{ '--timer-progress': `${((300 - remaining) / 300) * 100}%` } as React.CSSProperties}><div className="timer-ring-inner">{minutesAndSeconds(remaining)}</div></div><div className="timer-copy"><strong>{remaining > 0 ? 'Take this time for your action' : 'Five minutes are up'}</strong><p>You can leave this tab open while you try it. Come back when you’re ready.</p></div></div>
    <div className="actions"><button className="btn" onClick={onReturn}>I’m back</button></div>
  </>;
}

function ActionCheckin({ outcome, note, onOutcome, onNote, onFinish, busy }: {
  outcome: string; note: string; onOutcome: (value: string) => void; onNote: (value: string) => void;
  onFinish: () => void; busy: boolean;
}) {
  return <>
    <div className="panel tint"><h3>How did it go?</h3><p className="body-copy">Every response counts, including when the moment did not work out.</p></div>
    <p className="field-label">What happened?</p>
    <div className="outcome-options" role="group" aria-label="Action outcome">
      {[['done', 'I did it'], ['partly', 'I did some of it'], ['not_today', 'It did not happen']].map(([value, label]) => <button className={`chip ${outcome === value ? 'selected' : ''}`} type="button" aria-pressed={outcome === value} key={value} onClick={() => onOutcome(value)}>{label}</button>)}
    </div>
    <label className="field"><span className="field-label">What did you notice? <span className="muted small">Optional</span></span><textarea className="textarea" value={note} onChange={(event) => onNote(event.target.value)} placeholder="A few words are enough…" /></label>
    <div className="actions"><button className="btn" disabled={!outcome || busy} onClick={onFinish}>{busy ? 'Saving…' : 'Finish activity'}</button></div>
  </>;
}

function ChallengeBaseline({ state, draft, update, busy, onComplete }: {
  state: StudyState; draft: Record<string, unknown>; update: (patch: Record<string, unknown>) => void;
  busy: boolean; onComplete: (data: unknown) => void;
}) {
  const goal = typeof draft.goal === 'string' ? draft.goal : state.onboarding?.goal ?? '';
  const situation = typeof draft.situation === 'string' ? draft.situation : '';
  const value = typeof draft.value === 'string' ? draft.value : '';
  const away = typeof draft.away === 'string' ? draft.away : '';
  const toward = typeof draft.toward === 'string' ? draft.toward : '';
  const action = typeof draft.action === 'string' ? draft.action : '';
  const outcome = typeof draft.outcome === 'string' ? draft.outcome : '';
  const note = typeof draft.note === 'string' ? draft.note : '';
  const phase = typeof draft.phase === 'string' ? draft.phase : 'prepare';
  const startedAt = typeof draft.startedAt === 'number' ? draft.startedAt : 0;
  const returnedAt = typeof draft.returnedAt === 'number' ? draft.returnedAt : 0;
  return <>
    <p className="eyebrow">Five-minute action · first activity</p>
    <h2>Notice your choice point.</h2>
    <p className="lead">Think about what is happening now, the direction you care about, and one small action you choose for yourself.</p>
    {phase === 'prepare' && <>
      <label className="field"><span className="field-label">What goal matters to you right now?</span><input className="text-input" value={goal} onChange={(event) => update({ goal: event.target.value })} placeholder="A direction I want to move toward…" /></label>
      <label className="field"><span className="field-label">What is your current situation?</span><textarea className="textarea" value={situation} onChange={(event) => update({ situation: event.target.value })} placeholder="What is happening around you right now?" /></label>
      <label className="field"><span className="field-label">What personal value could guide you here?</span><input className="text-input" value={value} onChange={(event) => update({ value: event.target.value })} placeholder="For example, curiosity or care" /></label>
      <div className="choice-grid"><div className="choice-card away"><strong>Away from what matters</strong><p>What familiar reaction might pull you away?</p><textarea className="textarea" style={{ marginTop: 12 }} value={away} onChange={(event) => update({ away: event.target.value })} placeholder="I might…" /></div><div className="choice-card toward"><strong>Toward what matters</strong><p>What would a step in your chosen direction look like?</p><textarea className="textarea" style={{ marginTop: 12 }} value={toward} onChange={(event) => update({ toward: event.target.value })} placeholder="I could…" /></div></div>
      <label className="field"><span className="field-label">Choose your own five-minute action</span><span className="field-hint">Make it small enough to start now.</span><input className="text-input" value={action} onChange={(event) => update({ action: event.target.value })} placeholder="For the next five minutes, I will…" /></label>
      <div className="actions"><button className="btn" disabled={!goal.trim() || !situation.trim() || !value.trim() || !away.trim() || !toward.trim() || !action.trim()} onClick={() => update({ phase: 'doing', startedAt: Date.now() })}>Start five minutes</button></div>
    </>}
    {phase === 'doing' && <ActionWindow action={action} startedAt={startedAt} onReturn={() => update({ phase: 'checkin', returnedAt: Date.now() })} />}
    {phase === 'checkin' && <ActionCheckin outcome={outcome} note={note} onOutcome={(value) => update({ outcome: value })} onNote={(value) => update({ note: value })} onFinish={() => onComplete({ goal: goal.trim(), situation: situation.trim(), value: value.trim(), away: away.trim(), toward: toward.trim(), action: action.trim(), startedAt: new Date(startedAt).toISOString(), returnedAt: new Date(returnedAt || Date.now()).toISOString(), outcome, note: note.trim() })} busy={busy} />}
  </>;
}

function ChallengeActive({ state, draft, update, busy, onComplete }: {
  state: StudyState; draft: Record<string, unknown>; update: (patch: Record<string, unknown>) => void;
  busy: boolean; onComplete: (data: unknown) => void;
}) {
  const baseline = state.sessions.challenge_baseline?.data as { goal?: string; situation?: string } | undefined;
  const goal = typeof draft.goal === 'string' ? draft.goal : baseline?.goal ?? state.onboarding?.goal ?? '';
  const situation = typeof draft.situation === 'string' ? draft.situation : baseline?.situation ?? '';
  const phase = typeof draft.phase === 'string' ? draft.phase : 'prepare';
  const proposal = draft.proposal && typeof draft.proposal === 'object' ? draft.proposal as GeneratedChallenge : null;
  const action = typeof draft.action === 'string' ? draft.action : proposal?.action ?? '';
  const outcome = typeof draft.outcome === 'string' ? draft.outcome : '';
  const note = typeof draft.note === 'string' ? draft.note : '';
  const startedAt = typeof draft.startedAt === 'number' ? draft.startedAt : 0;
  const returnedAt = typeof draft.returnedAt === 'number' ? draft.returnedAt : 0;
  const [generating, setGenerating] = useState(false);
  const [localError, setLocalError] = useState('');
  const requestChallenge = async () => {
    if (!goal.trim() || !situation.trim()) return;
    setGenerating(true); setLocalError('');
    try {
      const generated = await generateChallenge({ goal: goal.trim(), situation: situation.trim(), profile: state.onboarding! });
      update({ proposal: generated, action: generated.action, phase: 'proposal' });
    } catch (cause) { setLocalError(errorText(cause)); }
    finally { setGenerating(false); }
  };
  return <>
    <p className="eyebrow">Five-minute action · second activity</p><h2>Make one meaningful move now.</h2>
    <p className="lead">Tell Eudia your goal and what is possible in your current situation. Eudia will shape a challenge you can try in the next five minutes.</p>
    {localError && <div className="inline-error" role="alert">{localError}</div>}
    {phase === 'prepare' && <>
      <label className="field"><span className="field-label">Your goal</span><input className="text-input" value={goal} onChange={(event) => update({ goal: event.target.value })} placeholder="What direction matters now?" /></label>
      <label className="field"><span className="field-label">Your current situation</span><textarea className="textarea" value={situation} onChange={(event) => update({ situation: event.target.value })} placeholder="Where are you? What time and energy do you have? What might get in the way?" /></label>
      <div className="actions"><button className="btn" disabled={!goal.trim() || !situation.trim() || generating} onClick={() => void requestChallenge()}>{generating ? 'Creating your challenge…' : 'Ask Eudia for a challenge'}</button></div>
    </>}
    {phase === 'proposal' && proposal && <>
      <div className="challenge-card"><p className="prompt-meta">EUDIA’S CHALLENGE FOR YOU</p><h3>{proposal.title}</h3><p>{proposal.action}</p><div className="callout"><span className="callout-icon">✦</span><span>{proposal.why}</span></div></div>
      <label className="field"><span className="field-label">Make it fit your moment</span><span className="field-hint">You can adjust the action before you begin.</span><textarea className="textarea" value={action} onChange={(event) => update({ action: event.target.value })} /></label>
      <div className="actions"><button className="btn" disabled={!action.trim()} onClick={() => update({ phase: 'doing', startedAt: Date.now() })}>Start five minutes</button><button className="btn secondary" disabled={generating} onClick={() => void requestChallenge()}>Try another idea</button></div>
    </>}
    {phase === 'doing' && <ActionWindow action={action} startedAt={startedAt} onReturn={() => update({ phase: 'checkin', returnedAt: Date.now() })} />}
    {phase === 'checkin' && <ActionCheckin outcome={outcome} note={note} onOutcome={(value) => update({ outcome: value })} onNote={(value) => update({ note: value })} onFinish={() => onComplete({ goal: goal.trim(), situation: situation.trim(), proposal, action: action.trim(), startedAt: new Date(startedAt).toISOString(), returnedAt: new Date(returnedAt || Date.now()).toISOString(), outcome, note: note.trim() })} busy={busy} />}
  </>;
}
