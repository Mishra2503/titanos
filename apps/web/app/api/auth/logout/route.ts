import { NextResponse } from "next/server";
import { clearAuthCookies } from "@/lib/server/auth";

export async function POST() {
  await clearAuthCookies();
  return NextResponse.json({ message: "ok" });
}
