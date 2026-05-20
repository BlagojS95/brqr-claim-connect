import { createFileRoute, Link } from "@tanstack/react-router";
import { Shield, FileText, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "BRQR Insurance Agency — Client Claims Portal" },
      { name: "description", content: "Secure portal for BRQR insurance clients to report and track claims." },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <header className="bg-navy text-navy-foreground">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-md bg-gold flex items-center justify-center text-gold-foreground">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <div className="font-bold leading-tight">BRQR</div>
              <div className="text-[10px] uppercase tracking-wider opacity-70">Insurance Agency</div>
            </div>
          </div>
          <Link to="/login">
            <Button className="bg-gold text-gold-foreground hover:bg-gold/90">Client Login</Button>
          </Link>
        </div>
      </header>

      <section className="max-w-6xl mx-auto px-6 py-20 md:py-28">
        <h1 className="text-4xl md:text-6xl font-bold text-navy max-w-3xl leading-tight">
          A claims experience built for our clients.
        </h1>
        <p className="mt-6 text-lg text-muted-foreground max-w-2xl">
          Report new claims, monitor adjuster activity, and access your loss runs — all in one secure portal.
        </p>
        <div className="mt-8 flex gap-3">
          <Link to="/login">
            <Button size="lg" className="bg-navy hover:bg-navy/90 text-navy-foreground">Enter portal</Button>
          </Link>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 pb-24 grid md:grid-cols-3 gap-6">
        {[
          { icon: FileText, title: "Report claims in minutes", body: "First Notice of Loss with document upload, routed to the right carrier instantly." },
          { icon: BarChart3, title: "Track every update", body: "See adjuster contacts, reserve and paid amounts, and last follow-up dates in real time." },
          { icon: Shield, title: "Secure & private", body: "Bank-grade authentication and per-client data isolation enforced at the database." },
        ].map((f) => (
          <div key={f.title} className="rounded-lg border border-border p-6 bg-card">
            <div className="h-10 w-10 rounded-md bg-navy/10 text-navy flex items-center justify-center">
              <f.icon className="h-5 w-5" />
            </div>
            <h3 className="mt-4 font-semibold text-navy">{f.title}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
          </div>
        ))}
      </section>

      <footer className="border-t border-border py-8 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} BRQR Insurance Agency
      </footer>
    </div>
  );
}
