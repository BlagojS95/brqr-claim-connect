import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import claimsQrLogoWhite from "@/assets/claims-qr-logo-white.png";
import claimsQrLogoNavy from "@/assets/claims-qr-logo-navy.png";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard" });
    });
  }, [navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      navigate({ to: "/dashboard" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid md:grid-cols-2">
      <div className="hidden md:flex flex-col justify-between bg-navy text-navy-foreground p-12">
        <img src={claimsQrLogoWhite} alt="Claims QR" className="h-16 w-auto self-start" />
        <div>
          <h1 className="text-4xl font-bold leading-tight">Client Claims Portal</h1>
          <p className="mt-4 text-navy-foreground/75 max-w-md">
            Report new claims, track status updates, and manage your policies in one secure place.
          </p>
        </div>
        <div />
      </div>

      <div className="flex items-center justify-center p-6 md:p-12 bg-background">
        <form onSubmit={submit} className="w-full max-w-md space-y-6">
          <img src={claimsQrLogoNavy} alt="Claims QR" className="md:hidden h-10 w-auto" />
          <div>
            <h2 className="text-2xl font-bold text-navy">Sign in</h2>
            <p className="text-sm text-muted-foreground mt-1">Enter your credentials to access your portal.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>

          <Button type="submit" disabled={loading} className="w-full bg-navy hover:bg-navy/90 text-navy-foreground">
            {loading ? "Please wait…" : "Sign in"}
          </Button>

          <p className="text-sm text-center text-muted-foreground">
            Need access? Contact your agent representative to have an account set up.
          </p>
        </form>
      </div>
    </div>
  );
}
