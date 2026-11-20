import { useState } from 'react';
import type { DesktopOutput } from '../desktop/workspace';
import { errorMessage } from './book-entry';

export function OutputActions({ title, csv }: { title: string; csv?: () => string }) {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean }>();
  async function output(kind: DesktopOutput['kind']) {
    setBusy(true);
    setFeedback(undefined);
    try {
      const complete = await window.workspaces.output(kind === 'csv' ? { kind, title, csv: csv!() } : { kind, title });
      if (complete) setFeedback({ text: kind === 'print' ? 'Document sent to the printer.' : kind === 'pdf' ? 'PDF saved.' : 'CSV exported.' });
    } catch (error) {
      setFeedback({ text: errorMessage(error), error: true });
    } finally {
      setBusy(false);
    }
  }
  return <div className="form-actions print-control">
    <button className="secondary" disabled={busy} onClick={() => void output('print')}>Print</button>
    <button className="secondary" disabled={busy} onClick={() => void output('pdf')}>Save PDF</button>
    {csv && <button className="secondary" disabled={busy} onClick={() => void output('csv')}>Export CSV</button>}
    {feedback && <span className={feedback.error ? 'error' : undefined} role={feedback.error ? 'alert' : 'status'}>{feedback.text}</span>}
  </div>;
}
