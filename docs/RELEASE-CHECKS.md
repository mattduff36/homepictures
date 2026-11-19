# Release checks

From the website repository root, use Node.js 24 and run these commands before pushing a release.

```sh
npm ci
npm run check:release
```

The release command generates Next.js route types, runs TypeScript and ESLint, runs the unit suite defined by `npm test`, then runs the production build. Four Windows PowerShell runtime cases explicitly skip on non-Windows hosts; all platform-independent tests, including static installer checks, still run. It stops at the first failure. Fix the failing step and rerun the command before pushing.

GitHub Actions runs the same command after `npm ci` on a Windows runner for pull requests, pushes to `main`, and manual runs of the **Release checks** workflow. This runs all 160 tests, including the four Windows PowerShell runtime cases without skips. The workflow uses read-only repository access and requires no deployment credentials.

Vercel runs `npm run check:release` as its build command for preview and production source builds that use `vercel.json`. A failed check fails that build, including when a push to `main` starts a Vercel build before GitHub Actions finishes. Vercel runs the 156 platform-independent tests; the four Windows runtime cases are separately enforced by GitHub Actions and are not part of this Linux publication gate. Check both the Vercel deployment status and GitHub workflow result after pushing.

Run the Playwright suite separately with `npm run test:browser` when verifying browser behavior. API-mocked viewer/reliability scenarios block service workers so request interception stays predictable, while `offline.spec.ts` installs and exercises the real worker. Live HTTPS acceptance also runs with the real worker and no request mocks. Browser checks remain separate from the automated source-build gate. Prebuilt uploads, promotions of existing deployments, and deployments that bypass this Vercel build configuration can skip the release command.
