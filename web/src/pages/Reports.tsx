import { useEffect, useState } from 'react';
import { reports as reportsApi, type ReportSummary, type Report } from '../api/client';
import { formatTimestamp } from '../lib/format';
import { useToast } from '../context/ToastContext';
import ReactMarkdown from 'react-markdown';
import styles from './Reports.module.css';

const PERIOD_OPTIONS = [
  { value: 7, label: 'Last 7 days' },
  { value: 14, label: 'Last 2 weeks' },
  { value: 30, label: 'Last month' },
  { value: 90, label: 'Last 3 months' },
];

export default function ReportsPage() {
  const [reportList, setReportList] = useState<ReportSummary[]>([]);
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [periodDays, setPeriodDays] = useState(14);
  const { addToast } = useToast();

  useEffect(() => {
    loadReports();
  }, []);

  function loadReports() {
    reportsApi.list()
      .then(res => setReportList(res.data))
      .catch(e => addToast(e instanceof Error ? e.message : 'Failed to load reports', 'error'))
      .finally(() => setLoading(false));
  }

  async function handleGenerate() {
    setGenerating(true);
    try {
      const res = await reportsApi.generate(periodDays);
      setSelectedReport(res.data);
      loadReports();
      addToast('Report generated', 'success');
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Failed to generate report', 'error');
    } finally {
      setGenerating(false);
    }
  }

  async function handleSelectReport(id: string) {
    try {
      const res = await reportsApi.get(id);
      setSelectedReport(res.data);
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Failed to load report', 'error');
    }
  }

  if (loading) return <p>Loading…</p>;

  return (
    <div className={styles.container}>
      <div className={styles.sidebar}>
        <h1>Reports</h1>

        <div className={styles.generateSection}>
          <label>Period:</label>
          <select value={periodDays} onChange={e => setPeriodDays(Number(e.target.value))}>
            {PERIOD_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <button onClick={handleGenerate} disabled={generating} className={styles.generateBtn}>
            {generating ? 'Generating...' : 'Generate Report'}
          </button>
        </div>

        <h2>Past Reports</h2>
        {reportList.length === 0 ? (
          <p className={styles.muted}>No reports yet.</p>
        ) : (
          <ul className={styles.reportList}>
            {reportList.map(r => (
              <li
                key={r.id}
                className={`${styles.reportItem} ${selectedReport?.id === r.id ? styles.selected : ''}`}
                onClick={() => handleSelectReport(r.id)}
              >
                <div className={styles.reportTitle}>{r.title}</div>
                <div className={styles.reportMeta}>
                  {formatTimestamp(r.createdAt)}
                  {r.tokensUsed && <span> · {r.tokensUsed.toLocaleString()} tokens</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={styles.content}>
        {selectedReport ? (
          <>
            <h2>{selectedReport.title}</h2>
            <div className={styles.reportMeta}>
              Generated: {formatTimestamp(selectedReport.createdAt)}
              {selectedReport.tokensUsed && <span> · {selectedReport.tokensUsed.toLocaleString()} tokens</span>}
            </div>
            <div className={styles.markdown}>
              <ReactMarkdown>{selectedReport.content}</ReactMarkdown>
            </div>
          </>
        ) : (
          <div className={styles.placeholder}>
            <p>Select a report or generate a new one.</p>
          </div>
        )}
      </div>
    </div>
  );
}
