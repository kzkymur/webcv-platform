Usage Patterns

General Tips

- Pick the smallest viable `pitch` that meets UX/precision needs (e.g., 16.67ms for 60Hz visuals).
- Keep callbacks lightweight; schedule heavier work off the critical tick.
- Prefer `waitCompleted()` when orchestration must complete before the next step.

UI/Animation Timeline (Queue)

```ts
const ui = new Sequencer(16.67, 1.0, false);
ui.push(new Fragment('FadeIn', 300, fadeIn));
ui.push(new Fragment('Slide', 400, slideIn));
ui.push(new Fragment('Hold', 800));
await ui.play();
```

Parallel Systems (Independent)

```ts
const systems = new IndependentSequencer(16.67, 1.0, true);
systems.push(new IndependentFragment('Physics', 16.67, 0, stepPhysics));
systems.push(new IndependentFragment('AI', 50, 0, stepAI));
systems.push(new IndependentFragment('Events', 2500, 1000, triggerEvent));
await systems.play();
```

Composable Modules (CustomFragment)

```ts
const explosion = new CustomFragment('Explosion', 0);
explosion.addFragment(new IndependentFragment('Flash', 120, 0, flash));
explosion.addFragment(new IndependentFragment('Shockwave', 800, 120, shockwave));

const scene = new IndependentSequencer(16.67, 1.0, false);
scene.push(explosion);
await scene.play();
```

Canvas HUD Timeline

```ts
const ctx = canvas.getContext('2d')!;
function renderLoop() {
  seq.renderToCanvas(ctx, { width: canvas.width, height: canvas.height });
  requestAnimationFrame(renderLoop);
}
renderLoop();
```

React Integration Sketch

```tsx
function Timeline() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = canvasRef.current!.getContext('2d')!;
    let raf = 0;
    const loop = () => {
      seq.renderToCanvas(ctx, { width: ctx.canvas.width, height: ctx.canvas.height });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={canvasRef} width={800} height={120} />;
}
```

Error-Resilient Start/Stop

```ts
if (!seq.isPlaying()) {
  await seq.play(0);
}
// later
if (seq.isPlaying()) {
  seq.stop();
}
```

