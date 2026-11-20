import { ConfirmDialog, Dialog } from '../../ui/overlays.jsx';

/** Native modal with keyboard dismissal and focus restoration (`drawer` docks it to the inline end). */
export function Modal(props) {
  return <Dialog {...props} />;
}

export { ConfirmDialog };
