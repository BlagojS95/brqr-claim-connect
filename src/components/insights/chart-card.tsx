import { useId, useState, type ReactNode } from "react";
import { BarChart3, Table2 } from "lucide-react";
import { chartCardTitle, type ChartCardSpec } from "@/lib/insights-cards";
import type { InsightsMeasure } from "@/lib/insights-measure";

// Shared by the Insights charts and the placeholder shown while the charting
// library loads, so both have the same card sizes and the layout never jumps.
// Keep recharts out of this file: it must stay in the lazily loaded chunk.

export const CHART_HEIGHT = 300;

/** A chart's numbers as a plain table, for "View as table" (fix 45). */
export interface ChartTable {
  columns: string[];
  rows: { key: string; cells: ReactNode[] }[];
}

export function ChartCard({
  title,
  description,
  actions,
  table,
  children,
  className,
}: {
  title: string;
  /** Read by screen readers with the chart, e.g. what a click does. */
  description?: string;
  /** Controls beside the title, such as the breakdown selector. */
  actions?: ReactNode;
  table?: ChartTable;
  children: ReactNode;
  className?: string;
}) {
  const [asTable, setAsTable] = useState(false);
  const headingId = useId();
  const descriptionId = useId();
  return (
    <section
      aria-labelledby={headingId}
      aria-describedby={description ? descriptionId : undefined}
      className={`rounded-lg border border-border bg-card p-5 ${className ?? ""}`}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="text-sm font-semibold text-navy">
          {title}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          {table && (
            <button
              type="button"
              onClick={() => setAsTable((v) => !v)}
              aria-pressed={asTable}
              className="inline-flex h-9 items-center gap-1 rounded-md border border-input px-2.5 text-xs text-muted-foreground hover:text-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {asTable ? (
                <BarChart3 className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <Table2 className="h-3.5 w-3.5" aria-hidden />
              )}
              {asTable ? "View as chart" : "View as table"}
            </button>
          )}
        </div>
      </div>
      {description && (
        <p id={descriptionId} className="sr-only">
          {description}
        </p>
      )}
      {asTable && table ? <DataTable title={title} table={table} /> : children}
    </section>
  );
}

function DataTable({ title, table }: { title: string; table: ChartTable }) {
  if (!table.rows.length) {
    return (
      <div
        className="flex items-center justify-center text-sm text-muted-foreground"
        style={{ minHeight: CHART_HEIGHT }}
      >
        No claims to show.
      </div>
    );
  }
  return (
    <div className="overflow-auto" style={{ maxHeight: CHART_HEIGHT + 40 }}>
      <table className="w-full text-sm">
        <caption className="sr-only">{title}</caption>
        <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            {table.columns.map((c, i) => (
              <th key={c} scope="col" className={`p-2 ${i === 0 ? "text-left" : "text-right"}`}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr key={row.key} className="border-t border-border">
              {row.cells.map((cell, i) =>
                i === 0 ? (
                  <th key={i} scope="row" className="p-2 text-left font-normal">
                    {cell}
                  </th>
                ) : (
                  <td key={i} className="p-2 text-right whitespace-nowrap">
                    {cell}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ChartGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">{children}</div>;
}

export function ChartsPlaceholder({
  cards,
  measure,
}: {
  cards: readonly ChartCardSpec[];
  measure: InsightsMeasure;
}) {
  return (
    <ChartGrid>
      {cards.map((card) => (
        <ChartCard
          key={card.id}
          title={chartCardTitle(card, measure, card.dimension)}
          className={card.wide ? "lg:col-span-2" : ""}
        >
          <div
            className="rounded-md bg-muted animate-pulse"
            style={{ height: CHART_HEIGHT }}
            aria-hidden="true"
          />
        </ChartCard>
      ))}
    </ChartGrid>
  );
}
