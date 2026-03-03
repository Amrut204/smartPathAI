import { Funnel, FunnelChart, LabelList, ResponsiveContainer, Tooltip } from "recharts";

export function PlacementFunnelChart({
  data,
  dataKey = "count",
  nameKey = "stage",
}: {
  data: Array<Record<string, number | string>>;
  dataKey?: string;
  nameKey?: string;
}) {
  return (
    <div className="chart-wrap">
      <ResponsiveContainer width="100%" height="100%">
        <FunnelChart>
          <Tooltip />
          <Funnel data={data} dataKey={dataKey} nameKey={nameKey} fill="#15616d" isAnimationActive={false}>
            <LabelList position="right" fill="#122229" stroke="none" dataKey={nameKey} />
          </Funnel>
        </FunnelChart>
      </ResponsiveContainer>
    </div>
  );
}
