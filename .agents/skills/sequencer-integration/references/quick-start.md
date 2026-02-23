Quick Start – @kzkymur/sequencer

Install

```bash
npm install @kzkymur/sequencer
```

Import

```ts
import { Sequencer, IndependentSequencer, Fragment, IndependentFragment, CustomFragment } from '@kzkymur/sequencer';
```

Queue Mode (serial)

```ts
const seq = new Sequencer(100, 1.0, false /* loop */, true /* useUniversalWorker? */);

seq.push(new Fragment('Step A', 500, () => doA()));
seq.push(new Fragment('Step B', 250, () => doB()));

await seq.play();
// optionally await natural completion
await seq.waitCompleted();
```

Independent Mode (parallel / absolute start times)

```ts
const indep = new IndependentSequencer(16.67, 1.0, false);

indep.push(new IndependentFragment('Physics', 16.67, 0, tickPhysics));
indep.push(new IndependentFragment('Spawn', 3000, 1200, spawnEnemy));

await indep.play();
```

CustomFragment (bundle reusable subsequences)

```ts
const intro = new CustomFragment('Intro', 0);
intro.addFragment(new IndependentFragment('Fade In', 1000, 0, fadeIn));
intro.addFragment(new IndependentFragment('Slide', 500, 1000, slide));

const timeline = new IndependentSequencer(16.67, 1.0, false);
timeline.push(intro);
await timeline.play();
```

Canvas Visualization (optional)

```ts
const ctx = (document.getElementById('timeline') as HTMLCanvasElement).getContext('2d')!;
seq.renderToCanvas(ctx, {
  width: 800,
  height: 120,
  activeColor: '#ff4757',
  inactiveColor: '#2ed573',
  timeIndicatorColor: '#ffa502',
});
```

