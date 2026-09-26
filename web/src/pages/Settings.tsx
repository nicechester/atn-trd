import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import styles from './Settings.module.css';
import SettingsGeneral from './SettingsGeneral';
import SettingsWatchlist from './SettingsWatchlist';
import SettingsSchedule from './SettingsSchedule';
import SettingsRisk from './SettingsRisk';
import SettingsInvestorProfile from './SettingsInvestorProfile';
import SettingsDataSources from './SettingsDataSources';
import SettingsLlm from './SettingsLlm';
import SettingsStrategic from './SettingsStrategic';

export default function SettingsPage(): JSX.Element {
  return (
    <div>
      <h1>Settings</h1>
      <nav className={styles.subNav}>
        <NavLink to="/settings/general" className={styles.subLink} end>General</NavLink>
        <NavLink to="/settings/watchlist" className={styles.subLink} end>Watchlist</NavLink>
        <NavLink to="/settings/schedule" className={styles.subLink} end>Schedules</NavLink>
        <NavLink to="/settings/risk" className={styles.subLink} end>Risk</NavLink>
        <NavLink to="/settings/investor-profile" className={styles.subLink} end>Investor Profile</NavLink>
        <NavLink to="/settings/data-sources" className={styles.subLink} end>Data Sources</NavLink>
        <NavLink to="/settings/llm" className={styles.subLink} end>LLM</NavLink>
        <NavLink to="/settings/strategic" className={styles.subLink} end>Strategic</NavLink>
      </nav>
      <Routes>
        <Route index element={<Navigate to="general" replace />} />
        <Route path="general/*" element={<SettingsGeneral />} />
        <Route path="watchlist/*" element={<SettingsWatchlist />} />
        <Route path="schedule/*" element={<SettingsSchedule />} />
        <Route path="risk/*" element={<SettingsRisk />} />
        <Route path="investor-profile/*" element={<SettingsInvestorProfile />} />
        <Route path="data-sources/*" element={<SettingsDataSources />} />
        <Route path="llm/*" element={<SettingsLlm />} />
        <Route path="strategic/*" element={<SettingsStrategic />} />
      </Routes>
    </div>
  );
}
