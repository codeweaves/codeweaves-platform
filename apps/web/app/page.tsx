'use client';

import { LoginButton } from "@/components/auth/login-button";
import { LogoutButton } from "@/components/auth/logout-button";
import { UserMenu } from "@/components/auth/user-menu";
import { useAuth } from "@/hooks/use-auth";

export default function Home() {
  const { isAuthenticated, isLoading, user } = useAuth();

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header with Auth */}
      <header style={{
        padding: '20px 40px',
        borderBottom: '1px solid #eee',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 600 }}>CodeWeaves</h2>
        <div>
          {isLoading ? (
            <p style={{ margin: 0 }}>Loading...</p>
          ) : isAuthenticated ? (
            <UserMenu />
          ) : (
            <LoginButton />
          )}
        </div>
      </header>

      {/* Main Content */}
      <main style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px',
        textAlign: 'center'
      }}>
        <h1 style={{ fontSize: '3rem', marginBottom: '20px', fontWeight: 700 }}>
          Welcome to CodeWeaves
        </h1>

        {isAuthenticated && user ? (
          <div style={{ maxWidth: '600px' }}>
            <p style={{ fontSize: '1.5rem', marginBottom: '20px', color: '#333' }}>
              Hello, <strong>{user.name || user.email}</strong>! 👋
            </p>
            <p style={{ fontSize: '1.1rem', color: '#666', marginBottom: '30px' }}>
              You are successfully authenticated with Auth0
            </p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <LogoutButton />
            </div>
          </div>
        ) : (
          <div style={{ maxWidth: '500px' }}>
            <p style={{ fontSize: '1.2rem', color: '#666', marginBottom: '30px' }}>
              Click the <strong>Login</strong> button in the header to get started
            </p>
            <div style={{
              backgroundColor: '#f5f5f5',
              padding: '20px',
              borderRadius: '8px',
              textAlign: 'left'
            }}>
              <p style={{ margin: '0 0 10px 0', fontWeight: 600 }}>What happens next:</p>
              <ol style={{ margin: 0, paddingLeft: '20px' }}>
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
