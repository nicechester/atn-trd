import { NavLink } from 'react-router-dom';
import styles from './Nav.module.css';

export default function Nav(): JSX.Element {
  return (
    <nav className={styles.nav}>
      <span className={styles.logo}>atn-trd</span>
      <NavLink to="/" className={styles.link}>
        Dashboard
      </NavLink>
      <NavLink to="/settings" className={styles.link}>
        Settings
      </NavLink>
    </nav>
  );
}
