import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { FileBarChart } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LossSummary } from "@/components/reports/loss-summary";
import { LossRunLibrary } from "@/components/reports/loss-run-library";
import { REPORT_TABS, parseReportTab, type ReportTab } from "@/lib/navigation";

// Reports (fix 21): the Loss Summary (formerly Analytics) and the Loss Run
// Library with requests (formerly Loss Runs). Generated reports join in Phase 6.
export const Route = createFileRoute("/_app/reports")({
  validateSearch: (search: Record<string, unknown>): { tab: ReportTab } => ({
    tab: parseReportTab(search.tab),
  }),
  head: () => ({ meta: [{ title: "Reports | ClaimsQR" }] }),
  component: ReportsPage,
});

function ReportsPage() {
  const { tab } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-navy flex items-center gap-2">
          <FileBarChart className="h-6 w-6 text-gold" /> Reports
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Loss summaries and loss run reports for your account.
        </p>
      </div>

      <Tabs
        value={tab}
        onValueChange={(value) =>
          navigate({ search: { tab: parseReportTab(value) }, replace: true })
        }
      >
        <TabsList>
          <TabsTrigger value={REPORT_TABS.lossSummary}>Loss Summary</TabsTrigger>
          <TabsTrigger value={REPORT_TABS.lossRuns}>Loss Runs</TabsTrigger>
        </TabsList>
        <TabsContent value={REPORT_TABS.lossSummary} className="mt-6">
          <LossSummary />
        </TabsContent>
        <TabsContent value={REPORT_TABS.lossRuns} className="mt-6">
          <LossRunLibrary />
        </TabsContent>
      </Tabs>
    </div>
  );
}
