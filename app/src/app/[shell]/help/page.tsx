import { SiDiscord, SiGithub } from "@icons-pack/react-simple-icons";
import { Button } from "@/components/ui/button";
import {
  DISCORD_INVITE_URL,
  GITHUB_ISSUES_URL,
  GITHUB_REPO_URL,
} from "@/drizzle/constants";
import ContentBox from "@/layout/ContentBox";
import Link from "@/layout/Link";

export default function BugReport() {
  const link_t3 = (
    <Link className="font-bold" href="https://create.t3.gg/">
      T3 stack
    </Link>
  );
  const link_github = (
    <Link className="font-bold" href={GITHUB_REPO_URL}>
      GitHub
    </Link>
  );
  const link_issues = (
    <Link className="font-bold" href={GITHUB_ISSUES_URL}>
      GitHub Issues
    </Link>
  );
  return (
    <>
      <ContentBox title="Help & Feedback" subtitle="Found a bug? Let us know!">
        We need your help in making our gaming experience even better. Join our vibrant
        Discord community and become an integral part of our bug-reporting team. By
        sharing your valuable insights, you&lsquo;ll contribute to identifying and
        squashing those pesky bugs that occasionally pop up. Your reports will assist us
        in fine-tuning the gameplay, improving the overall user experience, and ensuring
        a seamless adventure for everyone. Together, let&lsquo;s forge a stronger
        connection and make this game the best it can be. Join our Discord today and let
        your voice be heard! Alternatively, report bugs directly on GitHub and help us
        improve the game.
        <div className="flex flex-wrap justify-center gap-3 p-5">
          <Link href={DISCORD_INVITE_URL}>
            <Button>
              <SiDiscord aria-hidden="true" className="mr-2 h-4 w-4" />
              Join Discord
            </Button>
          </Link>
          <Link href={GITHUB_ISSUES_URL}>
            <Button variant="outline">
              <SiGithub aria-hidden="true" className="mr-2 h-4 w-4" />
              Open GitHub issues
            </Button>
          </Link>
        </div>
      </ContentBox>
      <ContentBox
        title="Contribute to TNR"
        subtitle="Learn to code and improve TNR"
        initialBreak={true}
      >
        <p>
          Coding is a skill that has become increasingly important in today&rsquo;s
          digital age. It involves using computer programming languages to create
          software, websites, apps, and other digital tools that help automate and
          simplify various tasks. With coding, you can bring to life anything you can
          imagine and make a real impact on the world.
        </p>
        <p className="mt-3">
          <i>
            &quot;Personally, the countless hours I spent coding TNR as a youth have
            been extremely beneficial both personally and in my professional life. With
            this latest version of TNR, I hope that by enabling others to contribute to
            the codebase, we can inspire more people, young and old, to learn to code,
            while also creating an inclusive, supportive and awesome developer
            community&quot;. ~Terr
          </i>
        </p>
        <h2 className="mt-3 font-bold text-lg">How to Contribute?</h2>
        <p>
          The latest version of TNR is based on the {link_t3} and the source code is
          made available on {link_github}. You&rsquo;re highly encouraged to check out
          the codebase, as well as the {link_issues} to see if there&rsquo;s anything
          you can help with. As we progress the game, we expect to add more information
          how to contribute, so that if you are more inexperienced, we can help you get
          started. For now, you are encouraged to read up on the T3 stack and the
          technologies it&rsquo;s composed of yourself, and from there open a pull
          request on GitHub.
        </p>
        <h2 className="mt-3 font-bold text-lg">Feature Requests</h2>
        <p>
          Even if you have no coding skills or desire to learn, {link_issues} is where
          you can request new game features, or help giving feedback during development
          of new features.
        </p>
        <div className="flex justify-center p-5">
          <Link href={GITHUB_REPO_URL}>
            <Button variant="outline">
              <SiGithub aria-hidden="true" className="mr-2 h-4 w-4" />
              View the source on GitHub
            </Button>
          </Link>
        </div>
      </ContentBox>
    </>
  );
}
