import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { ThemeToggle } from './components/ThemeToggle';
import styles from './Nav.module.css';

export default function Nav(): JSX.Element {
  const { user, logout, canWrite } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();

  const closeMobileMenu = () => setMobileMenuOpen(false);

  return (
    <>
      {mobileMenuOpen && (
        <div className={styles.backdrop} onClick={closeMobileMenu} />
      )}

      <button
        className={styles.hamburger}
        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        aria-label="Toggle navigation menu"
        aria-expanded={mobileMenuOpen}
      >
        ☰
      </button>

      <nav className={`${styles.nav} ${mobileMenuOpen ? styles.navOpen : ''}`}>
        <div className={styles.navContent}>
          <span className={styles.logo}>atn-trd</span>
          <NavLink
            to="/"
            className={({ isActive }) => isActive ? styles.activeLink : styles.link}
            onClick={closeMobileMenu}
          >
            Dashboard
          </NavLink>
          <NavLink
            to="/runs"
            className={({ isActive }) => isActive ? styles.activeLink : styles.link}
            onClick={closeMobileMenu}
          >
            Runs
          </NavLink>
          <NavLink
            to="/portfolio"
            className={({ isActive }) => isActive ? styles.activeLink : styles.link}
            onClick={closeMobileMenu}
          >
            Portfolio
          </NavLink>
          <NavLink
            to="/performance"
            className={({ isActive }) => isActive ? styles.activeLink : styles.link}
            onClick={closeMobileMenu}
          >
            Performance
          </NavLink>
          <NavLink
            to="/trades"
            className={({ isActive }) => isActive ? styles.activeLink : styles.link}
            onClick={closeMobileMenu}
          >
            Trades
          </NavLink>
          <NavLink
            to="/calibration"
            className={({ isActive }) => isActive ? styles.activeLink : styles.link}
            onClick={closeMobileMenu}
          >
            Calibration
          </NavLink>
          <NavLink
            to="/backtest"
            className={({ isActive }) => isActive ? styles.activeLink : styles.link}
            onClick={closeMobileMenu}
          >
            Backtest
          </NavLink>
          <NavLink
            to="/settings"
            className={({ isActive }) => isActive ? styles.activeLink : styles.link}
            onClick={closeMobileMenu}
          >
            Settings
          </NavLink>

          <div className={styles.spacer} />

          <div className={styles.userSection}>
            <div className={styles.userInfo}>
              <span className={styles.username}>{user?.username}</span>
              <span className={styles.role}>{canWrite ? 'Admin' : 'Read-only'}</span>
            </div>
            <button className={styles.logoutBtn} onClick={logout}>
              Logout
            </button>
          </div>

          <div className={styles.themeToggleWrapper}>
            <ThemeToggle />
          </div>
        </div>
      </nav>
    </>
  );
}
