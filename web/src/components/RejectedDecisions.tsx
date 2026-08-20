import type { RejectionRow } from '../api/client';
import styles from '../pages/RunDetail.module.css';

interface Props {
  rejections: RejectionRow[];
}

export function RejectedDecisions({ rejections }: Props) {
  if (rejections.length === 0) {
    return null;
  }

  return (
    <div className={styles.section}>
      <h3>⚠️ Rejected Decisions ({rejections.length})</h3>
      <p className={styles.muted}>
        These decisions were generated but rejected by the risk engine. Hover over reason for details.
      </p>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.th}>Symbol</th>
            <th className={styles.th}>Action</th>
            <th className={styles.th}>Confidence</th>
            <th className={styles.th}>Target %</th>
            <th className={styles.th}>Rejection Reason</th>
          </tr>
        </thead>
        <tbody>
          {rejections.map((rejection) => (
            <tr key={rejection.id}>
              <td className={styles.td}>{rejection.symbol}</td>
              <td className={styles.td}>
                <span className={`${styles.badge} ${styles.badgeGray}`}>
                  {rejection.action}
                </span>
              </td>
              <td className={styles.td}>
                {(rejection.confidence * 100).toFixed(0)}%
              </td>
              <td className={styles.td}>
                {rejection.targetWeight !== null ? `${(rejection.targetWeight * 100).toFixed(1)}%` : '—'}
              </td>
              <td className={styles.td} title={rejection.reason}>
                <span className={styles.muted}>{rejection.reason}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
