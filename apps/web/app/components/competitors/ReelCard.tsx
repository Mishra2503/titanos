'use client';

import React from 'react';
import { Play, Eye, Heart, MessageCircle, TrendingUp } from 'lucide-react';

export function ReelCard({ reel, onPlay, onViewInsights }: any) {
  return (
    <div className="bg-white rounded-2xl border p-4 cursor-pointer hover:shadow-md transition" onClick={() => onPlay(reel)}>
      <div className="flex justify-between items-start mb-3">
        <div>
          <div className="font-semibold">Reel • {reel.posted_at ? new Date(reel.posted_at).toLocaleDateString() : ''}</div>
          <div className="text-sm text-gray-500 line-clamp-2 mt-1">{reel.caption || 'No caption'}</div>
        </div>
        <button className="p-2 bg-purple-100 rounded-full">
          <Play className="w-4 h-4 text-purple-600" />
        </button>
      </div>

      <div className="grid grid-cols-4 gap-2 text-center text-sm">
        <div><Eye className="inline w-4 h-4" /> {reel.views || '—'}</div>
        <div><Heart className="inline w-4 h-4" /> {reel.likes || '—'}</div>
        <div><MessageCircle className="inline w-4 h-4" /> {reel.comments || '—'}</div>
        <div><TrendingUp className="inline w-4 h-4" /> {reel.engagement_rate || '—'}%</div>
      </div>

      {reel.hashtags && reel.hashtags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {reel.hashtags.slice(0,3).map((h: string, i: number) => (
            <span key={i} className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded">#{h}</span>
          ))}
        </div>
      )}
    </div>
  );
}
