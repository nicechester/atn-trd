import { ReactNode } from 'react';
import styles from './Card.module.css';

interface CardProps {
  title?: string;
  children: ReactNode;
  className?: string;
}

export function Card({ title, children, className }: CardProps): JSX.Element {
  const classes = className ? `${styles.card} ${className}` : styles.card;

  return (
    <div className={classes}>
      {title && <h2 className={styles.title}>{title}</h2>}
      {children}
    </div>
  );
}
