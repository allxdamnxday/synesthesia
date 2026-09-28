# Deploying

The instrument is a static web app: any static host that serves HTTPS works. HTTPS matters:
WebCodecs, AudioWorklet, the clipboard and folder saving only work in a secure context
(HTTPS or `localhost`). Nothing here has been deployed yet; these steps need your own
accounts.

## Builds

| Command | What it builds |
|---|---|
| `npm run build:release` | The instrument only: what Freeman should get. |
| `npm run build` | The instrument plus the Milestone 0 spike pages (`/spikes/`) and developer harness pages (`/dev/`), for testing on a Mac. |
| `npm run preview` | Serves `dist/` on `http://localhost:4173` to try a build locally. |

Both builds use relative paths, so they work at a domain root or under a sub-path.

## Recommended: Vercel (free Hobby plan) from a private GitHub repository

Keeps the surprise private and costs nothing.

1. Create a **private** repository on GitHub and push this one to it:
   ```
   git remote add origin https://github.com/<you>/synesthesia.git
   git push -u origin main
   ```
2. In Vercel, **Add New… › Project**, import the repository. `vercel.json` already sets
   the install and build commands (`npm run build:release`) and the output folder
   (`dist`). Deploy.
3. For a Mac test build that includes the spike pages, either change the build command in
   the Vercel project settings to `npm run build` for a preview deployment, or deploy a
   branch whose `vercel.json` uses `npm run build`.
4. Open the deployment URL in Chrome on the Mac and follow `docs/MAC_TEST_CHECKLIST.md`.

Preview deployments on Vercel are protected by Vercel Authentication by default (you'll be
asked to log in); production deployments are public at their URL but not listed anywhere.

## Alternative: GitHub Pages

Free only for **public** repositories (anyone could find the code). If that's acceptable:
Settings › Pages › Source: *GitHub Actions*, then run the **Deploy to GitHub Pages**
workflow (Actions tab) and choose `release` or `test`.

## Offline use

After the first visit, the app keeps working with Wi-Fi off (Milestone 8's service worker
caches everything, including OpenCV.js). A new deployment is picked up on the next visit
when online.
