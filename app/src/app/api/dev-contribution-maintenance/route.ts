import { cookies } from "next/headers";
import { runMaintenance } from "@/libs/devContribution/maintenance";
import { drizzleDB } from "@/server/db";
import { authenticateCronRequest } from "@/server/utils/cron";

export const GET = async (request: Request) => {
  // Disable caching for this endpoint.
  await cookies();

  const authError = authenticateCronRequest(request);
  if (authError) return authError;

  try {
    const report = await runMaintenance(drizzleDB, {
      token: process.env.GITHUB_ISSUE_TOKEN,
    });

    if (report.errors.length > 0) {
      console.error("[dev-contribution-maintenance] partial failure:", report);
      return Response.json({ ...report, ok: false }, { status: 500 });
    }

    return Response.json({ ...report, ok: true });
  } catch (error) {
    console.error("[dev-contribution-maintenance] crashed:", error);
    return Response.json({ ok: false, error: "maintenance crashed" }, { status: 500 });
  }
};
