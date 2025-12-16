import { NextResponse } from "next/server";
import { runShrineBoostTick } from "@/server/jobs/shrineBoostScheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // avoid any caching surprises

export async function GET(req: Request) {
  const url = new URL(req.url);

  // Auth guard (so nobody can spam DB)
  const secret = url.searchParams.get("secret");
  const expected = process.env.CRON_SECRET;

  if (expected && secret !== expected) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await runShrineBoostTick(new Date());
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[ShrineBoostCron] error", err);
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
