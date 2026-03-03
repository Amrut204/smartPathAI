import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

const COLORS = ["#3d8a98", "#ff7d00", "#42a870", "#d9534f"];

export function OutcomeDoughnutChart({
  data,
  dataKey = "count",
  nameKey = "name",
}: {
  data: Array<Record<string, number | string>>;
  dataKey?: string;
  nameKey?: string;
}) {
  return (
    <div className="chart-wrap">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip />
          <Pie data={data} dataKey={dataKey} nameKey={nameKey} innerRadius={60} outerRadius={90} paddingAngle={2}>
            {data.map((_, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
