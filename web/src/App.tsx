import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { ToastProvider } from './context/ToastContext';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import Nav from './Nav';
import LoginPage from './pages/Login';
import DashboardPage from './pages/Dashboard';
import SettingsPage from './pages/Settings';
import SecretsPage from './pages/Secrets';
import RunsListPage from './pages/RunsList';
import RunDetailPage from './pages/RunDetail';
import PortfolioPage from './pages/Portfolio';
import TradesPage from './pages/Trades';
import CalibrationPage from './pages/Calibration';
import PerformancePage from './pages/Performance';
import BacktestPage from './pages/Backtest';
import PlansPage from './pages/Plans';
import styles from './App.module.css';

function AppContent(): JSX.Element {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className={styles.loading}>Loading...</div>;
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <div className={styles.layout}>
      <Nav />
      <main className={styles.main}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/runs" element={<RunsListPage />} />
          <Route path="/runs/:id" element={<RunDetailPage />} />
          <Route path="/portfolio" element={<PortfolioPage />} />
          <Route path="/performance" element={<PerformancePage />} />
          <Route path="/trades" element={<TradesPage />} />
          <Route path="/calibration" element={<CalibrationPage />} />
          <Route path="/backtest" element={<BacktestPage />} />
          <Route path="/backtest/:id" element={<BacktestPage />} />
          <Route path="/plans" element={<PlansPage />} />
          <Route path="/plans/:id" element={<PlansPage />} />
          <Route path="/settings/*" element={<SettingsPage />} />
          <Route path="/secrets" element={<SecretsPage />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App(): JSX.Element {
  return (
    <ThemeProvider>
      <Router>
        <AuthProvider>
          <ToastProvider>
            <AppContent />
          </ToastProvider>
        </AuthProvider>
      </Router>
    </ThemeProvider>
  );
}
