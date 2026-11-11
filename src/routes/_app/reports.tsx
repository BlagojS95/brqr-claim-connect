import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { FileBarChart } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LossSummary } from "@/components/reports/loss-summary";
import { LossRunLibrary } from "@/components/reports/loss-run-library";
import { RenewalPack } from "@/components/reports/renewal-pack";
import { REPORT_TABS, parseReportTab, type ReportTab } from "@/lib/navigation";
import { useAuth } from "@/hooks/use-auth";
import { CLIENT_USER_ROLE } from "@/lib/client-users";

// Reports (fix 21): the Loss Summary (formerly Analytics) and the Loss Run
// Library with requests (formerly Loss Runs), and the Renewal Pack (fix 36).
// Generated reports join in Phase 6.
export const Route = createFileRoute("/_app/reports")({
  validateSearch: (search: Record<string, unknown>): { tab: ReportTab } => ({
    tab: parseReportTab(search.tab),
  }),
  head: () => ({ meta: [{ title: "Reports | ClaimsQR" }] }),
  component: ReportsPage,
});

function ReportsPage() {
  const { tab: requestedTab } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  // Location users (fix 32) only see their sites' claims and no loss runs, so
  // the company-wide loss runs and renewal pack aren't theirs to see. RLS
  // already returns them no loss runs; this keeps the tabs from showing.
  const { clientRole } = useAuth();
  const companyReports = clientRole !== CLIENT_USER_ROLE.location;
  const tab = companyReports ? requestedTab : REPORT_TABS.lossSummary;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-navy flex items-center gap-2">
          <FileBarChart className="h-6 w-6 text-gold" /> Reports
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {companyReports
            ? "Loss summaries, loss run reports and renewal packs for your account."
            : "Loss summary for your locations."}
        </p>
      </div>

      <Tabs
        value={tab}
        onValueChange={(value) =>
          navigate({ search: { tab: parseReportTab(value) }, replace: true })
        }
      >
        {/* Three tabs fit a 375 px phone when they share the width. */}
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value={REPORT_TABS.lossSummary} className="flex-1 sm:flex-none px-2 sm:px-3">
            Loss Summary
          </TabsTrigger>
          {companyReports && (
            <>
              <TabsTrigger
                value={REPORT_TABS.lossRuns}
                className="flex-1 sm:flex-none px-2 sm:px-3"
              >
                Loss Runs
              </TabsTrigger>
              <TabsTrigger
                value={REPORT_TABS.renewalPack}
                className="flex-1 sm:flex-none px-2 sm:px-3"
              >
                Renewal Pack
              </TabsTrigger>
            </>
          )}
        </TabsList>
        <TabsContent value={REPORT_TABS.lossSummary} className="mt-6">
          <LossSummary />
        </TabsContent>
        {companyReports && (
          <>
            <TabsContent value={REPORT_TABS.lossRuns} className="mt-6">
              <LossRunLibrary />
            </TabsContent>
            <TabsContent value={REPORT_TABS.renewalPack} className="mt-6">
              <RenewalPack />
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
}
