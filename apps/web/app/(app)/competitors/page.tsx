'use client';

import React, { useState } from 'react';
import { ReelCard } from '@/components/competitors/ReelCard';
import { ReelModal } from '@/components/competitors/ReelModal';

export default function CompetitorsPage() {
  const [competitors, setCompetitors] = useState<any[]>([]);
  const [selectedCompetitor, setSelectedCompetitor] = useState<any>(null);
  const [newUsername, setNewUsername] = useState('');
  const [selectedReel, setSelectedReel] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const addCompetitor = async () => {
    if (!newUsername) return;
    setLoading(true);
    // This calls your backend - will work after merge
    try {
      const res = await fetch('/api/competitors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ig_username: newUsername }),
      });
      if (res.ok) {
        const newComp = await res.json();
        setCompetitors([...competitors, newComp]);
        setNewUsername('');
        alert('Competitor added! Refresh to see data.');
      } else {
        alert('Error adding competitor. Make sure you have a valid token configured.');
      }
    } catch (e) {
      alert('Something went wrong. Please merge the latest code first.');
    }
    setLoading(false);
  };

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-6">Competitors</h1>

      {/* Simple Add Competitor Form */}
      <div className="mb-8 p-4 bg-white rounded-2xl border flex gap-3">
        <input
          type="text"
          placeholder="Enter Instagram username (e.g. @competitorname)"
          value={newUsername}
          onChange={(e) => setNewUsername(e.target.value)}
          className="flex-1 border rounded-xl px-4 py-3 text-lg"
        />
        <button
          onClick={addCompetitor}
          disabled={loading}
          className="px-8 py-3 bg-purple-600 text-white rounded-2xl font-semibold hover:bg-purple-700 disabled:opacity-50"
        >
          {loading ? 'Adding...' : 'Add Competitor'}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Competitors List */}
        <div className="lg:col-span-1">
          <h2 className="font-semibold mb-4">Your Competitors</h2>
          {competitors.length === 0 && (
            <p className="text-gray-500">No competitors yet. Add one above.</p>
          )}
          {competitors.map((comp, index) => (
            <div
              key={index}
              onClick={() => setSelectedCompetitor(comp)}
              className={`p-4 mb-3 rounded-2xl border cursor-pointer ${selectedCompetitor?.id === comp.id ? 'border-purple-600 bg-purple-50' : 'hover:bg-gray-50'}`}
            >
              <div className="font-semibold">@{comp.ig_username}</div>
              <div className="text-sm text-gray-500">{comp.follower_count?.toLocaleString() || '—'} followers</div>
            </div>
          ))}
        </div>

        {/* Detail View */}
        <div className="lg:col-span-3">
          {selectedCompetitor ? (
            <div>
              <h2 className="text-2xl font-bold mb-4">@{selectedCompetitor.ig_username}</h2>
              
              <div className="mb-6">
                <h3 className="font-semibold mb-3">Recent Reels</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {/* This will show real reels after backend is connected */}
                  <p className="text-gray-500 col-span-full">Reel cards will appear here after you add a competitor and the backend fetches data.</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-12 text-gray-500">
              Select a competitor from the left or add a new one above to get started.
            </div>
          )}
        </div>
      </div>

      <ReelModal reel={selectedReel} isOpen={!!selectedReel} onClose={() => setSelectedReel(null)} />
    </div>
  );
}
