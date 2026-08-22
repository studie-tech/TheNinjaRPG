import { randomBytes } from "node:crypto";
import { auth } from "@clerk/nextjs/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { redirect } from "next/navigation";
import { storeConnectCode } from "@/libs/devContribution/deviceToken";

// The connect page is the bridge between the user's browser (which holds
// their Clerk session) and the desktop dev client:
//
//   1. The client generates a PKCE verifier + challenge, opens the browser at
//      /dev-connect?state=...&code_challenge=...&loopback_port=...
//   2. The user confirms, we mint a single-use connect code (5 min TTL) bound
//      to (userId, challenge) and redirect the browser to the client's
//      loopback callback with the code.
//   3. The client exchanges code + verifier via tRPC exchangeConnectCode and
//      receives a short-lived device token.
//
// Minting is deliberately behind a POST from the confirmation form below.
// Rendering a page must not have the side effect of issuing an account
// credential: on GET, any site could drive a signed-in user's browser here and
// mint codes (and clobber a genuine in-progress sign-in) simply by linking to
// it. All inputs are also format-validated, so the redirect target can only
// ever be a loopback port.

const STATE_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const connectLimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, "60 s"),
  analytics: true,
  prefix: "dev-connect",
});

interface ConnectParams {
  state: string;
  challenge: string;
  port: number;
}

const parseParams = (params: {
  state?: string;
  code_challenge?: string;
  loopback_port?: string;
}): ConnectParams | null => {
  const state = params.state ?? "";
  const challenge = params.code_challenge ?? "";
  const port = Number(params.loopback_port ?? Number.NaN);
  if (!STATE_PATTERN.test(state) || !CHALLENGE_PATTERN.test(challenge)) return null;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { state, challenge, port };
};

export default async function DevConnectPage({
  searchParams,
}: {
  searchParams: Promise<{
    state?: string;
    code_challenge?: string;
    loopback_port?: string;
    error?: string;
  }>;
}) {
  const params = await searchParams;
  const parsed = parseParams(params);
  if (!parsed) redirect("/login");

  const { userId } = await auth();
  if (!userId) {
    const returnUrl =
      `/dev-connect?state=${encodeURIComponent(parsed.state)}` +
      `&code_challenge=${encodeURIComponent(parsed.challenge)}` +
      `&loopback_port=${parsed.port}`;
    redirect(`/login?redirectUrl=${encodeURIComponent(returnUrl)}`);
  }

  async function connect(formData: FormData) {
    "use server";
    const confirmed = parseParams({
      state: String(formData.get("state") ?? ""),
      code_challenge: String(formData.get("code_challenge") ?? ""),
      loopback_port: String(formData.get("loopback_port") ?? ""),
    });
    if (!confirmed) redirect("/login");

    const session = await auth();
    if (!session.userId) redirect("/login");

    const { success } = await connectLimit.limit(session.userId);
    if (!success) {
      redirect(
        `/dev-connect?state=${encodeURIComponent(confirmed.state)}` +
          `&code_challenge=${encodeURIComponent(confirmed.challenge)}` +
          `&loopback_port=${confirmed.port}&error=rate-limit`,
      );
    }

    const code = randomBytes(32).toString("hex");
    await storeConnectCode(code, {
      userId: session.userId,
      challenge: confirmed.challenge,
    });

    redirect(
      `http://127.0.0.1:${confirmed.port}/callback` +
        `?code=${code}&state=${encodeURIComponent(confirmed.state)}`,
    );
  }

  return (
    <div className="mx-auto mt-24 max-w-md rounded-lg border border-border bg-card p-6 text-card-foreground">
      <h1 className="font-bold text-xl">Connect the TNR Dev Client</h1>
      <p className="mt-3 text-muted-foreground text-sm">
        The desktop dev client on this machine is asking to sign in to your game
        account. It will be able to claim contribution jobs and record their results.
      </p>
      <p className="mt-3 text-muted-foreground text-sm">
        Only continue if you just started sign-in from the app on this computer. The
        connection will be sent to{" "}
        <code className="font-mono">127.0.0.1:{parsed.port}</code>.
      </p>
      {params.error === "rate-limit" && (
        <p className="mt-4 rounded-md bg-destructive/10 p-3 text-destructive text-sm">
          Too many connection attempts. Wait a minute and try again.
        </p>
      )}
      <form action={connect} className="mt-6">
        <input type="hidden" name="state" value={parsed.state} />
        <input type="hidden" name="code_challenge" value={parsed.challenge} />
        <input type="hidden" name="loopback_port" value={String(parsed.port)} />
        <button
          type="submit"
          className="w-full rounded-md bg-primary px-4 py-2 font-semibold text-primary-foreground hover:opacity-90"
        >
          Connect this device
        </button>
      </form>
    </div>
  );
}
