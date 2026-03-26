type SkeletonSize = "sm" | "md" | "lg";
interface SkeletonProps { size?: SkeletonSize; }
export function Skeleton({ size = "md" }: SkeletonProps) {
  return <div className={`ui-skeleton ${size}`} aria-hidden="true" />;
}
