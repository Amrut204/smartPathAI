import { Card, Table } from "../../components/ui";
import { useAdminResourceStorageBudget } from "../../hooks/use-resources";

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

export default function TpoStoragePage() {
  const { data, isLoading, error } = useAdminResourceStorageBudget();

  if (isLoading) {
    return <Card>Loading storage budget...</Card>;
  }

  if (error || !data) {
    return <Card>Unable to load storage budget.</Card>;
  }

  const { status, config, history } = data;

  return (
    <section className="dashboard-grid">
      <Card className="career-hero-card control-center-hero-card">
        <h1>Resource Storage Guardrails</h1>
        <p className="muted-text">
          This page tracks the app-side S3 safety caps that protect student resource opens from drifting into unexpected AWS charges.
        </p>
        <div className="control-center-pill-grid">
          <div className="control-center-pill">
            <span>Current Period</span>
            <strong>{status.periodKey}</strong>
          </div>
          <div className="control-center-pill">
            <span>Overall Status</span>
            <strong>{status.overallStatus.toUpperCase()}</strong>
          </div>
          <div className="control-center-pill">
            <span>Request Usage</span>
            <strong>{status.requests.used}/{status.requests.limit}</strong>
          </div>
          <div className="control-center-pill">
            <span>Transfer Usage</span>
            <strong>{status.transfer.displayUsed}</strong>
          </div>
          <div className="control-center-pill">
            <span>Transfer Cap</span>
            <strong>{status.transfer.displayLimit}</strong>
          </div>
        </div>
      </Card>

      <Card>
        <h2>Current Guardrails</h2>
        <ul className="dashboard-bullet-list">
          <li>Monthly S3 read cap: {config.requestLimit.toLocaleString()} requests</li>
          <li>Monthly S3 transfer cap: {config.transferLimitDisplay}</li>
          <li>Warning threshold for reads: {formatPercent(config.requestWarningPct)}</li>
          <li>Warning threshold for transfer: {formatPercent(config.transferWarningPct)}</li>
          <li>Applied only to cloud-hosted resource opens that go through the app proxy.</li>
        </ul>
        {status.message ? <p className="muted-text">{status.message}</p> : null}
      </Card>

      <Card>
        <h2>Current Month Usage</h2>
        <ul className="dashboard-bullet-list">
          <li>Read requests used: {status.requests.used.toLocaleString()}</li>
          <li>Read requests remaining: {status.requests.remaining.toLocaleString()}</li>
          <li>Transfer used: {status.transfer.displayUsed}</li>
          <li>Transfer remaining: {status.transfer.displayRemaining}</li>
        </ul>
      </Card>

      <Card>
        <h2>Recent History</h2>
        {history.length === 0 ? (
          <p className="muted-text">No prior monthly cloud resource usage has been recorded yet.</p>
        ) : (
          <div className="tpo-ranking-table-wrap">
            <Table>
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Status</th>
                  <th>Read Requests</th>
                  <th>Transfer</th>
                </tr>
              </thead>
              <tbody>
                {history.map((item) => (
                  <tr key={item.periodKey}>
                    <td>{item.periodKey}</td>
                    <td>{item.status.toUpperCase()}</td>
                    <td>{item.requestCount.toLocaleString()}</td>
                    <td>{item.transferDisplay}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>

      <Card>
        <h2>AWS Budget Setup</h2>
        <p className="muted-text">
          Generated budget templates and setup instructions are available in the server workspace so you can add an AWS-side alarm in addition to the in-app cap.
        </p>
        <ul className="dashboard-bullet-list">
          <li>Budget guide: <code>server/aws/budgets/README.md</code></li>
          <li>Generator script: <code>server/scripts/generate-aws-budget-files.mjs</code></li>
          <li>Generated output folder: <code>server/storage_reports/aws-budgets</code></li>
        </ul>
      </Card>
    </section>
  );
}
