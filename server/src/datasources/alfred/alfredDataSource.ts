/**
 * ALFRED Data Source for Backtesting
 *
 * Provides point-in-time macro data (VIX, yield curve) from prefetched alfred.db.
 * Used by ReplayRunner for regime detection without look-ahead bias.
 */

import Database from 'better-sqlite3';
import { logger } from '../../lib/logger.js';

const log = logger.child({ component: 'alfred-datasource' });

export interface AlfredObservation {
  seriesId: string;
  vintageDate: string;
  observationDate: string;
  value: number;
}

export interface AlfredDataSourceOptions {
  dbPath: string;
}

export class AlfredDataSource {
  private readonly db: Database.Database;
  private readonly stmtGetVintage: Database.Statement;
  private readonly stmtGetLatestBefore: Database.Statement;

  constructor(options: AlfredDataSourceOptions) {
    this.db = new Database(options.dbPath, { readonly: true });

    // Get exact vintage for a date
    this.stmtGetVintage = this.db.prepare(`
      SELECT series_id as seriesId, vintage_date as vintageDate, 
             observation_date as observationDate, value
      FROM macro_vintage
      WHERE series_id = ? AND vintage_date = ?
    `);

    // Get most recent vintage on or before a date (for weekends/holidays)
    this.stmtGetLatestBefore = this.db.prepare(`
      SELECT series_id as seriesId, vintage_date as vintageDate,
             observation_date as observationDate, value
      FROM macro_vintage
      WHERE series_id = ? AND vintage_date <= ?
      ORDER BY vintage_date DESC
      LIMIT 1
    `);

    log.info('alfred datasource initialized', { dbPath: options.dbPath });
  }

  /**
   * Get macro value as it was known on a specific date.
   * Falls back to most recent available if exact date not found.
   */
  getVintage(seriesId: string, asOfDate: string): AlfredObservation | null {
    // Try exact date first
    let row = this.stmtGetVintage.get(seriesId.toUpperCase(), asOfDate) as AlfredObservation | null;
    
    // Fall back to most recent before date (handles weekends/holidays)
    if (!row) {
      row = this.stmtGetLatestBefore.get(seriesId.toUpperCase(), asOfDate) as AlfredObservation | null;
    }

    return row;
  }

  /**
   * Get VIX value as of date.
   */
  getVix(asOfDate: string): number | null {
    const obs = this.getVintage('VIXCLS', asOfDate);
    return obs?.value ?? null;
  }

  /**
   * Get 10Y-2Y yield curve spread as of date.
   * Computed from DGS10 - DGS2 (T10Y2Y doesn't support ALFRED vintage queries).
   */
  getYieldCurve(asOfDate: string): number | null {
    const dgs10 = this.getVintage('DGS10', asOfDate);
    const dgs2 = this.getVintage('DGS2', asOfDate);
    if (dgs10?.value == null || dgs2?.value == null) return null;
    return dgs10.value - dgs2.value;
  }

  /**
   * Get date range available in the database (from metadata table).
   */
  getDateRange(): { minDate: string; maxDate: string } | null {
    const row = this.db.prepare(`
      SELECT 
        (SELECT value FROM dataset_meta WHERE key = 'min_date') as minDate,
        (SELECT value FROM dataset_meta WHERE key = 'max_date') as maxDate
    `).get() as { minDate: string; maxDate: string } | null;
    return row?.minDate ? row : null;
  }

  /**
   * Get count of observations per series.
   */
  getStats(): Array<{ seriesId: string; count: number; minDate: string; maxDate: string }> {
    return this.db.prepare(`
      SELECT series_id as seriesId, COUNT(*) as count,
             MIN(vintage_date) as minDate, MAX(vintage_date) as maxDate
      FROM macro_vintage
      GROUP BY series_id
    `).all() as Array<{ seriesId: string; count: number; minDate: string; maxDate: string }>;
  }

  close(): void {
    this.db.close();
  }
}
