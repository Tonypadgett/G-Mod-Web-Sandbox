/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import Sandbox from './Sandbox';
import ModBrowser from './ModBrowser';
import ModEditor from './ModEditor';
import { useAuthState } from './hooks/useAuthState';
import { signInWithGoogle, logout } from './lib/firebase';
import { LogIn, LogOut, Code, Play, Library } from 'lucide-react';

export default function App() {
  const { user, initializing } = useAuthState();

  if (initializing) {
    return <div className="h-screen w-screen bg-neutral-900 flex items-center justify-center text-white">Loading...</div>;
  }

  return (
    <Router>
      <div className="h-screen w-screen flex flex-col bg-neutral-900 text-white font-sans overflow-hidden">
        <header className="h-14 bg-neutral-800 border-b border-neutral-700 flex items-center justify-between px-6 shrink-0 z-50 relative">
          <div className="flex items-center gap-6">
            <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">G-Mod Web Sandbox</h1>
            <nav className="flex gap-4">
              <Link to="/" className="flex items-center gap-2 hover:text-blue-400 transition-colors">
                <Play size={18} /> Play
              </Link>
              <Link to="/mods" className="flex items-center gap-2 hover:text-blue-400 transition-colors">
                <Library size={18} /> Mods
              </Link>
              <Link to="/editor" className="flex items-center gap-2 hover:text-blue-400 transition-colors">
                <Code size={18} /> Editor
              </Link>
            </nav>
          </div>
          <div>
            {user ? (
              <div className="flex items-center gap-4">
                <span className="text-sm text-neutral-400">{user.displayName}</span>
                <button 
                  onClick={logout}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-neutral-700 hover:bg-neutral-600 transition-colors text-sm"
                >
                  <LogOut size={16} /> Logout
                </button>
              </div>
            ) : (
              <button 
                onClick={signInWithGoogle}
                className="flex items-center gap-2 px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-500 transition-colors font-medium text-sm text-white"
              >
                <LogIn size={16} /> Sign in with Google
              </button>
            )}
          </div>
        </header>

        <main className="flex-1 relative overflow-hidden">
          <Routes>
            <Route path="/" element={<Sandbox />} />
            <Route path="/mods" element={<ModBrowser user={user} />} />
            <Route path="/editor" element={<ModEditor user={user} />} />
            <Route path="/editor/:modId" element={<ModEditor user={user} />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

