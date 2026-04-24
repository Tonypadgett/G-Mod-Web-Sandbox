import { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from './lib/firebase';
import { User } from 'firebase/auth';
import { Link } from 'react-router-dom';
import { Download, Edit2, Play, AlertTriangle, ArrowUp, ArrowDown } from 'lucide-react';

interface Mod {
  id: string;
  name: string;
  description: string;
  authorId: string;
  authorName: string;
  createdAt: number;
  code: string;
}

export default function ModBrowser({ user }: { user: User | null }) {
  const [mods, setMods] = useState<Mod[]>([]);
  const [loading, setLoading] = useState(true);
  const [conflictWarning, setConflictWarning] = useState<string | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'mods'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const docs: Mod[] = [];
      querySnapshot.forEach((doc) => {
        docs.push({ id: doc.id, ...doc.data() } as Mod);
      });
      setMods(docs);
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const toggleActivateMod = (mod: Mod) => {
    // Save active mods in local storage so the Sandbox can load them
    const activeModsStr = localStorage.getItem('activeMods') || '[]';
    let activeMods = JSON.parse(activeModsStr) as string[];

    if (activeMods.includes(mod.id)) {
      activeMods = activeMods.filter(id => id !== mod.id);
      setConflictWarning(null);
    } else {
      // Basic conflict detection heuristic
      const otherActiveMods = mods.filter(m => activeMods.includes(m.id));
      const newModApiUsage = getApiSignatures(mod.code);
      
      const conflicts: string[] = [];
      otherActiveMods.forEach(active => {
        const activeModUsage = getApiSignatures(active.code);
        const intersect = activeModUsage.filter(api => newModApiUsage.includes(api));
        if (intersect.length > 0) {
          conflicts.push(`'${active.name}' (both use ${intersect.join(', ')})`);
        }
      });
      
      if (conflicts.length > 0) {
        setConflictWarning(`Potential conflict with ${conflicts.join(' & ')}. You may need to manage the load order so the preferred mod loads last and takes precedence, or disable one.`);
      } else {
        setConflictWarning(null);
      }

      activeMods.push(mod.id);
    }

    localStorage.setItem('activeMods', JSON.stringify(activeMods));
    setMods([...mods]);
  };

  const getApiSignatures = (code: string) => {
    const signatures = [];
    if (!code) return [];
    if (code.includes('setPlayerSpeed') || code.includes('setPlayerJump')) signatures.push('Player Movement');
    if (code.includes('setSkyColor') || code.includes('setGravity')) signatures.push('Environment Rules');
    if (code.includes('addUI')) signatures.push('Custom UI');
    return signatures;
  };

  const moveModOrder = (index: number, direction: -1 | 1) => {
    const activeModsStr = localStorage.getItem('activeMods') || '[]';
    let activeMods = JSON.parse(activeModsStr) as string[];
    if (index + direction >= 0 && index + direction < activeMods.length) {
      const temp = activeMods[index];
      activeMods[index] = activeMods[index + direction];
      activeMods[index + direction] = temp;
      localStorage.setItem('activeMods', JSON.stringify(activeMods));
      setMods([...mods]);
    }
  };

  const getActiveMods = () => {
    const activeModsStr = localStorage.getItem('activeMods') || '[]';
    return JSON.parse(activeModsStr) as string[];
  };

  if (loading) {
    return <div className="p-8 text-center text-neutral-400">Loading mods...</div>;
  }

  const activeMods = getActiveMods();

  return (
    <div className="p-8 max-w-5xl mx-auto overflow-y-auto h-full">
      <div className="flex justify-between items-center mb-8">
        <h2 className="text-3xl font-bold">Community Mods</h2>
        <Link to="/editor" className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-md font-medium transition-colors">
          Create Mod
        </Link>
      </div>

      {conflictWarning && (
        <div className="mb-6 bg-yellow-500/10 border-l-4 border-yellow-500 p-4 rounded text-yellow-500 flex items-start gap-3">
          <AlertTriangle className="shrink-0 mt-0.5" size={20} />
          <div>
            <h4 className="font-bold">Mod Conflict Warning</h4>
            <p className="text-sm">{conflictWarning}</p>
          </div>
        </div>
      )}

      {activeMods.length > 0 && (
        <div className="mb-8 bg-neutral-800 rounded-lg p-4 border border-neutral-700">
          <h3 className="text-lg font-bold mb-4 text-white">Active Load Order (Top loads first)</h3>
          <div className="space-y-2">
            {activeMods.map((modId, index) => {
              const activeMod = mods.find(m => m.id === modId);
              if (!activeMod) return null;
              return (
                <div key={modId} className="flex items-center justify-between bg-neutral-900 border border-emerald-600/30 p-2 rounded">
                  <span className="text-emerald-400 font-medium">{activeMod.name}</span>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => moveModOrder(index, -1)}
                      disabled={index === 0}
                      className="p-1 text-neutral-400 hover:text-white disabled:opacity-30 disabled:hover:text-neutral-400"
                    >
                      <ArrowUp size={16} />
                    </button>
                    <button 
                      onClick={() => moveModOrder(index, 1)}
                      disabled={index === activeMods.length - 1}
                      className="p-1 text-neutral-400 hover:text-white disabled:opacity-30 disabled:hover:text-neutral-400"
                    >
                      <ArrowDown size={16} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {mods.length === 0 ? (
        <div className="text-center py-12 bg-neutral-800 rounded-lg border border-neutral-700">
          <p className="text-neutral-400 mb-4">No mods found yet.</p>
          <Link to="/editor" className="text-blue-400 hover:underline">Be the first to create one!</Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {mods.map(mod => {
            const isActive = activeMods.includes(mod.id);
            return (
              <div key={mod.id} className="bg-neutral-800 rounded-lg border border-neutral-700 overflow-hidden flex flex-col transition-transform hover:scale-[1.02] hover:shadow-xl">
                <div className="p-5 flex-1">
                  <h3 className="text-xl font-bold mb-2">{mod.name}</h3>
                  <p className="text-sm text-neutral-400 mb-4 line-clamp-2">{mod.description || 'No description provided.'}</p>
                  <p className="text-xs text-neutral-500 uppercase tracking-wider font-semibold">By {mod.authorName}</p>
                </div>
                <div className="bg-neutral-900 p-4 border-t border-neutral-700 flex justify-between items-center">
                  <button 
                    onClick={() => toggleActivateMod(mod)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm font-medium transition-colors ${isActive ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-600/50' : 'bg-neutral-700 hover:bg-neutral-600 text-white'}`}
                  >
                    {isActive ? <Play size={16} /> : <Download size={16} />} 
                    {isActive ? 'Active' : 'Load Mod'}
                  </button>

                  {user && user.uid === mod.authorId && (
                    <Link to={`/editor/${mod.id}`} className="p-2 text-neutral-400 hover:text-white transition-colors rounded hover:bg-neutral-700">
                      <Edit2 size={16} />
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
