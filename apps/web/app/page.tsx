'use client';

import { LoginButton } from "@/components/auth/login-button";
import { LogoutButton } from "@/components/auth/logout-button";
import { UserMenu } from "@/components/auth/user-menu";
import { useAuth } from "@/hooks/use-auth";

export default function Home() {
  const { isAuthenticated, isLoading, user } = useAuth();

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header with Auth */}
      <header className="px-10 py-5 border-b border-border flex justify-between items-center">
        <h2 className="m-0 text-2xl font-semibold">CodeWeaves</h2>
        <div>
          {isLoading ? (
            <p className="m-0">Loading...</p>
          ) : isAuthenticated ? (
            <UserMenu />
          ) : (
            <LoginButton />
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center justify-center p-10 text-center">
        <h1 className="text-5xl mb-5 font-bold">
          Welcome to CodeWeaves
        </h1>

        {isAuthenticated && user ? (
          <div className="max-w-150">
            <p className="text-2xl mb-5 text-foreground">
              Hello, <strong>{user.name || user.email}</strong>! 👋
            </p>
            <p className="text-lg text-muted-foreground mb-8">
              You are successfully authenticated with Auth0
            </p>
            <div className="flex gap-2.5 justify-center">
              <LogoutButton />
            </div>
          </div>
        ) : (
          <div className="max-w-125">
            <p className="text-xl text-muted-foreground mb-8">
              Click the <strong>Login</strong> button in the header to get started
            </p>
            <div className="bg-muted p-5 rounded-lg text-left">
              <p className="mb-2.5 font-semibold">What happens next:</p>
              <ol className="m-0 pl-5">
                <li>Redirect to Auth0 secure login</li>
                <li>Authenticate with your credentials</li>
                <li>Return to dashboard with full access</li>
              </ol>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
