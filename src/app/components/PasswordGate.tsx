import { useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Lock } from 'lucide-react';

interface PasswordGateProps {
  onSuccess: () => void;
}

// Simple password - change this to whatever you want
const ADMIN_PASSWORD = "ergo2026!Arch#Secure";

export function PasswordGate({ onSuccess }: PasswordGateProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === ADMIN_PASSWORD) {
      // Store in sessionStorage so they don't have to re-enter on refresh
      sessionStorage.setItem('arch-authenticated', 'true');
      onSuccess();
    } else {
      setError(true);
      setTimeout(() => setError(false), 2000);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl p-8 w-full max-w-md">
        <div className="text-center mb-6">
          <div className="mx-auto w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mb-4">
            <Lock className="h-6 w-6 text-blue-600" />
          </div>
          <h1 className="text-2xl font-semibold text-gray-900">Ergo Architecture</h1>
          <p className="text-gray-500 mt-1">Enter password to access the dashboard</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Input
              type="password"
              placeholder="Enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`w-full ${error ? 'border-red-500 focus:ring-red-500' : ''}`}
              autoFocus
            />
            {error && (
              <p className="text-red-500 text-sm mt-1">Incorrect password</p>
            )}
          </div>
          <Button type="submit" className="w-full">
            Access Dashboard
          </Button>
        </form>

        <p className="text-xs text-gray-400 text-center mt-6">
          Contact your admin if you don't have the password
        </p>
      </div>
    </div>
  );
}
