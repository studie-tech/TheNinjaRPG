import { CHARACTER_DELETION_DELAY_DAYS } from "@/drizzle/constants";
import ContentBox from "@/layout/ContentBox";
import Link from "@/layout/Link";
import { buildMetadata } from "@/libs/seo";

export const metadata = buildMetadata({
  title: "Account deletion",
  description: "How to request deletion of your TheNinja-RPG account and data.",
  path: "/account/deletion-info",
});

export default function AccountDeletionInformation() {
  return (
    <ContentBox title="Account deletion" subtitle="TheNinja-RPG · Studie-Tech ApS">
      <div className="space-y-6 py-4">
        <section className="space-y-2">
          <h2 className="font-bold text-lg">Request deletion without the app</h2>
          <p>
            Email{" "}
            <a
              href="mailto:contact@theninja-rpg.com?subject=TheNinja-RPG%20account%20deletion"
              className="break-words underline underline-offset-4"
            >
              contact@theninja-rpg.com
            </a>{" "}
            with the subject “TheNinja-RPG account deletion” and your character name.
            Use the email associated with your account where possible. We will verify
            account ownership before deleting anything. Never send your password or
            verification codes. You do not need to reinstall the app to request help.
          </p>
        </section>
        <section className="space-y-2">
          <h2 className="font-bold text-lg">Delete from the iOS or Android app</h2>
          <ol className="list-decimal space-y-2 pl-5">
            <li>Sign in to the account you want to delete and open Settings.</li>
            <li>Under App &amp; account, choose Delete account.</li>
            <li>
              Read the permanent-loss and subscription information, then complete the
              confirmations and identity verification shown in the app.
            </li>
          </ol>
          <p>
            Deletion is permanent and applies to the same account on all devices,
            including the website. Removing the app alone does not delete your account.
          </p>
        </section>
        <section className="space-y-2">
          <h2 className="font-bold text-lg">Delete your character on the website</h2>
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              Sign in on the website and open{" "}
              <Link href="/profile/edit" className="underline underline-offset-4">
                Settings
              </Link>
              .
            </li>
            <li>Choose Delete character, then Start deletion timer.</li>
            <li>
              After the {CHARACTER_DELETION_DELAY_DAYS}-day waiting period, return to
              the same page and confirm deletion. The timer never deletes anything on
              its own, and you can keep playing or cancel the request until you confirm.
            </li>
          </ol>
          <p>
            This removes your character and its game progress. Your sign-in account
            remains, so you can create a new character with it later. To delete the
            sign-in account itself, use the app or email us as described above.
          </p>
        </section>
        <section className="space-y-2">
          <h2 className="font-bold text-lg">What is deleted and retained</h2>
          <p>
            Verified deletion removes sign-in access and begins background cleanup of
            your character, progress, inventory, authored messages and forum content,
            support tickets, device registrations and account-owned uploads. Failed
            cleanup is retried. Active auctions must settle before game-data cleanup can
            finish; contact us if you need help with a pending request.
          </p>
          <p>
            Purchase records and a retired account identifier are retained indefinitely
            to prevent delayed or repeated purchase receipts from granting rewards
            again. Account deletion does not erase transaction records independently
            held by Apple, Google or other payment providers.
          </p>
          <p>
            If the account has an active ban or silence when it is deleted, we keep a
            minimal record: the account identifier, hashed versions of its email address
            and linked sign-in providers, the sanction type, its end date and a
            reference to the moderation case. It holds no character, chat or IP data. It
            is used only to apply the remaining sanction to a new account registered by
            the same person, and it is deleted automatically when the sanction ends. The
            legal basis is our legitimate interest in preventing abuse of the game (GDPR
            Art. 6(1)(f)). You can object or ask us about it at the email above, and you
            can complain to the Danish Data Protection Agency (Datatilsynet).
          </p>
        </section>
        <section className="space-y-2">
          <h2 className="font-bold text-lg">Subscriptions</h2>
          <p>
            Account deletion does not automatically cancel Federal subscriptions or
            request a refund. Manage cancellation in the store or payment service where
            you subscribed. You can request account deletion even if you need help
            canceling a subscription.
          </p>
        </section>
      </div>
    </ContentBox>
  );
}
