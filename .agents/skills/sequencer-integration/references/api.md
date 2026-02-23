API Reference (precise, agent-friendly)

Exports

- Classes: `Sequencer`, `IndependentSequencer`, `Fragment`, `IndependentFragment`, `CustomFragment`.
- Type: `RenderOptions` for canvas visualization.

Fragment

- `constructor(name: string, durationMs: number, callback?: (t?: number) => void)`
- `getId(): string` – unique at construction.
- `getName(): string` / `setName(name: string): void`
- `getDuration(): number` / `setDuration(ms: number): void`
- `getCallback(): ((t?: number) => void) | undefined` / `setCallback(cb: (t?: number) => void): void`
- `copy(): Fragment` – new UUID, same properties.

IndependentFragment extends Fragment

- `constructor(name: string, durationMs: number, startMs: number, callback?: (t?: number) => void)`
- `getStartPoint(): number` / `setStartPoint(ms: number): void`
- `copy(): IndependentFragment`

CustomFragment extends IndependentFragment

- `constructor(name: string, startMs: number)` – duration is computed.
- `addFragment(f: IndependentFragment | CustomFragment): void` – no duplicate ids.
- `removeFragment(f: IndependentFragment | CustomFragment): void`
- `getFragments(): IndependentFragment[]` – copy of children.
- `getDuration(): number` – max(endTime(child)).
- `getCallback(): (t?: number) => void` – auto-calls active children; `setCallback(...)` throws.

Sequencer (Queue mode)

- `constructor(pitchMs: number, speed: number = 1.0, loop: boolean, useUniversalWorker: boolean = false)`
- Fragments
  - `push(f: Fragment): void` – throws if same `id` already present.
  - `insert(index: number, f: Fragment): void` – 0..length, else throws.
  - `remove(f: Fragment): void` – throws if not found.
  - `getFragments(): Fragment[]` – copy.
- Playback
  - `play(delayMs: number = 0): Promise<void>` – throws if playing or invalid delay.
  - `stop(delayMs: number = 0): void` – throws if not playing or invalid delay.
  - `replay(delayMs: number = 0): Promise<void>` – requires not playing.
  - `isPlaying(): boolean`
  - `waitCompleted(): Promise<void>` – requires playing.
- Timing
  - `getCurrentTime(): number`
  - `getPitch(): number` / `setPitch(ms: number > 0): void`
  - `setSpeed(multiplier > 0): void`
  - `isLooping(): boolean` / `setLoopFlag(loop: boolean): void`
- Visualization
  - `renderToCanvas(ctx: CanvasRenderingContext2D, options: RenderOptions): void`

IndependentSequencer (Parallel mode)

- Same constructor minus `useUniversalWorker`.
- `insert(...)` is unsupported and throws.
- `getTotalTime(): number` – max end time.
- `renderToCanvas(...)` specialized for parallel layout.

RenderOptions

```ts
type RenderOptions = {
  width?: number;
  height?: number;
  activeColor?: string;
  inactiveColor?: string;
  timeIndicatorColor?: string;
};
```

Exceptions (messages)

- Pitch/Speed: `Invalid pitch value: <v>. Must be positive number`, `Invalid speed value: <v>. Must be positive number`.
- Delay: `Invalid delay value: <v>. Must be non-negative number`.
- State: `Sequencer is already playing`, `Sequencer is not playing`, `Timer is already playing`, `Timer is not playing`.
- Fragments: `Fragment already exists in sequencer`, `Fragment not found in sequencer`.
- Insert bounds: `Invalid index: <i>. Must be between 0 and <len>`.
- Independent only: `Insert operation not supported for IndependentSequencer`.
- CustomFragment: `Name cannot be empty`, `Start point cannot be negative`, `CustomFragment callback cannot be set directly`, `currentTime have to be number`.
- Timer total time: `Total time must be larger than 0` (when setting a negative/NaN total).

