import { useEffect, useState } from 'react';
import type { RunStatus } from '../api.ts';
import { fetchRun, stopRun } from '../api.ts';

interface RunResultsProps {
  runId: string | null;
}

const FINISHED_STATES = ['completed', 'failed', 'stopped'];

function RunResults({ runId }: RunResultsProps) {
  const [run, setRun] = useState<RunStatus | null>(null);

  useEffect(() => {
    setRun(null);
    if (!runId) return;
    let cancelled = false;
    let interval: ReturnType<typeof setInterval>;

    async function tick() {
      const status = await fetchRun(runId!);
      if (cancelled) return;
      setRun(status);
      if (FINISHED_STATES.includes(status.overallState)) clearInterval(interval);
    }

    tick();
    interval = setInterval(tick, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [runId]);

  if (!runId) return <p className="hint">Run a workflow to see output</p>;

  const inProgress = !run || !FINISHED_STATES.includes(run.overallState);

  return (
    <>
      <div className="run-status">
        <span>
          Status: <span className={`badge ${run?.overallState ?? 'waiting'}`}>{run?.overallState ?? 'starting'}</span>
        </span>
        {inProgress && (
          <button className="stop-btn" onClick={() => stopRun(runId)}>
            ■ Stop
          </button>
        )}
      </div>
      {!run && (
        <p className="hint" style={{ color: '#60a5fa' }}>
          Run started: {runId}
        </p>
      )}
      {run && run.steps.length === 0 && <p className="hint">No steps yet</p>}
      {run?.steps.map((s) => (
        <div className="result-step" key={s.jobId}>
          <div className="result-header">
            <strong>{s.step}</strong>
            <span className={`badge ${s.state}`}>{s.state}</span>
          </div>
          {s.output && <pre className="result-output">{s.output}</pre>}
        </div>
      ))}
    </>
  );
}

export default RunResults;
