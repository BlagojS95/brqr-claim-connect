import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Shield } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
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
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { name },
            emailRedirectTo: window.location.origin + "/dashboard",
          },
        });
        if (error) throw error;
        toast.success("Account created");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
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
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-md bg-gold flex items-center justify-center text-gold-foreground">
            <Shield className="h-6 w-6" />
          </div>
          <div>
            <div className="font-bold text-xl">BRQR</div>
            <div className="text-sm opacity-80">Insurance Agency</div>
          </div>
        </div>
        <div>
          <h1 className="text-4xl font-bold leading-tight">Client Claims Portal</h1>
          <p className="mt-4 text-navy-foreground/75 max-w-md">
            Report new claims, track status updates, and manage your policies in one secure place.
          </p>
        </div>
        <div className="text-xs opacity-60">© BRQR Insurance Agency</div>
      </div>

      <div className="flex items-center justify-center p-6 md:p-12 bg-background">
        <form onSubmit={submit} className="w-full max-w-md space-y-6">
          <div className="md:hidden flex items-center gap-3">
            <div className="h-10 w-10 rounded-md bg-navy flex items-center justify-center text-navy-foreground">
              <Shield className="h-5 w-5 text-gold" />
            </div>
            <div className="font-bold text-lg">BRQR Claims Portal</div>
          </div>
          <div>
            <h2 className="text-2xl font-bold text-navy">
              {mode === "signin" ? "Sign in" : "Create an account"}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              {mode === "signin"
                ? "Enter your credentials to access your portal."
                : "Register as a client to access your claims."}
            </p>
          </div>

          {mode === "signup" && (
            <div className="space-y-2">
              <Label htmlFor="name">Full name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>

          <Button type="submit" disabled={loading} className="w-full bg-navy hover:bg-navy/90 text-navy-foreground">
            {loading ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
          </Button>

          <p className="text-sm text-center text-muted-foreground">
            {mode === "signin" ? "Don't have an account?" : "Already have an account?"}{" "}
            <button
              type="button"
              className="text-navy font-medium hover:text-gold"
              onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            >
              {mode === "signin" ? "Sign up" : "Sign in"}
            </button>
          </p>
          <p className="text-center text-xs text-muted-foreground">
            <Link to="/" className="hover:text-foreground">← Back to home</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
