import { pool } from "./db.js";
import { deliverMail } from "./mailer.js";
import { logger } from "./logger.js";
import {
  generateReportRows,
  rowsToCsv,
  type ReportType,
} from "./reportService.js";
import { nextCronRun } from "./domain/cron.js";

type Definition = {
  id: string;
  company_id: string;
  name: string;
  report_type: ReportType;
  format: "CSV" | "JSON";
  schedule_cron: string | null;
  recipients: string[];
  filters: Record<string, unknown>;
};
export async function processDueReports(companyId?: string): Promise<number> {
  const client = await pool.connect();
  const locked = (
    await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(731424) AS locked",
    )
  ).rows[0]?.locked;
  if (!locked) {
    client.release();
    return 0;
  }
  try {
    await client.query(
      `DELETE FROM live_location_updates u USING shifts s WHERE u.shift_id=s.id AND (s.status<>'PUBLISHED' OR s.live_tracking_enabled=false OR now()>s.ends_at)`,
    );
    const definitions = (
      await pool.query<Definition>(
        `SELECT id,company_id,name,report_type,format,schedule_cron,recipients,filters FROM report_definitions WHERE active=true AND next_run_at<=now() AND ($1::uuid IS NULL OR company_id=$1) ORDER BY next_run_at LIMIT 20`,
        [companyId ?? null],
      )
    ).rows;
    for (const report of definitions) {
      let runId: string | undefined;
      try {
        const run = await pool.query<{ id: string }>(
          `INSERT INTO report_runs(company_id,report_definition_id,report_type,format,status) VALUES($1,$2,$3,$4,'RUNNING') RETURNING id`,
          [report.company_id, report.id, report.report_type, report.format],
        );
        runId = run.rows[0].id;
        const rows = await generateReportRows(
          report.company_id,
          report.report_type,
          report.filters,
        );
        const content =
          report.format === "CSV"
            ? `\uFEFF${rowsToCsv(rows)}`
            : JSON.stringify(rows, null, 2);
        const extension = report.format.toLowerCase();
        if (report.recipients.length) {
          const delivery = await deliverMail({
            to: report.recipients.join(","),
            subject: `Atlas scheduled report: ${report.name}`,
            text: `Your scheduled ${report.report_type.toLowerCase()} report is attached.`,
            html: `<p>Your scheduled <strong>${report.report_type.toLowerCase()}</strong> report is attached.</p>`,
            attachments: [
              {
                filename: `atlas-${report.report_type.toLowerCase()}.${extension}`,
                content,
              },
            ],
          });
          if (!delivery.delivered)
            throw new Error("Report email delivery failed");
        }
        await pool.query(
          `UPDATE report_runs SET status='COMPLETED',row_count=$1,completed_at=now() WHERE id=$2`,
          [rows.length, runId],
        );
        await pool.query(
          `UPDATE report_definitions SET last_run_at=now(),next_run_at=$1 WHERE id=$2`,
          [
            report.schedule_cron ? nextCronRun(report.schedule_cron) : null,
            report.id,
          ],
        );
      } catch (error) {
        logger.error({ error, reportId: report.id }, "scheduled report failed");
        if (runId)
          await pool.query(
            `UPDATE report_runs SET status='FAILED',error_message=$1,completed_at=now() WHERE id=$2`,
            [error instanceof Error ? error.message : "Unknown error", runId],
          );
        await pool.query(
          `UPDATE report_definitions SET last_run_at=now(),next_run_at=$1 WHERE id=$2`,
          [
            report.schedule_cron ? new Date(Date.now() + 3600000) : null,
            report.id,
          ],
        );
      }
    }
    return definitions.length;
  } finally {
    await client.query("SELECT pg_advisory_unlock(731424)");
    client.release();
  }
}
export function startReportScheduler() {
  void processDueReports();
  const timer = setInterval(() => void processDueReports(), 60_000);
  timer.unref();
  return timer;
}
