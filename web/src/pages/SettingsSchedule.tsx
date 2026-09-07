import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Card } from '../components/Card';
import { useToast } from '../context/ToastContext';
import styles from './SettingsForm.module.css';

type JobSchedule = {
  name: string;
  cron: string;
  nextRun: string | null;
  enabled: boolean;
};

// Presets available for all jobs (times in ET)
const PRESETS = [
  { label: '9:30 AM (Market Open)', cron: '30 9 * * 1-5' },
  { label: '12:00 PM (Midday)', cron: '0 12 * * 1-5' },
  { label: '3:30 PM', cron: '30 15 * * 1-5' },
  { label: '4:00 PM', cron: '0 16 * * 1-5' },
  { label: '4:30 PM', cron: '30 16 * * 1-5' },
  { label: '5:00 PM', cron: '0 17 * * 1-5' },
  { label: 'Monday only 4:00 PM', cron: '0 16 * * 1' },
  { label: 'Sunday 10:00 AM', cron: '0 10 * * 0' },
  { label: '1st of month 10:00 AM', cron: '0 10 1 * *' },
  { label: 'Quarterly (Jan/Apr/Jul/Oct)', cron: '0 10 1 1,4,7,10 *' },
];

type EditMode = 'disabled' | 'preset' | 'custom';

/** Parse cron expression to human-readable string */
function parseCron(cron: string): { valid: boolean; description: string } {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    return { valid: false, description: 'Invalid: expected 5 fields (min hour dom month dow)' };
  }

  const [minute, hour, dom, month, dow] = parts;

  // Validate minute (0-59)
  if (!/^(\*|[0-5]?\d)$/.test(minute)) {
    return { valid: false, description: 'Invalid minute (0-59)' };
  }

  // Validate hour (0-23)
  if (!/^(\*|1?\d|2[0-3])$/.test(hour)) {
    return { valid: false, description: 'Invalid hour (0-23)' };
  }

  // Build description
  const timePart = hour !== '*' && minute !== '*'
    ? formatTime(parseInt(hour), parseInt(minute))
    : 'every minute';

  const dowPart = parseDow(dow);
  const domPart = parseDom(dom);
  const monthPart = parseMonth(month);

  let desc = timePart;
  
  if (dowPart) desc += ` ${dowPart}`;
  if (domPart) desc += ` ${domPart}`;
  if (monthPart) desc += ` ${monthPart}`;

  return { valid: true, description: desc };
}

function formatTime(hour: number, minute: number): string {
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h = hour % 12 || 12;
  const m = minute.toString().padStart(2, '0');
  return `${h}:${m} ${ampm}`;
}

function parseDow(dow: string): string {
  if (dow === '*') return 'daily';
  if (dow === '0') return 'on Sundays';
  if (dow === '1') return 'on Mondays';
  if (dow === '2') return 'on Tuesdays';
  if (dow === '3') return 'on Wednesdays';
  if (dow === '4') return 'on Thursdays';
  if (dow === '5') return 'on Fridays';
  if (dow === '6') return 'on Saturdays';
  if (dow === '1-5') return 'weekdays';
  if (dow === '0,6') return 'weekends';
  return `on days ${dow}`;
}

function parseDom(dom: string): string {
  if (dom === '*') return '';
  if (dom === '1') return 'on the 1st';
  if (dom === '15') return 'on the 15th';
  return `on day ${dom}`;
}

function parseMonth(month: string): string {
  if (month === '*') return '';
  const monthNames: Record<string, string> = {
    '1': 'Jan', '2': 'Feb', '3': 'Mar', '4': 'Apr',
    '5': 'May', '6': 'Jun', '7': 'Jul', '8': 'Aug',
    '9': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Dec',
  };
  if (month.includes(',')) {
    const months = month.split(',').map(m => monthNames[m] || m).join('/');
    return `in ${months}`;
  }
  return monthNames[month] ? `in ${monthNames[month]}` : `in month ${month}`;
}

export default function SettingsSchedule(): JSX.Element {
  const { addToast } = useToast();
  const [jobs, setJobs] = useState<JobSchedule[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [selectedJob, setSelectedJob] = useState<string | null>(null);
  const [editMode, setEditMode] = useState<EditMode>('preset');
  const [selectedPreset, setSelectedPreset] = useState('');
  const [customCron, setCustomCron] = useState('');
  const [saving, setSaving] = useState(false);
  const [timezone, setTimezone] = useState('America/New_York');

  function fetchJobs() {
    setLoadingJobs(true);
    fetch('/api/scheduler/jobs')
      .then(res => res.json())
      .then(data => setJobs(data.jobs ?? []))
      .catch(() => setJobs([]))
      .finally(() => setLoadingJobs(false));
  }

  useEffect(() => {
    api.settings.get()
      .then(res => setTimezone(res.data.schedule.timezone))
      .catch(() => {});
    fetchJobs();
  }, []);

  function handleSelectJob(jobName: string) {
    const job = jobs.find(j => j.name === jobName);
    if (!job) return;
    
    setSelectedJob(jobName);
    
    // Determine current mode
    if (!job.enabled || job.cron === 'manual') {
      setEditMode('disabled');
      setSelectedPreset('');
      setCustomCron('');
    } else {
      const matchingPreset = PRESETS.find(p => p.cron === job.cron);
      if (matchingPreset) {
        setEditMode('preset');
        setSelectedPreset(job.cron);
        setCustomCron('');
      } else {
        setEditMode('custom');
        setSelectedPreset('');
        setCustomCron(job.cron);
      }
    }
  }

  function getEffectiveCron(): string | null {
    if (editMode === 'disabled') return null;
    if (editMode === 'preset') return selectedPreset || null;
    return customCron || null;
  }

  async function handleSave() {
    if (!selectedJob) return;
    
    const cron = getEffectiveCron();
    
    setSaving(true);
    try {
      // TODO: Backend needs to support per-job cron settings
      // For now, only Watchlist Curator and Trading Cycle are configurable
      if (selectedJob === 'Watchlist Curator') {
        await api.settings.patch({ watchlist: { curatorCron: cron || '' } });
      } else if (selectedJob === 'Trading Cycle') {
        if (cron) {
          await api.settings.patch({ schedule: { cron } });
        }
        // Note: Disabling Trading Cycle is done via trading.enabled, not here
      } else {
        addToast('Custom schedules for this job coming soon', 'error');
        setSaving(false);
        return;
      }

      addToast(`${selectedJob} schedule saved`, 'success');
      setTimeout(fetchJobs, 500);
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  function formatNextRun(nextRun: string | null): string {
    if (!nextRun) return '—';
    return new Date(nextRun).toLocaleString();
  }

  const selectedJobData = selectedJob ? jobs.find(j => j.name === selectedJob) : null;

  return (
    <>
      <Card title="Scheduled Jobs">
        <p className={styles.hint} style={{ marginBottom: 'var(--spacing-md)' }}>
          Timezone: <strong>{timezone}</strong> • Click a job to edit its schedule
        </p>
        {loadingJobs ? (
          <p>Loading jobs...</p>
        ) : jobs.length === 0 ? (
          <p>No scheduled jobs</p>
        ) : (
          <table className={styles.jobsTable}>
            <thead>
              <tr>
                <th>Job</th>
                <th>Cron</th>
                <th>Next Run</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map(job => (
                <tr 
                  key={job.name} 
                  className={`${job.enabled ? '' : styles.disabled} ${selectedJob === job.name ? styles.selected : ''} ${styles.clickable}`}
                  onClick={() => handleSelectJob(job.name)}
                >
                  <td>{job.name}</td>
                  <td><code>{job.cron}</code></td>
                  <td>{job.enabled ? formatNextRun(job.nextRun) : '—'}</td>
                  <td>
                    <span className={job.enabled ? styles.statusEnabled : styles.statusDisabled}>
                      {job.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {selectedJob && (
        <Card title={`Edit: ${selectedJob}`}>
          <div className={styles.field}>
            <label className={styles.radioLabel}>
              <input
                type="radio"
                name="editMode"
                checked={editMode === 'disabled'}
                onChange={() => setEditMode('disabled')}
              />
              Disabled
            </label>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Presets</label>
            {PRESETS.map(preset => (
              <label key={preset.cron} className={styles.radioLabel}>
                <input
                  type="radio"
                  name="editMode"
                  checked={editMode === 'preset' && selectedPreset === preset.cron}
                  onChange={() => {
                    setEditMode('preset');
                    setSelectedPreset(preset.cron);
                  }}
                />
                {preset.label}
                <code className={styles.cronCode}>{preset.cron}</code>
              </label>
            ))}
          </div>

          <div className={styles.field}>
            <label className={styles.radioLabel}>
              <input
                type="radio"
                name="editMode"
                checked={editMode === 'custom'}
                onChange={() => setEditMode('custom')}
              />
              Custom cron
            </label>
            {editMode === 'custom' && (
              <div style={{ marginLeft: 'var(--spacing-lg)' }}>
                <input
                  className={styles.input}
                  type="text"
                  value={customCron}
                  onChange={e => setCustomCron(e.target.value)}
                  placeholder="0 16 * * 1-5"
                  style={{ marginTop: 'var(--spacing-xs)' }}
                />
                {customCron && (
                  <p className={parseCron(customCron).valid ? styles.hint : styles.warning} style={{ marginTop: 'var(--spacing-xs)' }}>
                    {parseCron(customCron).valid ? '→ ' : ''}{parseCron(customCron).description}
                  </p>
                )}
              </div>
            )}
          </div>

          {selectedJobData && !selectedJobData.enabled && editMode !== 'disabled' && (
            <p className={styles.hint} style={{ marginTop: 'var(--spacing-sm)' }}>
              Note: This job may also need to be enabled in its respective settings section.
            </p>
          )}

          <div className={styles.actions}>
            <button 
              className={styles.saveBtn} 
              onClick={handleSave} 
              disabled={saving || (editMode === 'preset' && !selectedPreset) || (editMode === 'custom' && (!customCron || !parseCron(customCron).valid))}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button 
              className={styles.cancelBtn}
              onClick={() => setSelectedJob(null)}
              style={{ marginLeft: 'var(--spacing-sm)' }}
            >
              Cancel
            </button>
          </div>
        </Card>
      )}
    </>
  );
}
