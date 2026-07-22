"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/Placeholder";
import {
  ApiError,
  deleteMedia,
  listMedia,
  uploadMedia,
  type LibraryAsset,
} from "@/lib/api";

type Banner = { kind: "ok" | "err"; msg: string } | null;
type SortKey = "recent" | "name" | "size" | "duration";

function formatBytes(n: number | null): string {
  if (!n) return "-";
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function formatDuration(s: number | null): string {
  if (s == null) return "-";
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return m > 0 ? `${m}:${sec.toString().padStart(2, "0")}` : `0:${sec.toString().padStart(2, "0")}`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "-";
  }
}

export default function LibraryPage() {
  const [assets, setAssets] = useState<LibraryAsset[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<Banner>(null);
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [preview, setPreview] = useState<LibraryAsset | null>(null);
  const [failedThumbs, setFailedThumbs] = useState<Set<string>>(new Set());
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setAssets(await listMedia());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load library");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Auto-dismiss the banner so it never lingers.
  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 4500);
    return () => clearTimeout(t);
  }, [banner]);

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      setUploading(true);
      let ok = 0;
      for (const file of Array.from(files)) {
        try {
          await uploadMedia(file);
          ok++;
        } catch (err) {
          const isCredentialError = err instanceof ApiError && err.code === "storage_not_configured";
          const msg = err instanceof ApiError ? err.message : "Upload failed";
          setBanner({
            kind: "err",
            msg: isCredentialError
              ? `Upload disabled - add the S3_* storage variables (S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET, S3_PUBLIC_BASE_URL) to your environment.`
              : `${file.name}: ${msg}`,
          });
        }
      }
      if (ok > 0) {
        setBanner({ kind: "ok", msg: `Uploaded ${ok} video${ok > 1 ? "s" : ""}` });
        await load();
      }
      setUploading(false);
    },
    [load],
  );

  async function remove(a: LibraryAsset) {
    if (!confirm(`Delete "${a.filename}"? This removes it from storage permanently.`)) return;
    setBusyId(a.id);
    try {
      await deleteMedia(a.id);
      setBanner({ kind: "ok", msg: `Deleted ${a.filename}` });
      await load();
    } catch (err) {
      setBanner({ kind: "err", msg: err instanceof ApiError ? err.message : "Delete failed" });
    } finally {
      setBusyId(null);
    }
  }

  function copyUrl(url: string) {
    void navigator.clipboard.writeText(url);
    setBanner({ kind: "ok", msg: "Delivery URL copied" });
  }

  const stats = useMemo(() => {
    const list = assets ?? [];
    return {
      count: list.length,
      bytes: list.reduce((s, a) => s + (a.size_bytes ?? 0), 0),
      duration: list.reduce((s, a) => s + (a.duration_s ?? 0), 0),
      inUse: list.filter((a) => a.in_use).length,
    };
  }, [assets]);

  const visible = useMemo(() => {
    let list = [...(assets ?? [])];
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((a) => a.filename.toLowerCase().includes(q));
    list.sort((a, b) => {
      switch (sort) {
        case "name":
          return a.filename.localeCompare(b.filename);
        case "size":
          return (b.size_bytes ?? 0) - (a.size_bytes ?? 0);
        case "duration":
          return (b.duration_s ?? 0) - (a.duration_s ?? 0);
        default:
          return +new Date(b.created_at) - +new Date(a.created_at);
      }
    });
    return list;
  }, [assets, query, sort]);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        void handleFiles(e.dataTransfer.files);
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title="Content Library"
          subtitle="Your master Reels - upload once, schedule across every account."
        />
        <button
          onClick={() => fileInput.current?.click()}
          disabled={uploading}
          className="btn-primary press disabled:opacity-50"
        >
          {uploading ? "Uploading…" : "Upload video"}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="video/*"
          multiple
          hidden
          onChange={(e) => {
            void handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {banner && (
        <div
          className={`mb-6 animate-reveal rounded-lg border px-4 py-2.5 text-sm ${
            banner.kind === "ok"
              ? "border-lime/40 bg-lime/10 text-lime"
              : "border-red-400/40 bg-red-400/10 text-red-400"
          }`}
        >
          {banner.msg}
        </div>
      )}

      {error && <p className="font-mono text-sm text-red-400">{error}</p>}

      {/* Stats strip */}
      {assets && assets.length > 0 && (
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Videos", value: stats.count.toString() },
            { label: "Storage", value: formatBytes(stats.bytes) },
            { label: "Total runtime", value: formatDuration(stats.duration) },
            { label: "In use", value: `${stats.inUse} / ${stats.count}` },
          ].map((s) => (
            <div
              key={s.label}
              className="animate-reveal rounded-xl border border-charcoal-700 bg-charcoal-800 p-4"
            >
              <p className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                {s.label}
              </p>
              <p className="mt-1 text-xl font-semibold text-ink">{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Toolbar */}
      {assets && assets.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <input
            placeholder="Search by filename…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full max-w-xs rounded-lg border border-charcoal-600 bg-charcoal px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-lime/50"
          />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded-lg border border-charcoal-600 bg-charcoal px-3 py-2 text-sm text-ink outline-none focus:border-lime/50"
          >
            <option value="recent">Newest first</option>
            <option value="name">Name A-Z</option>
            <option value="size">Largest</option>
            <option value="duration">Longest</option>
          </select>
          <span className="ml-auto font-mono text-xs text-ink-faint">
            {visible.length} of {assets.length}
          </span>
        </div>
      )}

      {/* Loading */}
      {assets === null && !error && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="aspect-[9/16] animate-pulse rounded-xl border border-charcoal-700 bg-charcoal-800"
            />
          ))}
        </div>
      )}

      {/* Empty state / dropzone */}
      {assets && assets.length === 0 && (
        <div
          onClick={() => fileInput.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-20 text-center transition-studio duration-studio ease-studio-out ${
            dragOver ? "border-lime bg-lime/5" : "border-charcoal-600 bg-charcoal-800 hover:border-charcoal-600"
          }`}
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-charcoal-700 text-2xl">
            🎬
          </div>
          <p className="mt-4 text-sm text-ink">Drop a video here, or click to upload</p>
          <p className="mt-1 font-mono text-xs text-ink-faint">
            Any video - Reels, Shorts, horizontal or long-form · any size or aspect ratio
          </p>
        </div>
      )}

      {/* Grid */}
      {assets && assets.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((a) => {
            const showThumb = a.thumbnail_url && !failedThumbs.has(a.id);
            return (
              <div
                key={a.id}
                className="group animate-reveal overflow-hidden rounded-xl border border-charcoal-700 bg-charcoal-800 transition-studio duration-studio ease-studio-out hover:border-charcoal-600"
              >
                <button
                  onClick={() => setPreview(a)}
                  className="relative block aspect-[9/16] w-full overflow-hidden bg-charcoal"
                >
                  {showThumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={a.thumbnail_url as string}
                      alt={a.filename}
                      className="h-full w-full object-cover transition-studio duration-studio ease-studio-out group-hover:scale-[1.03]"
                      onError={() =>
                        setFailedThumbs((s) => new Set(s).add(a.id))
                      }
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center font-mono text-3xl text-ink-faint">
                      🎬
                    </div>
                  )}
                  <span className="absolute inset-0 flex items-center justify-center bg-charcoal/0 opacity-0 transition-studio duration-studio ease-studio-out group-hover:bg-charcoal/30 group-hover:opacity-100">
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-lime/90 text-white">
                      ▶
                    </span>
                  </span>
                  <span className="absolute bottom-2 right-2 rounded-md bg-charcoal/80 px-1.5 py-0.5 font-mono text-[10px] text-ink">
                    {formatDuration(a.duration_s)}
                  </span>
                  <span
                    className={`absolute left-2 top-2 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
                      a.in_use
                        ? "border-lime/40 bg-lime/10 text-lime"
                        : "border-charcoal-600 bg-charcoal/80 text-ink-faint"
                    }`}
                  >
                    {a.in_use ? "In use" : "Unused"}
                  </span>
                </button>

                <div className="p-3.5">
                  <p className="truncate text-sm text-ink" title={a.filename}>
                    {a.filename}
                  </p>
                  <p className="mt-1 font-mono text-[10px] text-ink-faint">
                    {a.width && a.height ? `${a.width}×${a.height}` : "-"} ·{" "}
                    {a.format?.toUpperCase() ?? "-"} · {formatBytes(a.size_bytes)}
                  </p>

                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    <span className="rounded-md bg-charcoal-700 px-1.5 py-0.5 font-mono text-[10px] text-ink-muted">
                      {a.usage.campaigns} campaign{a.usage.campaigns === 1 ? "" : "s"}
                    </span>
                    <span className="rounded-md bg-charcoal-700 px-1.5 py-0.5 font-mono text-[10px] text-ink-muted">
                      {a.usage.scheduled_posts} scheduled
                    </span>
                    <span className="rounded-md bg-charcoal-700 px-1.5 py-0.5 font-mono text-[10px] text-ink-muted">
                      {a.usage.published_posts} published
                    </span>
                  </div>

                  <p className="mt-2.5 font-mono text-[10px] text-ink-faint">
                    {formatDate(a.created_at)}
                    {a.uploaded_by_email ? ` · ${a.uploaded_by_email}` : ""}
                  </p>

                  <div className="mt-3 flex gap-1.5">
                    <button
                      onClick={() => setPreview(a)}
                      className="press flex-1 rounded-lg border border-charcoal-600 px-2 py-1.5 text-xs text-ink-muted hover:text-ink"
                    >
                      Preview
                    </button>
                    <button
                      onClick={() => copyUrl(a.public_url)}
                      className="press rounded-lg border border-charcoal-600 px-2 py-1.5 text-xs text-ink-muted hover:text-ink"
                    >
                      Copy URL
                    </button>
                    <button
                      onClick={() => remove(a)}
                      disabled={busyId === a.id || a.in_use}
                      title={a.in_use ? "Used by a campaign - can't delete" : "Delete"}
                      className="press rounded-lg border border-red-400/30 px-2 py-1.5 text-xs text-red-400 hover:bg-red-400/10 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Drag overlay */}
      {dragOver && assets && assets.length > 0 && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-charcoal/60">
          <div className="rounded-xl border-2 border-dashed border-lime bg-charcoal-800 px-10 py-8 text-center">
            <p className="text-2xl">🎬</p>
            <p className="mt-2 text-sm text-ink">Drop to upload</p>
          </div>
        </div>
      )}

      {/* Preview modal */}
      {preview && (
        <div
          onClick={() => setPreview(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-[2px] animate-reveal"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[90vh] w-full max-w-sm flex-col overflow-hidden rounded-2xl border border-charcoal-700 bg-charcoal-800 shadow-pop"
          >
            <div className="flex items-center justify-between border-b border-charcoal-700 px-4 py-3">
              <p className="truncate text-sm text-ink" title={preview.filename}>
                {preview.filename}
              </p>
              <button
                onClick={() => setPreview(null)}
                className="press ml-2 rounded-lg px-2 py-1 text-sm text-ink-muted hover:text-ink"
              >
                ✕
              </button>
            </div>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video
              src={preview.public_url}
              controls
              autoPlay
              playsInline
              className="max-h-[70vh] w-full bg-black"
            />
            <div className="flex items-center justify-between gap-2 px-4 py-3">
              <span className="font-mono text-[11px] text-ink-faint">
                {preview.width && preview.height ? `${preview.width}×${preview.height}` : "-"} ·{" "}
                {formatDuration(preview.duration_s)} · {formatBytes(preview.size_bytes)}
              </span>
              <button
                onClick={() => copyUrl(preview.public_url)}
                className="press rounded-lg border border-charcoal-600 px-3 py-1.5 text-xs text-ink-muted hover:text-ink"
              >
                Copy URL
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
