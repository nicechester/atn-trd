import styles from './Toast.module.css';

interface ToastItemProps {
  message: string;
  type: 'success' | 'error' | 'info';
  onDismiss: () => void;
}

export function Toast({ message, type, onDismiss }: ToastItemProps): JSX.Element {
  const toastClass = styles[type] || '';

  return (
    <div className={`${styles.toast} ${toastClass}`}>
      <span>{message}</span>
      <button className={styles.dismiss} onClick={onDismiss} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}
