import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

interface UIState {
  sidebarOpen: boolean;
  activeModal: string | null;
  toggleSidebar: () => void;
  openModal: (modal: string) => void;
  closeModal: () => void;
}

export const useUIStore = create<UIState>()(
  devtools(
    persist(
      (set) => ({
        sidebarOpen: true,
        activeModal: null,
        toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
        openModal: (modal: string) => set({ activeModal: modal }),
        closeModal: () => set({ activeModal: null }),
      }),
      { name: 'codeweaves-ui' },
    ),
  ),
);
