import { create } from "zustand";

export type PairingStatus = "unpaired" | "pairing" | "paired";

interface PairingState {
  status: PairingStatus;
  roomId: string | null;
  setStatus: (status: PairingStatus, roomId?: string | null) => void;
  reset: () => void;
}

export const usePairingStore = create<PairingState>((set) => ({
  status: "unpaired",
  roomId: null,
  setStatus: (status, roomId) => set({ status, roomId: roomId ?? null }),
  reset: () => set({ status: "unpaired", roomId: null })
}));
