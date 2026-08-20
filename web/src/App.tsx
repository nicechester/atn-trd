import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { ToastProvider } from './context/ToastContext';
import Nav from './Nav';
import DashboardPage from './pages/Dashboard';
import SettingsPage from './pages/Settings';
import SecretsPage from './pages/Secrets';
import RunsListPage from './pages/RunsList';
import RunDetailPage from './pages/RunDetail';
import PortfolioPage from './pages/Portfolio';
import TradesPage from './pages/Trades';
import CalibrationPage from './pages/Calibration';
import styles from './App.module.css';

export default function App(): JSX.Element {
  return (
    <Router>
      <ToastProvider>
        <div className={styles.layout}>
          <Nav />
          <main className={styles.main}>
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/runs" element={<RunsListPage />} />
              <Route path="/runs/:id" element={<RunDetailPage />} />
              <Route path="/portfolio" element={<PortfolioPage />} />
              <Route path="/trades" element={<TradesPage />} />
              <Route path="/calibration" element={<CalibrationPage />} />
              <Route path="/settings/*" element={<SettingsPage />} />
              <Route path="/secrets" element={<SecretsPage />} />
            </Routes>
          </main>
        </div>
      </ToastProvider>
    </Router>
  );
}
