import { useState } from "react";

interface CounterProps {
  initial?: number;
  label: string;
}

export function Counter({ initial = 0, label }: CounterProps) {
  const [count, setCount] = useState(initial);
  return (
    <button type="button" onClick={() => setCount((c) => c + 1)}>
      {label}: {count}
    </button>
  );
}
