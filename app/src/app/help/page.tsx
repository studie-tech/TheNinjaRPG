import { SiDiscord, SiGithub } from "@icons-pack/react-simple-icons";
import Link from "next/link";
import { DISCORD_INVITE_URL } from "@/drizzle/constants";
import ContentBox from "@/layout/ContentBox";

export default function BugReport() {
  const link_t3 = (
    <Link className="font-bold" href="https://create.t3.gg/">
      T3 stack
    </Link>
  );
  const link_github = (
    <Link className="font-bold" href="https://github.com/studie-tech/TheNinjaRPG">
      GitHub
    </Link>
  );
  const link_issues = (
    <Link
      className="font-bold"
      href="https://github.com/studie-tech/TheNinjaRPG/issues"
    >
      GitHub Issues
    </Link>
  );
  return (
    <>
      <ContentBox title="Report Bugs" subtitle="Found a bug? Let us know!">
        We need your help in making our gaming experience even better. Join our vibrant
        Discord community and become an integral part of our bug-reporting team. By
        sharing your valuable insights, you&lsquo;ll contribute to identifying and
        squashing those pesky bugs that occasionally pop up. Your reports will assist us
        in fine-tuning the gameplay, improving the overall user experience, and ensuring
        a seamless adventure for everyone. Together, let&lsquo;s forge a stronger
        connection and make this game the best it can be. Join our Discord today and let
        your voice be heard! Alternatively, report bugs directly on Github and help us
        improve the game.
        <div className="flex flex-row justify-center space-x-5 p-5">
          <Link
            href={DISCORD_INVITE_URL}
            className="flex flex-col items-center font-bold hover:opacity-50"
          >
            <SiDiscord className="text-black dark:text-white" size={100} />
            <p>Go to Discord</p>
          </Link>
          <Link
            href="https://github.com/studie-tech/TheNinjaRPG/issues"
            className="flex flex-col items-center font-bold hover:opacity-50"
          >
            <SiGithub className="text-black dark:text-white" size={100} />
            <p>Go to GitHub</p>
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
            while also creating an inclusive, supportive and awesome developmer
            community&quot;. ~Terr
          </i>
        </p>
        <h2 className="mt-3 text-2xl">How to Contribute?</h2>
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
        <h2 className="mt-3 text-2xl">Feature Requests</h2>
        <p>
          Even if you have not coding skills or desire to learn, {link_issues} is where
          you can request new game features, or help giving feedback during development
          of new features.
        </p>
        <div className="flex flex-row justify-center p-5">
          <Link
            href="https://github.com/studie-tech/TheNinjaRPG"
            className="flex flex-col items-center font-bold hover:opacity-50"
          >
            <SiGithub className="text-black dark:text-white" size={100} />
            <p>Go to GitHub</p>
          </Link>
        </div>
        <Link
          href="https://github.com/MathiasGruber/TNR-Core3"
          className="font-bold text-xs italic"
        >
          - Link to old Core3 Code
        </Link>
      </ContentBox>
    </>
  );
}
