interface ProgressProps { value: number; max?: number; }
export function Progress({ value, max = 100 }: ProgressProps) {
  const clamped = Math.max(0, Math.min(max, value));
  return <progress className="ui-progress" value={clamped} max={max} aria-valuemin={0} aria-valuemax={max} />;
}
