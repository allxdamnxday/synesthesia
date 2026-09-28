import { useEffect } from 'react';
import { useStudioStore } from '../../state/studioStore';
import {
  commandForKey,
  isTypingTarget,
  usesSpace,
  type StudioCommand,
} from '../../studio/keyboard';

/** Menus, pickers, popovers and dialogs keep their own keys. */
const OWN_KEYS = '[popover], dialog, [role="dialog"], [role="menu"], [role="listbox"]';

function run(command: StudioCommand): void {
  const s = useStudioStore.getState();
  switch (command.type) {
    case 'play-pause':
      s.togglePlay();
      break;
    case 'loop':
      s.setLoop(!s.loop);
      break;
    case 'recall':
      s.recallSnapshot(command.slot);
      break;
    case 'store':
      s.storeSnapshot(command.slot);
      break;
    case 'chance':
      s.setChanceOpen(!s.chanceOpen);
      break;
    case 'save':
      void s.save();
      break;
    case 'render':
      s.setRenderOpen(true);
      break;
    case 'presentation':
      s.setPresentation(!s.presentation);
      break;
    case 'exit-presentation':
      s.setPresentation(false);
      break;
    case 'undo':
      s.undo();
      break;
    case 'redo':
      s.redo();
      break;
  }
}

/** Studio keyboard shortcuts (SPEC 13.4); ignored while typing in a text field. */
export function useStudioKeyboard(): void {
  useEffect(() => {
    // Space on a focused button would also press it when the key comes up; stop that.
    let swallowSpaceUp = false;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const s = useStudioStore.getState();
      if (s.status !== 'ready' || s.renderOpen) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest(OWN_KEYS)) return;
      const command = commandForKey(e, {
        typing: isTypingTarget(target),
        spaceControl: usesSpace(target),
        presentation: s.presentation,
      });
      if (!command) return;
      e.preventDefault();
      if (command.type === 'play-pause') swallowSpaceUp = true;
      run(command);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ' && swallowSpaceUp) {
        swallowSpaceUp = false;
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);
}
