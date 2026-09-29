/**
 * Kept so existing imports keep working: `ControlBus` itself now anchors its held value when
 * it is cancelled after everything it scheduled (see automation.ts), which is all this class
 * used to add. Use `ControlBus` in new code.
 *
 * @deprecated Use ControlBus.
 */
export { ControlBus as HoldingControlBus } from './automation';
