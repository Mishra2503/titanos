export const DEFAULT_SCOPE = "mcp:read mcp:write";
export const SUPPORTED_SCOPES = ["mcp:read", "mcp:write"];

export async function getClient(clientId) {
  return clientId === "client-1" ? { clientName: "Test client" } : null;
}

export function redirectUriAllowed(_client, redirectUri) {
  return redirectUri === "https://client.example/callback";
}

export async function issueAuthCode() {
  throw new Error("not reached by this contract");
}

export async function signConsentTicket() {
  throw new Error("not reached by this contract");
}

export async function verifyConsentTicket() {
  throw new Error("not reached by this contract");
}
