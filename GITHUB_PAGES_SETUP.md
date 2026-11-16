# GitHub Pages deployment checklist

## Existing Swell game site

Replace the existing game site's root `index.html`, `app.js`, and `style.css` with the matching files from this package's `game/` directory. The bridge is required because the S-Client manager is a different website origin and cannot access game internals without the game's cooperation.

Commit and push the changes, then wait for GitHub Pages to finish deploying. Keep the game site's full HTTPS URL handy.

## S-Client website

Create a separate repository and put the contents of this folder in its root. Enable GitHub Pages from `main` / `/ (root)` under Settings → Pages. The published `index.html` is the website entry point; no build step is needed.

On the S-Client Game page, paste the game's HTTPS GitHub Pages URL and select **Connect game**.

## Important

- Use the real published game URL, including the repository path, e.g. `https://username.github.io/repository/`.
- The updated Swell game code must be deployed before mods can control it.
- A page that loads in the iframe but has no bridge will show “Game loaded, but no S-Client bridge was detected.”
- S-Client and Swell saves are stored separately by browser origin.
