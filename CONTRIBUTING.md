# Contributing

Thanks for wanting to help.

```bash
npm install
npm run typecheck
npm run build
```

- Keep the component dependency-light: `react` and `three` are peer dependencies; nothing else ships.
- The simulation (`src/sim.ts`) has no DOM access, so behaviour changes can be tested on their own.
- Check a visual change in all looks (`natural`, `ink`, `garden`) before opening a pull request, and say how it
  affects frame time.
- By contributing you agree your work is released under the MIT license.
