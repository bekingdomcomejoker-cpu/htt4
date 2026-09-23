import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { DEFAULT_MCP_URL } from "./defaults";

export type HistoryEntry = {
  id: string;
  command: string;
  output: string;
  ok: boolean;
  at: number;
};

type OmegaState = {
  url: string;
  apiKey: string;
  unlocked: boolean;
  history: HistoryEntry[];
  cwd: string;
  setUrl: (url: string) => void;
  setApiKey: (apiKey: string) => void;
  unlock: (url: string, apiKey: string) => void;
  lock: () => void;
  pushHistory: (entry: Omit<HistoryEntry, "id" | "at">) => void;
  setCwd: (cwd: string) => void;
};

export const useOmegaStore = create<OmegaState>()(
  persist(
    (set) => ({
      url: DEFAULT_MCP_URL,
      apiKey: "",
      unlocked: false,
      history: [],
      cwd: ".",
      setUrl: (url) => set({ url }),
      setApiKey: (apiKey) => set({ apiKey }),
      unlock: (url, apiKey) => set({ url, apiKey, unlocked: true }),
      lock: () => set({ unlocked: false, apiKey: "", history: [] }),
      pushHistory: (entry) =>
        set((state) => ({
          history: [
            {
              ...entry,
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              at: Date.now(),
            },
            ...state.history,
          ].slice(0, 40),
        })),
      setCwd: (cwd) => set({ cwd }),
    }),
    {
      name: "omega-pool-session",
      storage: createJSONStorage(() => sessionStorage),
      skipHydration: true,
      partialize: (state) => ({
        url: state.url,
        apiKey: state.apiKey,
        unlocked: state.unlocked,
        cwd: state.cwd,
      }),
    },
  ),
);
