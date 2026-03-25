import { useState, useEffect, useRef } from 'preact/hooks';
import type { WidgetState } from '../types';
import { ChatWindow } from './ChatWindow';
import { TriggerButton } from './TriggerButton';
import { BubbleNotification } from './BubbleNotification';

/** Callback registration for external control (global API) */
let externalOpenFn: (() => void) | null = null;
let externalCloseFn: (() => void) | null = null;

export function registerWidgetControls(open: () => void, close: () => void): void {
  externalOpenFn = open;
  externalCloseFn = close;
}

export function unregisterWidgetControls(): void {
  externalOpenFn = null;
  externalCloseFn = null;
}

export function triggerOpen(): void {
  externalOpenFn?.();
}

export function triggerClose(): void {
  externalCloseFn?.();
}

interface WidgetProps {
  agentId: string;
}

/** Main widget container — renders trigger button and conditionally renders chat window */
export function Widget({ agentId }: WidgetProps) {
  // agentId will be used by config-loader (Story 5-4) to fetch widget configuration
  void agentId;
  const [state, setState] = useState<WidgetState>('minimized');

  const handleOpen = () => setState('open');
  const handleClose = () => setState('minimized');

  // Use refs so registered callbacks always point to latest handlers
  const openRef = useRef(handleOpen);
  const closeRef = useRef(handleClose);
  openRef.current = handleOpen;
  closeRef.current = handleClose;

  useEffect(() => {
    registerWidgetControls(
      () => openRef.current(),
      () => closeRef.current(),
    );
    return () => unregisterWidgetControls();
  }, []);

  return (
    <div class="cw-widget">
      {state === 'open' ? (
        <ChatWindow onClose={handleClose} />
      ) : (
        <>
          <BubbleNotification />
          <TriggerButton onClick={handleOpen} />
        </>
      )}
    </div>
  );
}
