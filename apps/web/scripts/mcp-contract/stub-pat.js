export const verifyToken = async (authz) =>
  authz === "Bearer tos_good"
    ? { tokenId: "t1", userId: "u1", workspaceId: "w1", role: "OWNER", scopes: [] }
    : authz === "Bearer tos_readonly"
    ? { tokenId: "t2", userId: "u1", workspaceId: "w1", role: "OWNER", scopes: ["read"] }
    : null;
export const canWrite = (i) => i.role !== "VIEWER" && !(i.scopes.includes("read") && !i.scopes.includes("write"));
