import { create } from "zustand";

interface MockTestQuestion {
  text: string;
  options: string[];
}

interface MockTestState {
  attemptId: string;
  testId: string;
  questions: MockTestQuestion[];
  answers: Record<number, number>;
  currentQuestion: number;
  startedAt: string;
  durationSec: number;
  status: "idle" | "in_progress" | "submitted";

  initializeAttempt: (params: {
    attemptId: string;
    testId: string;
    questions: MockTestQuestion[];
    startedAt: string;
    durationSec: number;
  }) => void;

  selectAnswer: (questionIndex: number, optionIndex: number) => void;
  nextQuestion: () => void;
  previousQuestion: () => void;
  goToQuestion: (index: number) => void;
  hydrate: (attemptId: string) => boolean;
  markSubmitted: () => void;
  reset: () => void;
}

const STORAGE_KEY = "mock_test_attempt";

function loadFromStorage(attemptId: string): Partial<MockTestState> | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<MockTestState>;
    if (data.attemptId !== attemptId) return null;
    return data;
  } catch {
    return null;
  }
}

function saveToStorage(state: Partial<MockTestState>) {
  try {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        attemptId: state.attemptId,
        testId: state.testId,
        questions: state.questions,
        answers: state.answers,
        currentQuestion: state.currentQuestion,
        startedAt: state.startedAt,
        durationSec: state.durationSec,
        status: state.status,
      }),
    );
  } catch {
    // ignore storage errors
  }
}

export const useMockTestStore = create<MockTestState>((set, get) => ({
  attemptId: "",
  testId: "",
  questions: [],
  answers: {},
  currentQuestion: 0,
  startedAt: "",
  durationSec: 0,
  status: "idle",

  initializeAttempt: (params) => {
    set({
      attemptId: params.attemptId,
      testId: params.testId,
      questions: params.questions,
      answers: {},
      currentQuestion: 0,
      startedAt: params.startedAt,
      durationSec: params.durationSec,
      status: "in_progress",
    });
    saveToStorage(get());
  },

  selectAnswer: (questionIndex, optionIndex) => {
    set((state) => {
      const updated = { ...state.answers, [questionIndex]: optionIndex };
      return { answers: updated };
    });
    saveToStorage(get());
  },

  nextQuestion: () => {
    set((state) => ({
      currentQuestion: Math.min(state.currentQuestion + 1, state.questions.length - 1),
    }));
  },

  previousQuestion: () => {
    set((state) => ({
      currentQuestion: Math.max(state.currentQuestion - 1, 0),
    }));
  },

  goToQuestion: (index) => {
    set((state) => ({
      currentQuestion: Math.max(0, Math.min(index, state.questions.length - 1)),
    }));
  },

  hydrate: (attemptId) => {
    const saved = loadFromStorage(attemptId);
    if (saved && saved.status === "in_progress") {
      set({
        attemptId: saved.attemptId ?? "",
        testId: saved.testId ?? "",
        questions: saved.questions ?? [],
        answers: saved.answers ?? {},
        currentQuestion: saved.currentQuestion ?? 0,
        startedAt: saved.startedAt ?? "",
        durationSec: saved.durationSec ?? 0,
        status: saved.status,
      });
      return true;
    }

    return false;
  },

  markSubmitted: () => {
    set({ status: "submitted" });
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  },

  reset: () => {
    set({
      attemptId: "",
      testId: "",
      questions: [],
      answers: {},
      currentQuestion: 0,
      startedAt: "",
      durationSec: 0,
      status: "idle",
    });
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  },
}));
