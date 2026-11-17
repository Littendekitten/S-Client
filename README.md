# Make Your Own S-Client Mods

Welcome to the S-Client modding guide! S-Client mods use **`.sclient` files**, which are JSON files written in **SCL (S-Client Language)**.

SCL is a small, event-driven language. You describe a mod's name, settings, buttons and behavior in JSON. S-Client reads and interprets that file when the mod is imported. You do **not** write JavaScript for a mod.

> **Important:** SCL is deliberately sandboxed. A mod cannot run arbitrary JavaScript, access the filesystem, make network requests, manipulate the page/DOM, or load custom executable GLSL shaders. Only the documented SCL statements and host APIs are available.

## 1. What you need

- A text editor such as VS Code, Notepad++ or even Notepad.
- S-Client, so you can import and test your mod.
- A basic understanding of JSON. You can learn by copying the example below and changing one part at a time.

Create a new text file and name it something like `my-first-mod.sclient`. Make sure your editor saves it as UTF-8 and does not append `.txt` to the filename.

## 2. Your first mod

Copy this complete example into `my-first-mod.sclient`:

```json
{
  "format": "sclient-mod",
  "formatVersion": 2,
  "language": "SCL",
  "languageVersion": 1,
  "id": "my-first-mod",
  "name": "My First Mod",
  "version": "1.0.0",
  "author": "Your name",
  "game": "aquavoid",
  "icon": "✨",
  "description": "My first S-Client Language mod.",
  "permissions": ["ui.toast"],
  "features": [],
  "settings": [],
  "actions": [],
  "controls": [
    {
      "id": "say-hello",
      "type": "button",
      "label": "Say hello",
      "description": "Show a message from your mod.",
      "onClick": [
        { "op": "toast", "message": "Hello from my first SCL mod!" }
      ]
    }
  ],
  "program": {
    "onEnable": [
      { "op": "toast", "message": "$mod.name enabled!" }
    ]
  }
}
```

### What the fields mean

| Field | Purpose |
|---|---|
| `format` | Must be `sclient-mod`. |
| `formatVersion` | Use `2` for SCL mods. |
| `language` | Must be `SCL`. |
| `languageVersion` | Current SCL version is `1`. |
| `id` | Unique ID for your mod. Use 2–64 letters, numbers, dots, `_` or `-`. |
| `name` | Name shown in S-Client. |
| `version` | Your mod's version, for example `1.0.0`. |
| `author` | Your name or creator name. |
| `game` | Use `aquavoid`. Legacy `swell` is also accepted. |
| `icon` | A short label or emoji. |
| `description` | A short explanation of your mod. |
| `permissions` | Host capabilities your mod requests. |
| `features` | Feature switches declared by the mod. |
| `settings` | User-configurable values. |
| `controls` | Controls shown on your mod's page. |
| `program` | Event handlers containing SCL statements. |

## 3. Add settings

Settings store values that players can change. Add them to the top-level `settings` array.

### Toggle

```json
{
  "id": "show-message",
  "label": "Show welcome message",
  "type": "toggle",
  "defaultValue": true
}
```

### Slider

```json
{
  "id": "strength",
  "label": "Effect strength",
  "type": "slider",
  "min": 0,
  "max": 100,
  "step": 5,
  "defaultValue": 50
}
```

### Other setting types

- `select`: choose one value from a list of options. Each option has `value` and `label`.
- `number`: enter a number within `min` and `max`.
- `color`: choose a six-digit hex color such as `#55aaff`.
- `text`: enter a short text value (up to 120 characters; `maxLength` can lower the limit).

A `select` example:

```json
{
  "id": "ocean-theme",
  "label": "Ocean theme",
  "type": "select",
  "defaultValue": "deep",
  "options": [
    { "value": "deep", "label": "Deep ocean" },
    { "value": "bright", "label": "Bright water" }
  ]
}
```

## 4. Add controls to your mod page

Controls let players interact with your mod.

### Button

```json
{
  "id": "notify-button",
  "type": "button",
  "label": "Show notification",
  "onClick": [
    { "op": "toast", "message": "Button pressed!" }
  ]
}
```

### Display text

```json
{
  "id": "about-text",
  "type": "text",
  "label": "About this mod",
  "description": "This text is displayed on the mod page."
}
```

### Bind a control to a setting

A control can edit a setting you declared in the `settings` array. The control type must match the setting type: `toggle` with `toggle`, `select` with `select`, and `slider` with `slider` or `number`.

```json
{
  "id": "strength-control",
  "type": "slider",
  "label": "Effect strength",
  "setting": "strength",
  "min": 0,
  "max": 100,
  "step": 5
}
```

`shaderPicker` is a special control reserved for the built-in Eyesight mod. It is not a general-purpose custom shader editor.

## 5. Make your mod do things

SCL statements are placed in event-handler arrays. The current events are:

- `onInstall`: runs the first time this mod ID is imported for the account.
- `onEnable`: runs when the player enables the mod.
- `onDisable`: runs when the player disables it.
- `onSettingChange`: runs when one of the mod's settings changes.
- `onFeatureChange`: runs when one of the mod's feature switches changes.

Example:

```json
"program": {
  "onEnable": [
    { "op": "toast", "message": "Thanks for enabling my mod!" }
  ],
  "onDisable": [
    { "op": "toast", "message": "My mod has been disabled." }
  ],
  "onSettingChange": [
    { "op": "toast", "message": "A setting was changed." }
  ]
}
```

### Supported statements

| Statement | What it does |
|---|---|
| `toast` | Shows an S-Client notification. |
| `setSetting` | Changes one of this mod's declared settings. |
| `setFeature` | Changes one of this mod's declared feature switches. |
| `setState` | Saves a JSON primitive to this mod's persistent state. |
| `incrementState` | Adds a number to a numeric state value. |
| `if` | Runs a `then` or `else` statement list based on a simple comparison. |
| `call` | Calls a documented, allowlisted S-Client API. |

For example, this stores and increments a click counter:

```json
{
  "op": "incrementState",
  "key": "clicks",
  "by": 1
}
```

Then this checks whether it has reached five:

```json
{
  "op": "if",
  "condition": {
    "source": "state",
    "key": "clicks",
    "greaterThan": 4
  },
  "then": [
    { "op": "toast", "message": "You clicked five times!" }
  ],
  "else": []
}
```

Conditions can read `setting`, `state`, `feature`, or the current event `value`. Use one comparator: `equals`, `notEquals`, `greaterThan`, `lessThan`, or `truthy`.

## 6. Use value references

SCL does not evaluate JavaScript expressions. It recognizes only specific reference strings in supported fields:

| Reference | Meaning |
|---|---|
| `$value` | Current control/event value. |
| `$feature` | Feature ID in `onFeatureChange`. |
| `$enabled` | New enabled state in `onFeatureChange`. |
| `$setting:settingId` | Current value of a declared setting. |
| `$state:key` | A value stored in mod state. |
| `$mod.id` | This mod's ID. |
| `$mod.name` | This mod's display name. |

For example, `{ "op": "toast", "message": "$mod.name enabled!" }` includes the mod's display name in the notification.

## 7. Permissions and built-in APIs

A permission is not a way to invent new game functionality. S-Client checks that the API exists and that the mod is allowed to use it.

| Permission / API | Purpose |
|---|---|
| `ui.toast` | Documents use of the notification API. `ui.toast` does not require a permission. |
| `eyesight.presets` | Allows the Eyesight mod to select or reset a preset. The API is restricted to the mod ID `eyesight`. |
| `aquavoid.features` | Allows toggling existing built-in Aquavoid feature flags that are wired into S-Client. |
| `aquavoid.actions` | Allows calling specific existing Aquavoid actions. |

The recognized legacy Aquavoid action IDs are `collectCrystal`, `refillTimer`, `addCoins`, `setCoins`, `addScore`, `unlockShips` and `stormStrike`. Their availability still depends on game state and mode restrictions.

To call a documented API, use a SCL `call` statement. For example:

```json
{
  "op": "call",
  "api": "ui.toast",
  "value": "Hello from my mod!"
}
```

A mod manifest cannot add new APIs. Ask the S-Client project maintainers to add a specific host API if your idea needs new game functionality.

## 8. Eyesight and shaders

Eyesight is a special built-in S-Client mod. It uses the `eyesight.presets` permission and the built-in `eyesight.selectPreset` API. That API is restricted to the mod whose ID is `eyesight`.

Shader packs are data-only color-grade settings. SCL mods cannot upload or execute custom JavaScript or GLSL shader source. The `shaderPicker` control is reserved for Eyesight.

## 9. Test and publish your mod

1. Save your file with the `.sclient` extension.
2. Make sure the content is valid JSON: every quote, comma, bracket and brace matters.
3. Open S-Client and go to **Mod manager**.
4. Import your `.sclient` file.
5. Enable the mod and open its mod page.
6. Test every control and event.
7. When you make changes, import the edited file again to update the installed mod.
8. Share the `.sclient` file so other people can inspect its contents.

If you are using the full S-Client source repository, you can also run its validator from the repository root:

```bash
node tools/validate-sclient.mjs path/to/my-first-mod.sclient
```

## 10. Current limits

The current client limits a mod to:

- 30 features and 30 settings.
- 30 controls.
- 40 statements per handler and 100 statements total, including nested branches.
- `if` nesting depth of 4.
- 20 options per `select` setting.
- 1.5 MB per imported file or ZIP member.

SCL v1 does not support arbitrary JavaScript, `eval`, filesystem access, network requests, DOM access, custom executable GLSL, or access to another user's account data. Only install mods from creators you trust.

## 11. The four files in this guide website

- `README.md` — this complete mod-making guide, also visible on GitHub.
- `index.html` — the website structure.
- `app.js` — the interactive guide content and code-copy controls.
- `style.css` — the website styling and responsive layout.

To publish this guide with GitHub Pages, upload these four files to the root of a repository. In **Settings → Pages**, choose **Deploy from a branch**, select your branch (usually `main`) and choose **/(root)**.
