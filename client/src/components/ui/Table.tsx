import type { PropsWithChildren } from "react";
export function Table({ children }: PropsWithChildren) {
  return (
    <div className="ui-table-scroll">
      <table className="ui-table">{children}</table>
    </div>
  );
}
