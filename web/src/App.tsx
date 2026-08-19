import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { ToastProvider } from './context/ToastContext';
import Nav from './Nav';
import DashboardPage from './pages/Dashboard';
import SettingsPage from './pages/Settings';
import SecretsPage from './pages/Secrets';
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
              <Route path="/settings/*" element={<SettingsPage />} />
              <Route path="/secrets" element={<SecretsPage />} />
            </Routes>
          </main>
        </div>
      </ToastProvider>
    </Router>
  );
}
