import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Editor from '@monaco-editor/react';
import { db } from './lib/firebase';
import { doc, getDoc, setDoc, collection, addDoc, updateDoc } from 'firebase/firestore';
import { User } from 'firebase/auth';
import { Save, AlertCircle } from 'lucide-react';

export default function ModEditor({ user }: { user: User | null }) {
  const { modId } = useParams();
  const navigate = useNavigate();
  const [code, setCode] = useState(`// Welcome to the Mod Editor!
// You can use the global 'api' object to interact with the game.

// The active mods load in order.
api.showMessage('Mod initialized!');

// Register a bouncy custom material!
api.registerPhysicsMaterial('bouncy', 0.1, 1.5); // friction, restitution
api.registerPhysicsMaterial('ice', 0.0, 0.1); 

// You can listen to events!
api.on('object_spawned', (data) => {
    // data.type, data.position, data.mass
    api.showMessage("Spawned a " + data.type);
    api.addCurrency(5); // Give bonus currency
});

// Manipulate the world or player
api.setSkyColor(0xffaa55); // Sunset
api.setPlayerJump(20);     // Super jump
api.setGravity(-10);       // Low gravity

// Create custom UI (use Tailwind!)
api.addUI('my_mod_ui', \`
    <div class="fixed top-4 left-4 bg-black/50 text-white p-4 rounded backdrop-blur border border-emerald-500/50">
        <h2 class="text-xl font-bold text-emerald-400">Custom Mod UI</h2>
        <p>This mod makes jumping higher and reduces gravity!</p>
        <p class="text-sm text-neutral-400 mt-2">Try switching to the Gravity Gun (Q) <br/>and invert gravity of an object (E)!</p>
    </div>
\`);
`);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (modId) {
      setLoading(true);
      getDoc(doc(db, 'mods', modId)).then((docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          setName(data.name);
          setDescription(data.description);
          setCode(data.code);
        } else {
          setError('Mod not found');
        }
        setLoading(false);
      }).catch(err => {
        setError(err.message);
        setLoading(false);
      });
    }
  }, [modId]);

  const handleSave = async () => {
    if (!user) {
      setError('You must be logged in to save mods.');
      return;
    }
    if (!name) {
      setError('Mod name is required.');
      return;
    }
    
    if (!window.confirm("Are you sure you want to publish this mod? It will be visible to all users.")) {
        return;
    }

    setLoading(true);
    setError('');

    try {
      if (modId) {
        // Update existing
        await updateDoc(doc(db, 'mods', modId), {
          name,
          description,
          code,
          updatedAt: Date.now()
        });
        navigate('/mods');
      } else {
        // Create new
        const modData = {
          authorId: user.uid,
          authorName: user.displayName || 'Unknown',
          name,
          description,
          code,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        const docRef = await addDoc(collection(db, 'mods'), modData);
        navigate(`/editor/${docRef.id}`);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <AlertCircle className="mx-auto h-12 w-12 text-yellow-500 mb-4" />
          <h2 className="text-xl font-bold mb-2">Login Required</h2>
          <p className="text-neutral-400">You must sign in to create or edit mods.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-neutral-900">
      <div className="bg-neutral-800 p-4 shrink-0 flex gap-4 items-center border-b border-neutral-700">
        <input 
          type="text" 
          placeholder="Mod Name" 
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="bg-neutral-700 border border-neutral-600 rounded px-3 py-1.5 focus:outline-none focus:border-blue-500 text-white"
        />
        <input 
          type="text" 
          placeholder="Description" 
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="bg-neutral-700 border border-neutral-600 rounded px-3 py-1.5 focus:outline-none focus:border-blue-500 text-white flex-1"
        />
        <button 
          onClick={handleSave} 
          disabled={loading}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-1.5 rounded disabled:opacity-50 transition-colors"
        >
          <Save size={16} /> {loading ? 'Saving...' : 'Save & Publish'}
        </button>
      </div>
      {error && (
        <div className="bg-red-500/10 border-l-4 border-red-500 text-red-500 p-4 shrink-0">
          {error}
        </div>
      )}
      <div className="flex-1 min-h-0">
        <Editor
          height="100%"
          defaultLanguage="javascript"
          theme="vs-dark"
          value={code}
          onChange={(value) => setCode(value || '')}
          options={{
            minimap: { enabled: false },
            fontSize: 14,
            wordWrap: 'on'
          }}
        />
      </div>
    </div>
  );
}
