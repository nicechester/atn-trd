import { useState } from 'react';
import styles from './SecretField.module.css';

interface SecretFieldProps {
  label: string;
  name: string;
  isSet: boolean;
  onSet: (value: string) => Promise<void>;
  onClear: () => Promise<void>;
}

export function SecretField({
  label,
  name: _name,
  isSet,
  onSet,
  onClear,
}: SecretFieldProps): JSX.Element {
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState<'set' | 'clear' | null>(null);

  const handleSet = async () => {
    try {
      setLoading('set');
      await onSet(value);
      setValue('');
    } finally {
      setLoading(null);
    }
  };

  const handleClear = async () => {
    try {
      setLoading('clear');
      await onClear();
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className={styles.row}>
      <label className={styles.label}>{label}</label>
      <span className={styles.status}>{isSet ? '••••••••' : 'Not set'}</span>
      <input
        type="password"
        className={styles.input}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="New value"
      />
      <button
        className={styles.btnSet}
        onClick={handleSet}
        disabled={value.trim().length === 0 || loading !== null}
      >
        {loading === 'set' ? 'Setting...' : 'Set'}
      </button>
      <button
        className={styles.btnClear}
        onClick={handleClear}
        disabled={!isSet || loading !== null}
      >
        {loading === 'clear' ? 'Clearing...' : 'Clear'}
      </button>
    </div>
  );
}
