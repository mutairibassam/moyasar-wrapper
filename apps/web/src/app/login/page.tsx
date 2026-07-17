export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6 rounded-lg border p-8 text-center shadow-sm">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Moyasar Ops</h1>
          <p className="text-sm text-muted-foreground">Sign in to the operator console</p>
        </div>
        <a
          href="/api/v1/auth/login"
          className="inline-flex h-9 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Sign in with Microsoft
        </a>
      </div>
    </main>
  );
}
