'use client';

import React from 'react';

export function ReelModal({ reel, isOpen, onClose }: any) {
  if (!isOpen || !reel) return null;
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-3xl max-w-2xl w-full mx-4 p-6" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between mb-4">
          <h3 className="text-xl font-semibold">Reel Details</h3>
          <button onClick={onClose} className="text-2xl">&times;</button>
        </div>
        
        {reel.media_url ? (
          <video controls className="w-full rounded-2xl mb-4" src={reel.media_url} />
        ) : (
          <div className="bg-gray-100 h-64 flex items-center justify-center rounded-2xl mb-4">
            Video preview not available yet
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>Views: <strong>{reel.views || '—'}</strong></div>
          <div>Likes: <strong>{reel.likes || '—'}</strong></div>
          <div>Comments: <strong>{reel.comments || '—'}</strong></div>
          <div>Engagement: <strong>{reel.engagement_rate || '—'}%</strong></div>
        </div>

        {reel.caption && <p className="mt-4 text-gray-700">{reel.caption}</p>}
      </div>
    </div>
  );
}
