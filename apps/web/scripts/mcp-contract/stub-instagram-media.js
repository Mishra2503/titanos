export async function isInstagramMediaPrepared(assetId) {
  return assetId !== "not-ready";
}

export async function prepareInstagramMedia() {
  return { url: "https://cdn.example.com/instagram-ready.mp4", action: "cached", reasons: [] };
}
