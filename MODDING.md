# Making S-Client mods for Swell

S-Client uses the `.sclient` extension for JSON mod packages. A package describes the mod, its toggleable features, and its action buttons. The client does **not** execute imported JavaScript; it only invokes capabilities exposed by the Swell game bridge. This keeps imported mods from running arbitrary code inside the client page.

## Minimal package

```json
{
  "format": "sclient-mod",
  "formatVersion": 1,
  "id": "my-swell-mod",
  "name": "My Swell Mod",
  "version": "1.0.0",
  "author": "Your name",
  "game": "swell",
  "description": "A short description of the mod.",
  "icon": "✦",
  "features": [
    {
      "id": "freezeTimer",
      "name": "Freeze timer",
      "description": "Pauses the round countdown.",
      "defaultEnabled": false
    }
  ],
  "actions": [
    {
      "id": "refill-timer",
      "label": "Refill timer",
      "action": "refillTimer"
    }
  ]
}
```

Save the JSON as `my-swell-mod.sclient`, then use **Mods → Import mod** in S-Client.

## Supported Swell feature IDs

- `freezeTimer` — stops the round timer from counting down.
- `crystalMagnet` — moves the current crystal to the player.
- `noDashCooldown` — removes the dash cooldown.
- `superJump` — increases jump strength.

Feature IDs are case-sensitive. Unsupported feature IDs remain visible in the mod card but are marked `API NOT AVAILABLE` until the game bridge implements them.

## Supported action names

- `collectCrystal`
- `refillTimer`
- `setCoins` (numeric `value`)
- `addCoins` (numeric `value`)
- `addScore` (numeric `value`)
- `unlockShips`

Example action:

```json
{ "id": "bonus-coins", "label": "+500 coins", "action": "addCoins", "value": 500 }
```

Only these action names are accepted by the current Swell bridge. Unknown actions remain visible but disabled. Numeric action values are limited to ±1,000,000,000 by package validation; the in-game coin balance is capped at 1,000,000,000.

## Adding a new capability

To implement a new feature or action, add it to the allow-list and message handler in `game/app.js`, then add its ID to the matching support set in `client.js`. Keep new capabilities narrow and validate incoming values in the game code. Mods can then reference the new ID in their `.sclient` manifest.

## Notes

- The client stores its installed mod list and toggle states in this browser's local storage.
- The Download button on each mod card exports that installed package as a `.sclient` file.
- S-Client currently targets the supplied Swell game only; the `game` field must be `swell`.
- This is a local game integration. It does not change remote server records or grant server-side multiplayer advantages.
