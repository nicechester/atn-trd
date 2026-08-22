import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import styles from './Settings.module.css';
import SettingsGeneral from './SettingsGeneral';
import SettingsWatchlist from './SettingsWatchlist';
import SettingsSchedule from './SettingsSchedule';
import SettingsRisk from './SettingsRisk';
import SettingsInvestorProfile from './SettingsInvestorProfile';
import SettingsDataSources from './SettingsDataSources';
import SettingsLlm from './SettingsLlm';

export default function SettingsPage(): JSX.Element {
  return (
    <div>
      <h1>Settings</h1>
      <nav className={styles.subNav}>
        <NavLink to="general" className={styles.subLink}>General</NavLink>
        <NavLink to="watchlist" className={styles.subLink}>Watchlist</NavLink>
        <NavLink to="schedule" className={styles.subLink}>Schedule</NavLink>
        <NavLink to="risk" className={styles.subLink}>Risk</NavLink>
        <NavLink to="investor-profile" className={styles.subLink}>Investor Profile</NavLink>
        <NavLink to="data-sources" className={styles.subLink}>Data Sources</NavLink>
        <NavLink to="llm" className={styles.subLink}>LLM</NavLink>
      </nav>
      <Routes>
        <Route index element={<Navigate to="general" replace />} />
        <Route path="general" element={<SettingsGeneral />} />
        <Route path="watchlist" element={<SettingsWatchlist />} />
        <Route path="schedule" element={<SettingsSchedule />} />
        <Route path="risk" element={<SettingsRisk />} />
        <Route path="investor-profile" element={<SettingsInvestorProfile />} />
        <Route path="data-sources" element={<SettingsDataSources />} />
        <Route path="llm" element={<SettingsLlm />} />
      </Routes>
    </div>
  );
}
