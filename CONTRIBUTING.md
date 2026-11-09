# How to contribute

## License

By contributing, I confirm that I have the right to waive copyright and related rights to my contribution, and agree that all copyright and related rights in my contributions are waived, and I acknowledge that the Studie-Tech ApS organization has the copyright to use and modify my contribution for perpetuity.

## Getting Started

- Make sure you have a [GitHub account](https://github.com/signup/free).
- [Fork](https://help.github.com/articles/fork-a-repo/) this repository on GitHub.
- On your local machine,
  [clone](https://help.github.com/articles/cloning-a-repository/) your fork of
  the repository.

## Making Changes

- Add code to your local fork. It's usually a [good
  idea](http://blog.jasonmeridth.com/posts/do-not-issue-pull-requests-from-your-master-branch/)
  to make changes on a
  [branch](https://help.github.com/articles/creating-and-deleting-branches-within-your-repository/)
  with the branch name relating to the feature you are going to add.
- When you are ready for others to examine and comment on your new feature,
  navigate to your fork of `TheNinjaRPG` on GitHub and open a [pull
  request](https://help.github.com/articles/using-pull-requests/) (PR). Note that
  after you launch a PR from one of your fork's branches, all
  subsequent commits to that branch will be added to the open pull request
  automatically.
- When the PR is approved it will be merged into main and automatically deployed onto [www.theninja-rpg.com](https://www.theninja-rpg.com)
- Pull requests do not get a Vercel preview by default (to avoid paying for every open PR). A collaborator with write access can comment `/tnr-create-preview` on the PR to deploy one of the current head commit. Later pushes do not refresh that URL; run the command again if you need an updated preview.

## Code Conventions

- Code should be as readable as possible; hard to understand logic requires comments. Too many comments is not good though, see [this video](https://www.youtube.com/watch?v=Bf7vDBBOBUA).

- Write commit subjects as short imperative sentences that describe the change.

- It is expected that code complies with the biome linting and formatting settings in this repo.

- Query endpoints return only the data they need and hide sensitive information from anyone without the proper permissions: hide IPs from everyone but admins, and do not reveal quest solutions unnecessarily. Let their output types be inferred.

- Optimise image assets before including them: scale the image and export it as a 70% quality `.webp` file. This often takes a 1 MB image down to 40 KB, which helps slower mobile devices.

- Be mindful of new fields, both in data models and in JSON fields such as questData or effects. Avoid them when you can, and consider what happens at 100X the current load.

- Try UI changes across all screen widths.
