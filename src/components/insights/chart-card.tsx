import type { ReactNode } from "react";

// Shared by the Insights charts and the placeholder shown while the charting
// library loads, so both have the same card sizes and the layout never jumps.
// Keep recharts out of this file: it must stay in the lazily loaded chunk.

export const CHART_HEIGHT = 300;

export interface ChartCardSpec {
  id: string;
  title: string;
  wide?: boolean;
}

/** The Insights chart cards, in display order. */
export const INSIGHTS_CHART_CARDS = {
  lob: { id: "lob", title: "Claims by Line of Business" },
  status: { id: "status", title: "Claims by Status" },
  trend: { id: "trend", title: "Claims Trend by Year" },
  paidByYear: { id: "paidByYear", title: "Paid by Year" },
  carrier: { id: "carrier", title: "Claims by Carrier", wide: true },
} as const satisfies Record<string, ChartCardSpec>;

export function ChartCard({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-lg border border-border bg-card p-5 ${className ?? ""}`}>
      <h2 className="text-sm font-semibold text-navy mb-4">{title}</h2>
      {children}
    </div>
  );
}

export function ChartGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">{children}</div>;
}

export function ChartsPlaceholder({ cards }: { cards: readonly ChartCardSpec[] }) {
  return (
    <ChartGrid>
      {cards.map((card) => (
        <ChartCard key={card.id} title={card.title} className={card.wide ? "lg:col-span-2" : ""}>
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
