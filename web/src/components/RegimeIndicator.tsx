import { useEffect, useState } from 'react';
import { regime as regimeApi, type MarketRegime } from '../api/client';
import styles from './RegimeIndicator.module.css';

export function RegimeIndicator() {
  const [regime, setRegime] = useState<MarketRegime | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    regimeApi.current()
      .then(res => setRegime(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading || !regime) return null;

  const icon = regime.regime === 'RISK_ON' ? '🟢' : regime.regime === 'RISK_OFF' ? '🔴' : '🟡';
  const className = regime.regime === 'RISK_ON' 
    ? styles.riskOn 
    : regime.regime === 'RISK_OFF' 
      ? styles.riskOff 
      : styles.neutral;

  return (
    <div className={`${styles.indicator} ${className}`} title={`VIX: ${regime.vixLevel?.toFixed(1) ?? 'N/A'}`}>
      <span className={styles.icon}>{icon}</span>
      <span className={styles.label}>{regime.regime.replace('_', ' ')}</span>
      <span className={styles.streak}>Day {regime.streak}</span>
    </div>
  );
}
