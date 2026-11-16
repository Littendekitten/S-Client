# S-Client — Swell Edition (GitHub Pages)

S-Client is a static website for hosting on GitHub Pages. It connects to your existing Swell GitHub Pages game through an iframe and a cross-origin `postMessage` bridge. It does **not** need a Node server, backend, or local server when deployed to GitHub Pages.

## GitHub Pages setup

You will publish two static sites: your existing Swell game and S-Client. They can live in separate GitHub repositories.

### 1. Update the existing Swell game repository

The game needs the S-Client bridge before a separately hosted S-Client website can control it. Cross-origin browser security prevents the client website from reading or changing another site's JavaScript variables directly; the bridge is the supported connection.

1. Open the GitHub repository that currently publishes your Swell game.
2. Open the folder that contains the live game's `index.html`, `app.js`, and `style.css`.
3. Replace those three files with the matching files from this package's `game/` folder.
4. Commit and push the changes.
5. Wait for GitHub Pages to publish the updated game.
6. Open the game URL directly and make sure Swell still starts normally.

The updated `game/app.js` includes the S-Client bridge and the high-speed camera FOV clamp that prevents the speed effect from flipping or severely distorting the view.

### 2. Publish S-Client on GitHub Pages

1. Create a new GitHub repository, for example `s-client`.
2. Upload the **contents** of this `S-Client` folder to the repository root. `index.html`, `client.js`, `styles.css`, `mods/`, and `examples/` must be at the top level, not inside an extra nested folder.
3. In that repository, open **Settings → Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Select the `main` branch and `/ (root)`, then save.
6. Open the published URL GitHub Pages displays.

### 3. Connect your game

1. Open your published S-Client website.
2. On the Game page, paste the complete Swell GitHub Pages URL into **GitHub Pages Game URL**. Example: `https://yourname.github.io/swell/`.
3. Click **Connect game**.
4. When the connection status changes to Connected, open **Mods** and toggle **Swell Hacks** and its individual features.

S-Client also accepts a `?game=` query parameter, so a direct link can prefill the game URL. For example:

`https://yourname.github.io/s-client/?game=https%3A%2F%2Fyourname.github.io%2Fswell%2F`

## Included features

- Remote GitHub Pages game connection (cross-origin iframe + origin-checked `postMessage`).
- Saved game URL, reconnect/reload, and open-game-in-new-tab option.
- Mod manager with per-mod enable/disable switches.
- Per-feature toggles and quick-action buttons.
- Import `.sclient` packages and download/export installed mods.
- Installed mod library persisted in the S-Client site's browser storage.
- Bundled `Swell Hacks` mod.
- Sample mod package and `MODDING.md` format guide.

## First mod: Swell Hacks

The included `mods/swell-hacks.sclient` package exposes timer freeze, crystal magnet, no dash cooldown, super jump, collect crystal, refill timer, coin actions, score action, and unlock all ships. Feature switches are off by default; enable the mod and then turn on the individual features you want.

## Mod package format and safety

`.sclient` packages are JSON manifests with `format: "sclient-mod"` and `formatVersion: 1`. The current client uses an allow-listed declarative API. Imported packages do not execute arbitrary JavaScript. See `MODDING.md` and `examples/sample-mod.sclient` to build compatible mods.

## Data and limitations

S-Client is static: it stores the mod list and selected game URL in the browser's local storage for the S-Client website's origin. Swell's own save remains stored by the game origin. Coin changes and ship unlocks affect the local Swell save only; they do not update remote server records. Some browsers may restrict storage in embedded third-party frames. Use **Open separately** to check the game directly if the game itself has a browser storage issue, though mod controls require the game to be embedded in S-Client.

## Optional local preview

For a quick preview before deploying, you can run `python3 -m http.server 8000` from this folder and open `http://localhost:8000`. GitHub Pages deployment does not require this.
