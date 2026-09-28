/**
 * Presentation mode (SPEC 6.3, 13.1): only the wake is shown. The Studio turns it on and
 * off; the app shell reads it to hide its own header.
 */
import { create } from 'zustand';

export interface PresentationState {
  active: boolean;
  setActive: (active: boolean) => void;
}

export const usePresentationStore = create<PresentationState>()((set) => ({
  active: false,
  setActive: (active) => set({ active }),
}));
