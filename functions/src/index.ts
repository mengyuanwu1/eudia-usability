import { getApps, initializeApp } from 'firebase-admin/app';

if (getApps().length === 0) initializeApp();

export {
  studyCategorizeBps,
  studyRecommendPhilosopher,
  studyPhilosophyTurn,
  studyGenerateChallenge,
} from './studyAi';

export {
  studyGetState,
  studySaveOnboarding,
  studySaveCalendarEvents,
  studySaveSession,
  studySaveSurvey,
  studyLogEvent,
} from './studyState';
