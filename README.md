# koipond

A living koi pond for the web. Koi swim on their own through real-looking water: ripples spread and
linger, the surface bends the pond floor, light plays across it, rain falls and sakura drifts down.
Glide over it and you leave a wake; tap it and it splashes; double-tap and the koi come to feed.

![koipond](media/natural.jpg)

```bash
npm install koipond three
```

```tsx
import { KoiPond } from "koipond";

export default function Hero() {
  return <KoiPond style={{ height: "100vh" }} />;
}
```

That's all it needs. It fills its parent, so give the parent (or the component) a height.

Works with React 18 and 19, Next.js (App Router included, the component is marked `"use client"`), Vite and
anything else that renders React. `react` and `three` are peer dependencies; nothing else ships.

## What people can do with it

| Do this | And the pond… |
|---|---|
| Glide the pointer over the water | leaves a wake of small ripples that catches the light |
| Hold the pointer still near the koi | the bold ones come over to look |
| Move fast near a fish | the shy ones dart away |
| Tap | a little crown of droplets jumps up and falls back, and rings spread out |
| Double-tap or long-press | drops food; nearby koi race over and eat it |
| Scroll or swipe over it | stirs a current: koi, petals and pads stream with it, then it settles |

## Looks

| `look` | |
|---|---|
| `natural` | clear teal water over a stone floor (default) |
| `ink` | a woodblock print: indigo water in soft steps, ink outlines, flat colour, paper grain |
| `garden` | soft grey-sage water over river pebbles, a faded film grade |
| `violet`, `ember`, `mono` | the same pond through a 4-colour ordered dither |

The look can change at any time; the fish carry on swimming.

## Props

| Prop | Default | |
|---|---|---|
| `look` | `"natural"` | one of the looks above, or your own `Look` object |
| `fish` | `12` | number of koi |
| `fishSize` | `0.18` | koi length relative to the pond's short side |
| `pads` | `4` | floating lily pads (some flower) |
| `petals` | `10` | sakura petals drifting onto the water |
| `minnows` | `4` | small dark fish |
| `rain` | `0.4` | `0` to `1` |
| `water` | | override `{ shallow, deep, caustics, waves, clarity }` on any look |
| `border` | `true` | a small cluster of rocks in one corner |
| `cursor` | `true` | over the pond the pointer becomes a soft ring (not on touch screens) |
| `scrollCurrent` | `true` | scroll / swipe stirs the water |
| `interactive` | `true` | pointer, taps, feeding and scroll |
| `seed` | `7` | same seed, same pond |
| `scale` | `1` | simulation resolution relative to the element |
| `className`, `style` | | passed to the wrapper element |

### Imperative handle

```tsx
import { useRef } from "react";
import { KoiPond, type KoiPondHandle } from "koipond";

const pond = useRef<KoiPondHandle>(null);
// coordinates are 0..1 across the pond
pond.current?.feed(0.5, 0.5);
pond.current?.ripple(0.2, 0.7);
pond.current?.current(0.4, 0);          // push the water
pond.current?.formation(slots, flow);   // ask the koi to hold a shape (one slot per fish); null releases

<KoiPond ref={pond} />;
```

### A look of your own

```ts
import type { Look } from "koipond";

const dusk: Look = { mode: "color", palette: ["#000", "#000", "#000", "#000"], deep: "#0b2a3c", shallow: "#1e5a64", pixel: 1, caustics: 1.2 };
const mono: Look = { mode: "dither", palette: ["#0a0a0a", "#333333", "#999999", "#f5f5f5"], deep: "#050505", shallow: "#1b1b1b", pixel: 2 };
```

## How it works

**Koi.** Each koi has a temperament (bold to shy, lazy to restless) that shapes every choice. It picks an
activity (drift, cruise, dart, rest, investigate, feed, flee) by weighted chance from its mood and what is
around it. The activity sets a goal heading and speed; neighbours, the pond edge, rocks and the water current
bend that goal; the fish turns toward it with limited, speed-dependent agility, like a heavy body.

**Bodies.** A chain of joints pulled by the head, with a cap on how sharply each joint may bend, so a koi flows
through a turn but never kinks. A muscle wave runs nose to tail, stronger toward the tail and with effort.
The tail fin is its own spring-driven chain, so it trails and flicks. Each koi is a lit 3D mesh with its own
painted markings, scales and translucent fins.

**Water.** One three.js renderer does everything. A wave equation runs on the GPU in two half-float render
targets, so every tap, raindrop, gulp and wake spreads, reflects and fades. The surface slope refracts a
pond floor that is baked once, light gathers on the floor and on every ripple, and colour deepens with depth.
Lily pads and rocks are lit 3D meshes on top; petals, flowers and splashes are drawn in 2D above them.

**Calm by default.** Fixed 60 Hz simulation steps; the pond pauses when it is off screen and shows a still
frame to people who prefer reduced motion.

## Browser support

Any browser with WebGL2 (all current desktop and mobile browsers). Without WebGL2 the component falls back
to a simpler stylised water.

## Credits

Inspired by the wider world of procedural koi ponds, including
[nagomi](https://github.com/msk1039/nagomi). No code is shared; koipond is written from scratch.
Built on [three.js](https://threejs.org) (MIT).

## License

[MIT](LICENSE)
