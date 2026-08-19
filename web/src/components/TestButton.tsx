import { useState } from 'react';
import { useToast } from '../context/ToastContext';
import styles from './TestButton.module.css';

interface TestButtonProps {
  label?: string;
  onTest: () => Promise<{ ok: boolean; detail?: string }>;
  disabled?: boolean;
}

export function TestButton({
  label = 'Test Connection',
  onTest,
  disabled = false,
}: TestButtonProps): JSX.Element {
  const [loading, setLoading] = useState(false);
  const { addToast } = useToast();

  const handleClick = async () => {
    try {
      setLoading(true);
      const result = await onTest();
      if (result.ok) {
        addToast('Connection successful', 'success');
      } else {
        addToast(result.detail ?? 'Test failed', 'error');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Test failed';
      addToast(message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      className={styles.btn}
      onClick={handleClick}
      disabled={loading || disabled}
    >
      {loading ? 'Testing...' : label}
    </button>
  );
}
