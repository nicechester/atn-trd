import { useEffect, useState } from 'react';
import { api, type CalibrationReport } from '../api/client';
import { useToast } from '../context/ToastContext';
import styles from './Calibration.module.css';

export default function CalibrationPage(): JSX.Element {
  const [data, setData] = useState<CalibrationReport | null>(null);
  const [loading, setLoading] = useState(true);
  const { addToast } = useToast();

  useEffect(() => {
    api.calibration.get()
      .then(res => setData(res.data))
      .catch(e => addToast(e instanceof Error ? e.message : 'Failed to load calibration', 'error'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p>Loading…</p>;

  return (
    <div>
      <h1 className={styles.title}>Confidence Calibration</h1>
      {data && data.totalPending > 0 && (
        <p className={styles.muted}>{data.totalPending} prediction{data.totalPending !== 1 ? 's' : ''} awaiting actual returns.</p>
      )}
      {!data || data.bands.length === 0 ? (
        <p className={styles.muted}>No calibration data yet. Run the agent to generate predictions.</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.th}>Confidence Band</th>
              <th className={`${styles.th} ${styles.tdNum}`}>Predictions</th>
              <th className={`${styles.th} ${styles.tdNum}`}>Correct</th>
              <th className={`${styles.th} ${styles.tdNum}`}>Accuracy</th>
              <th className={`${styles.th} ${styles.tdNum}`}>Avg 5d Return</th>
              <th className={`${styles.th} ${styles.tdNum}`}>Avg 20d Return</th>
            </tr>
          </thead>
          <tbody>
            {data.bands.map(b => {
              const accuracy = b.count > 0 ? (b.correctCount / b.count) * 100 : null;
              return (
                <tr key={b.band} className={styles.tr}>
                  <td className={styles.td}>{b.band}</td>
                  <td className={`${styles.td} ${styles.tdNum}`}>{b.count}</td>
                  <td className={`${styles.td} ${styles.tdNum}`}>{b.correctCount}</td>
                  <td className={`${styles.td} ${styles.tdNum}`}>
                    {accuracy !== null ? `${accuracy.toFixed(1)}%` : '—'}
                  </td>
                  <td className={`${styles.td} ${styles.tdNum} ${b.avgReturn5d !== null ? (b.avgReturn5d >= 0 ? styles.positive : styles.negative) : ''}`}>
                    {b.avgReturn5d !== null ? `${(b.avgReturn5d * 100).toFixed(2)}%` : '—'}
                  </td>
                  <td className={`${styles.td} ${styles.tdNum} ${b.avgReturn20d !== null ? (b.avgReturn20d >= 0 ? styles.positive : styles.negative) : ''}`}>
                    {b.avgReturn20d !== null ? `${(b.avgReturn20d * 100).toFixed(2)}%` : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
