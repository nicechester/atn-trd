import { NavLink } from 'react-router-dom';
import styles from './Nav.module.css';

export default function Nav(): JSX.Element {
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
      <NavLink to="/trades" className={({ isActive }) => isActive ? styles.activeLink : styles.link}>
        Trades
      </NavLink>
      <NavLink to="/settings" className={({ isActive }) => isActive ? styles.activeLink : styles.link}>
        Settings
      </NavLink>
    </nav>
  );
}
