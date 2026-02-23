Testing Guidance

Goals

- Verify sequencing order/timing decisions and error handling without flakiness.

Suggestions

- Prefer deterministic checks over wall-clock timing; assert state transitions and method errors.
- For async completion, call `await seq.waitCompleted()` rather than sleep.

Examples

Queue order and completion

```ts
import { Sequencer, Fragment } from '@kzkymur/sequencer';

test('runs fragments in order and completes', async () => {
  const hits: string[] = [];
  const seq = new Sequencer(50, 1.0, false);
  seq.push(new Fragment('A', 100, () => hits.push('A')));
  seq.push(new Fragment('B', 100, () => hits.push('B')));
  await seq.play();
  await seq.waitCompleted();
  expect(hits.includes('A')).toBeTruthy();
  expect(hits.includes('B')).toBeTruthy();
});
```

Error surfaces

```ts
const seq = new Sequencer(50, 1.0, false);
await seq.play();
expect(() => seq.play()).toThrow('Sequencer is already playing');
seq.stop();
expect(() => seq.stop()).toThrow('Sequencer is not playing');
```

Independent constraints

```ts
import { IndependentSequencer, IndependentFragment } from '@kzkymur/sequencer';

const indep = new IndependentSequencer(50, 1.0, false);
indep.push(new IndependentFragment('X', 100, 0));
expect(() => indep.insert(0, new IndependentFragment('Y', 100, 10))).toThrow('Insert operation not supported');
```

