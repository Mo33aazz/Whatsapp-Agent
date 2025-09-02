CSS split overview

- base.css: Reset, design tokens, html/body, background effects, main wrapper.
- components.css: Cards, buttons, forms (inputs, validation, combobox, form status), toasts.
- main.css: Nav/header, hero, container/grid, QR section, config section placement, status and conversations.
- features.css: Coming Soon features section and its responsive tweaks.
- creator.css: Creator and Contact sections and their responsive tweaks.
- responsive.css: Global responsive rules impacting layout and shared components.

Load order in index.html preserves overrides: base → components → main → features → creator → responsive.

