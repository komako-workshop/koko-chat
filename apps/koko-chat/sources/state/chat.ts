import { create } from "zustand";

let localMessageSequence = 0;

function createLocalMessageId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  localMessageSequence += 1;
  return `local-${Date.now()}-${localMessageSequence}`;
}

export interface Message {
  /** Stable local message id (uuid), distinct from any server id. */
  id: string;
  role: "user" | "agent";
  text: string;
  /** Optional server run id (multiple delta events share the same runId). */
  runId?: string;
  streaming?: boolean;
  timestamp: number;
}

interface ChatState {
  messages: Message[];
  append: (message: Message) => void;
  updateStreaming: (runId: string, text: string, done: boolean) => void;
  clear: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  append: (message) => set((state) => ({ messages: [...state.messages, message] })),
  updateStreaming: (runId, text, done) =>
    set((state) => {
      const idx = state.messages.findIndex((message) => message.runId === runId && message.role === "agent");

      if (idx < 0) {
        return {
          messages: [
            ...state.messages,
            {
              id: createLocalMessageId(),
              role: "agent",
              text,
              runId,
              streaming: !done,
              timestamp: Date.now()
            }
          ]
        };
      }

      const updated = [...state.messages];
      const existing = updated[idx];

      if (existing === undefined) {
        return { messages: state.messages };
      }

      updated[idx] = { ...existing, text, streaming: !done };
      return { messages: updated };
    }),
  clear: () => set({ messages: [] })
}));
