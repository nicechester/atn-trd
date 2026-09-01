import { useTheme } from '../context/ThemeContext';
import styles from './ThemeToggle.module.css';

export function ThemeToggle(): JSX.Element {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      className={styles.toggle}
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      title={`Current theme: ${theme}`}
    >
      {theme === 'dark' ? '☀️' : '🌙'}
    </button>
  );
}
