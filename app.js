/* S-Client SCL Modding Guide
 * A dependency-free documentation page. The full written guide is in README.md.
 */
(() => {
  'use strict';

  const sections = [
    {
      id: 'start-here', group: 'GET STARTED', title: 'Start here', search: 'introduction overview SCL mod files json sandbox',
      body: `
        <p class="lead">S-Client mods are <code>.sclient</code> files: JSON documents written in <strong>SCL (S-Client Language)</strong>. You describe the mod's information, settings, controls and event behavior. S-Client validates and interprets the file when a player imports it.</p>
        <div class="info-card tip"><strong>Good to know</strong><p>You do not write JavaScript to make a mod. SCL is intentionally limited to documented commands and host APIs, which keeps uploaded mods inside a controlled runtime.</p></div>
        <h3>What you need</h3>
        <ul><li>A text editor such as VS Code, Notepad++ or Notepad.</li><li>S-Client, so you can import and test the mod.</li><li>Basic JSON syntax. Start by copying the example in the next section.</li></ul>
        <p>Create a text file named <code>my-first-mod.sclient</code>. Save it as UTF-8, and make sure your editor does not add an extra <code>.txt</code> extension.</p>`
    },
    {
      id: 'first-mod', group: 'GET STARTED', title: 'Create your first mod', search: 'hello world starter template format manifest json example',
      body: `
        <p>Copy this complete starter file. You can change the name, author, ID, icon and notification text to make it your own.</p>
        <div class="code-card" data-code="starter"><div class="code-head"><span>my-first-mod.sclient · JSON</span><button class="copy-btn" type="button" data-copy="starter">Copy code</button></div><pre><code id="code-starter"></code></pre></div>
        <h3>Root fields</h3>
        <div class="table-wrap"><table><thead><tr><th>Field</th><th>Purpose</th></tr></thead><tbody>
          <tr><td><code>format</code></td><td>Must be <code>sclient-mod</code>.</td></tr>
          <tr><td><code>formatVersion</code></td><td>Use <code>2</code> for SCL mods.</td></tr>
          <tr><td><code>language</code></td><td>Must be <code>SCL</code>.</td></tr>
          <tr><td><code>languageVersion</code></td><td>Current language version is <code>1</code>.</td></tr>
          <tr><td><code>id</code></td><td>Unique ID, 2–64 characters. Use letters, numbers, dots, underscores or hyphens.</td></tr>
          <tr><td><code>name</code>, <code>version</code></td><td>Display name and your mod's own version.</td></tr>
          <tr><td><code>author</code>, <code>description</code>, <code>icon</code></td><td>Optional information shown to players.</td></tr>
          <tr><td><code>game</code></td><td>Use <code>aquavoid</code>. The legacy value <code>swell</code> is also accepted.</td></tr>
          <tr><td><code>permissions</code></td><td>Capability requests for documented host APIs.</td></tr>
          <tr><td><code>features</code>, <code>settings</code>, <code>controls</code></td><td>Feature switches, player settings and mod-page controls.</td></tr>
          <tr><td><code>program</code></td><td>Your lifecycle event handlers and SCL statements.</td></tr>
        </tbody></table></div>`
    },
    {
      id: 'settings', group: 'BUILD YOUR MOD', title: 'Add settings', search: 'setting toggle slider number select color text default value',
      body: `
        <p>Settings are typed values that players can change. Put them in the top-level <code>settings</code> array. Every setting needs an <code>id</code>, <code>label</code> and <code>type</code>.</p>
        <h3>Toggle</h3><p>A true/false switch:</p>
        <div class="code-card"><div class="code-head"><span>TOGGLE · JSON</span><button class="copy-btn" type="button">Copy code</button></div><pre><code>{
  "id": "show-message",
  "label": "Show welcome message",
  "type": "toggle",
  "defaultValue": true
}</code></pre></div>
        <h3>Slider</h3><p>A numeric value with a minimum, maximum and optional step size:</p>
        <div class="code-card"><div class="code-head"><span>SLIDER · JSON</span><button class="copy-btn" type="button">Copy code</button></div><pre><code>{
  "id": "strength",
  "label": "Effect strength",
  "type": "slider",
  "min": 0,
  "max": 100,
  "step": 5,
  "defaultValue": 50
}</code></pre></div>
        <h3>All supported setting types</h3>
        <div class="table-wrap"><table><thead><tr><th>Type</th><th>What it does</th></tr></thead><tbody>
          <tr><td><code>select</code></td><td>Choose one item from an <code>options</code> list. Each option has a <code>value</code> and <code>label</code>.</td></tr>
          <tr><td><code>toggle</code></td><td>On/off Boolean value.</td></tr>
          <tr><td><code>slider</code></td><td>Choose a number within <code>min</code> and <code>max</code>; optional <code>step</code>.</td></tr>
          <tr><td><code>number</code></td><td>Numeric input within <code>min</code> and <code>max</code>.</td></tr>
          <tr><td><code>color</code></td><td>Six-digit hex color such as <code>#55aaff</code>.</td></tr>
          <tr><td><code>text</code></td><td>Short text value (maximum 120 characters; <code>maxLength</code> can lower it).</td></tr>
        </tbody></table></div>
        <h3>Select example</h3>
        <div class="code-card"><div class="code-head"><span>SELECT · JSON</span><button class="copy-btn" type="button">Copy code</button></div><pre><code>{
  "id": "ocean-theme",
  "label": "Ocean theme",
  "type": "select",
  "defaultValue": "deep",
  "options": [
    { "value": "deep", "label": "Deep ocean" },
    { "value": "bright", "label": "Bright water" }
  ]
}</code></pre></div>`
    },
    {
      id: 'controls', group: 'BUILD YOUR MOD', title: 'Add mod-page controls', search: 'controls button text toggle select slider shaderPicker onClick',
      body: `
        <p>Controls appear on your mod's page and let players interact with it. Each control needs an <code>id</code> and <code>type</code>. Labels and descriptions are optional.</p>
        <h3>Button</h3>
        <div class="code-card"><div class="code-head"><span>BUTTON · JSON</span><button class="copy-btn" type="button">Copy code</button></div><pre><code>{
  "id": "notify-button",
  "type": "button",
  "label": "Show notification",
  "onClick": [
    { "op": "toast", "message": "Button pressed!" }
  ]
}</code></pre></div>
        <h3>Display text</h3>
        <div class="code-card"><div class="code-head"><span>TEXT · JSON</span><button class="copy-btn" type="button">Copy code</button></div><pre><code>{
  "id": "about-text",
  "type": "text",
  "label": "About this mod",
  "description": "A short explanation for players."
}</code></pre></div>
        <h3>Bind a control to a setting</h3>
        <p>A <code>toggle</code>, <code>select</code> or <code>slider</code> control can edit a setting that is declared in the top-level <code>settings</code> array. The control type must match the setting type. A slider can be bound to a <code>slider</code> or <code>number</code> setting.</p>
        <div class="code-card"><div class="code-head"><span>SETTING CONTROL · JSON</span><button class="copy-btn" type="button">Copy code</button></div><pre><code>{
  "id": "strength-control",
  "type": "slider",
  "label": "Effect strength",
  "setting": "strength",
  "min": 0,
  "max": 100,
  "step": 5
}</code></pre></div>
        <div class="info-card warning"><strong>Special control: shaderPicker</strong><p><code>shaderPicker</code> is reserved for the built-in Eyesight mod. It requires the <code>eyesight.presets</code> permission and a supported change handler. It is not a general-purpose custom shader editor.</p></div>`
    },
    {
      id: 'events', group: 'BUILD YOUR MOD', title: 'Events and behavior', search: 'program event onInstall onEnable onDisable onSettingChange onFeatureChange',
      body: `
        <p>Your <code>program</code> object can contain arrays of SCL statements. These arrays run when a specific event happens.</p>
        <div class="table-wrap"><table><thead><tr><th>Event</th><th>When it runs</th></tr></thead><tbody>
          <tr><td><code>onInstall</code></td><td>The first time this mod ID is imported for the account.</td></tr>
          <tr><td><code>onEnable</code></td><td>When the player enables the mod.</td></tr>
          <tr><td><code>onDisable</code></td><td>When the player disables the mod.</td></tr>
          <tr><td><code>onSettingChange</code></td><td>After one of the mod's settings changes.</td></tr>
          <tr><td><code>onFeatureChange</code></td><td>After one of the mod's feature switches changes.</td></tr>
        </tbody></table></div>
        <h3>Lifecycle example</h3>
        <div class="code-card"><div class="code-head"><span>PROGRAM · JSON</span><button class="copy-btn" type="button">Copy code</button></div><pre><code>{
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
}</code></pre></div>
        <p>Buttons can also have an <code>onClick</code> statement array. Controls that accept a value can use <code>onChange</code>.</p>`
    },
    {
      id: 'statements', group: 'SCL LANGUAGE', title: 'SCL statements', search: 'toast setSetting setFeature setState incrementState if call statements operators',
      body: `
        <p>SCL is a declarative command language, not JavaScript. Each statement is a JSON object with an <code>op</code> field. Unknown operations are rejected at import.</p>
        <div class="table-wrap"><table><thead><tr><th>Operation</th><th>Purpose</th></tr></thead><tbody>
          <tr><td><code>toast</code></td><td>Show a short S-Client notification.</td></tr>
          <tr><td><code>setSetting</code></td><td>Change a setting declared by this mod.</td></tr>
          <tr><td><code>setFeature</code></td><td>Change a feature declared by this mod.</td></tr>
          <tr><td><code>setState</code></td><td>Store a JSON primitive in this mod's persistent state.</td></tr>
          <tr><td><code>incrementState</code></td><td>Add a number to a numeric state value (default amount is 1).</td></tr>
          <tr><td><code>if</code></td><td>Run a <code>then</code> or <code>else</code> statement array based on a comparison.</td></tr>
          <tr><td><code>call</code></td><td>Call a supported API from the S-Client allowlist.</td></tr>
        </tbody></table></div>
        <h3>Persistent counter</h3>
        <p>Increment a state value by one:</p>
        <div class="code-card"><div class="code-head"><span>INCREMENT STATE · JSON</span><button class="copy-btn" type="button">Copy code</button></div><pre><code>{ "op": "incrementState", "key": "clicks", "by": 1 }</code></pre></div>
        <h3>Conditional statement</h3>
        <p>This checks whether the state value <code>clicks</code> is greater than four:</p>
        <div class="code-card"><div class="code-head"><span>IF · JSON</span><button class="copy-btn" type="button">Copy code</button></div><pre><code>{
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
}</code></pre></div>
        <p>Conditions can read <code>setting</code>, <code>state</code>, <code>feature</code> or the current event <code>value</code>. Use exactly one comparator: <code>equals</code>, <code>notEquals</code>, <code>greaterThan</code>, <code>lessThan</code> or <code>truthy</code>.</p>`
    },
    {
      id: 'references', group: 'SCL LANGUAGE', title: 'Value references', search: '$value $feature $enabled $setting $state $mod tokens',
      body: `
        <p>SCL does not evaluate arbitrary expressions. In supported fields, it recognizes a small set of exact strings from the current event context.</p>
        <div class="table-wrap"><table><thead><tr><th>Reference</th><th>Meaning</th></tr></thead><tbody>
          <tr><td><code>$value</code></td><td>Current control or event value.</td></tr>
          <tr><td><code>$feature</code></td><td>Feature ID for <code>onFeatureChange</code>.</td></tr>
          <tr><td><code>$enabled</code></td><td>New enabled state for <code>onFeatureChange</code>.</td></tr>
          <tr><td><code>$setting:settingId</code></td><td>Value of a declared setting.</td></tr>
          <tr><td><code>$state:key</code></td><td>A value stored using <code>setState</code>.</td></tr>
          <tr><td><code>$mod.id</code></td><td>This mod's ID.</td></tr>
          <tr><td><code>$mod.name</code></td><td>This mod's display name.</td></tr>
        </tbody></table></div>
        <p>For example, a toast message of <code>$mod.name enabled!</code> substitutes the installed mod's display name. These are literal references, not JavaScript expressions.</p>`
    },
    {
      id: 'permissions', group: 'SCL LANGUAGE', title: 'Permissions and APIs', search: 'permissions ui.toast eyesight.presets aquavoid.features aquavoid.actions API',
      body: `
        <p>Permissions document and request specific capabilities. S-Client checks the API again when it is called. Declaring a permission does not create new game functionality.</p>
        <div class="table-wrap"><table><thead><tr><th>Permission / API</th><th>What it allows</th></tr></thead><tbody>
          <tr><td><code>ui.toast</code></td><td>Notification API. Calling <code>ui.toast</code> does not require a permission.</td></tr>
          <tr><td><code>eyesight.presets</code></td><td>Lets the Eyesight mod select or reset built-in/imported presets. Restricted to mod ID <code>eyesight</code>.</td></tr>
          <tr><td><code>aquavoid.features</code></td><td>Allows toggling existing built-in Aquavoid flags wired into S-Client.</td></tr>
          <tr><td><code>aquavoid.actions</code></td><td>Allows calls to the explicit list of legacy Aquavoid actions.</td></tr>
        </tbody></table></div>
        <h3>Call an API</h3>
        <div class="code-card"><div class="code-head"><span>API CALL · JSON</span><button class="copy-btn" type="button">Copy code</button></div><pre><code>{
  "op": "call",
  "api": "ui.toast",
  "value": "Hello from my mod!"
}</code></pre></div>
        <h3>Existing Aquavoid actions</h3>
        <p>The recognized legacy action IDs are <code>collectCrystal</code>, <code>refillTimer</code>, <code>addCoins</code>, <code>setCoins</code>, <code>addScore</code>, <code>unlockShips</code> and <code>stormStrike</code>. Game state and mode restrictions still apply.</p>
        <div class="info-card warning"><strong>You cannot create a new API in a mod</strong><p>If your idea needs a new game hook, request that specific host API from the S-Client maintainers. A manifest cannot add new capabilities just by naming them.</p></div>`
    },
    {
      id: 'eyesight', group: 'SPECIAL CASES', title: 'Eyesight and shaders', search: 'Eyesight shaderPicker shaders shader presets custom shadersclient GLSL',
      body: `
        <p>Eyesight is a special built-in S-Client mod. Its mod ID is <code>eyesight</code>, and it uses the <code>eyesight.presets</code> permission with the <code>eyesight.selectPreset</code> API. That API is restricted to Eyesight.</p>
        <p>The <code>shaderPicker</code> control displays the supported built-in and imported preset selector. It is reserved for the Eyesight mod and requires a supported change handler.</p>
        <div class="info-card warning"><strong>Shader packs are data, not executable shaders</strong><p>Custom <code>.shadersclient</code> files are declarative color-grade settings. SCL v1 cannot execute uploaded JavaScript or custom GLSL/WebGL source.</p></div>`
    },
    {
      id: 'test-share', group: 'PUBLISH', title: 'Import, test and share', search: 'import update testing publish share json validator mod manager',
      body: `
        <ol><li>Save your file with the <code>.sclient</code> extension.</li><li>Check that the content is valid JSON. Quotes, commas and brackets must be correct.</li><li>Open S-Client and go to <strong>Mod manager</strong>.</li><li>Import the <code>.sclient</code> file.</li><li>Enable the mod, open its page and test every button, setting and event.</li><li>When you edit the source, import the edited file again to update the installed version.</li><li>Share the source <code>.sclient</code> file so other people can inspect it.</li></ol>
        <h3>Validate from the full S-Client source repository</h3>
        <p>If you have the full S-Client source checkout, run the included validator from its repository root:</p>
        <div class="code-card"><div class="code-head"><span>TERMINAL</span><button class="copy-btn" type="button">Copy command</button></div><pre><code>node tools/validate-sclient.mjs path/to/my-first-mod.sclient</code></pre></div>
        <div class="info-card tip"><strong>Publish responsibly</strong><p>Include a clear name, version, author and description. Explain requested permissions. A file importing successfully does not mean it has been reviewed or certified by S-Client.</p></div>`
    },
    {
      id: 'limits', group: 'REFERENCE', title: 'Limits and safety', search: 'limits max settings controls statements size file upload safety sandbox',
      body: `
        <p>The current client enforces these limits when importing a mod:</p>
        <div class="table-wrap"><table><thead><tr><th>Limit</th><th>Maximum</th></tr></thead><tbody>
          <tr><td>Features</td><td>30</td></tr><tr><td>Settings</td><td>30</td></tr><tr><td>Controls</td><td>30</td></tr>
          <tr><td>Statements per handler</td><td>40</td></tr><tr><td>Total statements, including nested branches</td><td>100</td></tr>
          <tr><td>Nested <code>if</code> depth</td><td>4</td></tr><tr><td>Options per select</td><td>20</td></tr><tr><td>Imported file/archive member</td><td>1.5 MB</td></tr>
        </tbody></table></div>
        <p>SCL v1 does not provide filesystem access, network requests, DOM access, arbitrary JavaScript, dynamic modules, custom executable GLSL or access to other users' account data. Install only mods from creators you trust.</p>`
    }
  ];

  const starter = `{
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
}`;

  const nav = document.getElementById('side-nav');
  const toc = document.getElementById('toc');
  const content = document.getElementById('guide-content');
  const search = document.getElementById('guide-search');

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[ch]);
  }

  function makeHero() {
    return `<section class="hero">
      <div class="eyebrow">COMMUNITY MODDING · DEVELOPER GUIDE</div>
      <h1>Build your own<br><span style="color:#91bdff">S-Client mods.</span></h1>
      <p>Learn SCL, create custom settings and controls, and share your own <code>.sclient</code> mods with the community.</p>
      <div class="hero-meta"><span class="pill">SCL language v1</span><span class="pill">Mod format v2</span><span class="pill">JSON-based</span><span class="pill">Sandboxed runtime</span></div>
    </section>`;
  }

  function renderNav(items) {
    let html = '';
    let lastGroup = '';
    items.forEach((section) => {
      if (section.group !== lastGroup) {
        lastGroup = section.group;
        html += `<div class="nav-group">${escapeHtml(lastGroup)}</div>`;
      }
      html += `<a class="nav-link" href="#${section.id}" data-nav-id="${section.id}">${escapeHtml(section.title)}</a>`;
    });
    nav.innerHTML = html;
  }

  function renderSections(items) {
    if (!items.length) {
      content.innerHTML = makeHero() + '<div class="no-results">No sections match that search. Try another word.</div>';
      toc.innerHTML = '';
      return;
    }
    content.innerHTML = makeHero() + items.map((section) =>
      `<section class="doc-section" id="${section.id}" data-search="${escapeHtml((section.search + ' ' + section.title).toLowerCase())}"><h2>${escapeHtml(section.title)}</h2>${section.body}</section>`
    ).join('');
    toc.innerHTML = items.map((section) => `<a href="#${section.id}" data-toc-id="${section.id}">${escapeHtml(section.title)}</a>`).join('');
    setCopyButtons();
    setActiveSection();
  }

  function applySearch(query) {
    const normalized = query.trim().toLowerCase();
    const filtered = normalized
      ? sections.filter((section) => (section.title + ' ' + section.search + ' ' + section.body.replace(/<[^>]*>/g, ' ')).toLowerCase().includes(normalized))
      : sections;
    renderNav(filtered);
    renderSections(filtered);
  }

  function setCopyButtons() {
    const starterCode = document.getElementById('code-starter');
    if (starterCode) starterCode.textContent = starter;
    document.querySelectorAll('.code-card').forEach((card) => {
      const button = card.querySelector('.copy-btn');
      const code = card.querySelector('pre code');
      if (!button || !code) return;
      button.addEventListener('click', async () => {
        const original = button.textContent;
        try {
          await navigator.clipboard.writeText(code.textContent);
          button.textContent = 'Copied!';
        } catch (_) {
          const range = document.createRange();
          range.selectNodeContents(code);
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          button.textContent = 'Select & copy';
        }
        window.setTimeout(() => { button.textContent = original; }, 1500);
      });
    });
  }

  function setActiveSection() {
    const targets = [...document.querySelectorAll('.doc-section')];
    if (!('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const id = entry.target.id;
        document.querySelectorAll('[data-nav-id], [data-toc-id]').forEach((link) => {
          const active = link.dataset.navId === id || link.dataset.tocId === id;
          link.classList.toggle('active', active);
        });
      });
    }, { rootMargin: '-18% 0px -70% 0px', threshold: 0 });
    targets.forEach((target) => observer.observe(target));
  }

  search.addEventListener('input', () => applySearch(search.value));
  document.addEventListener('keydown', (event) => {
    if (event.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
      event.preventDefault();
      search.focus();
    }
    if (event.key === 'Escape' && document.activeElement === search) {
      search.value = '';
      applySearch('');
      search.blur();
    }
  });

  renderNav(sections);
  renderSections(sections);
})();
