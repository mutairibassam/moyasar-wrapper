import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6 rounded-lg border p-8 shadow-sm">
        <div className="space-y-1 text-center">
          <h1 className="text-xl font-semibold">Moyasar Ops</h1>
          <p className="text-sm text-muted-foreground">Sign in to the operator console</p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
