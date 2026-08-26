import { NavLink } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import styles from './Nav.module.css';

export default function Nav(): JSX.Element {
  const { user, logout, canWrite } = useAuth();

  return (
    <nav className={styles.nav}>
      <span className={styles.logo}>atn-trd</span>
      <NavLink to="/" className={({ isActive }) => isActive ? styles.activeLink : styles.link}>
        Dashboard
      </NavLink>
      <NavLink to="/runs" className={({ isActive }) => isActive ? styles.activeLink : styles.link}>
        Runs
      </NavLink>
      <NavLink to="/portfolio" className={({ isActive }) => isActive ? styles.activeLink : styles.link}>
        Portfolio
      </NavLink>
      <NavLink to="/performance" className={({ isActive }) => isActive ? styles.activeLink : styles.link}>
        Performance
      </NavLink>
      <NavLink to="/trades" className={({ isActive }) => isActive ? styles.activeLink : styles.link}>
        Trades
      </NavLink>
      <NavLink to="/calibration" className={({ isActive }) => isActive ? styles.activeLink : styles.link}>
        Calibration
      </NavLink>
      <NavLink to="/backtest" className={({ isActive }) => isActive ? styles.activeLink : styles.link}>
        Backtest
      </NavLink>
      <NavLink to="/settings" className={({ isActive }) => isActive ? styles.activeLink : styles.link}>
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
    </nav>
  );
}
