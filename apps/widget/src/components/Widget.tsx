import { useState } from 'preact/hooks';
import type { WidgetState } from '../types';
import { ChatWindow } from './ChatWindow';
import { TriggerButton } from './TriggerButton';
import { BubbleNotification } from './BubbleNotification';

/** Main widget container — renders trigger button and conditionally renders chat window */
export function Widget() {
  const [state, setState] = useState<WidgetState>('minimized');

  const handleOpen = () => setState('open');
  const handleClose = () => setState('minimized');

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
