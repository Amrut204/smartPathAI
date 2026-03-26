function cellTone(level: number): string {
  if (level >= 80) return "tone-5";
  if (level >= 60) return "tone-4";
  if (level >= 40) return "tone-3";
  if (level >= 20) return "tone-2";
  return "tone-1";
}

export function TopicHeatmapGrid({
  students,
  topics,
  cells,
}: {
  students: Array<{ studentId: string; studentName: string }>;
  topics: Array<{ topicId: string; topicName: string }>;
  cells: Array<{ studentId: string; topicId: string; topicName?: string; masteryLevel: number }>;
}) {
  const map = new Map(cells.map((cell) => [`${cell.studentId}_${cell.topicId}`, cell.masteryLevel]));

  return (
    <div className="heatmap-wrap">
      <div className="heatmap-grid">
        <div className="heatmap-header">Student</div>
        {topics.map((topic) => (
          <div key={topic.topicId} className="heatmap-header">
            {topic.topicName}
          </div>
        ))}

        {students.map((student) => (
          <div key={student.studentId} className="heatmap-row">
            <div className="heatmap-student">{student.studentName}</div>
            {topics.map((topic) => {
              const level = map.get(`${student.studentId}_${topic.topicId}`) ?? 0;
              return (
                <div key={`${student.studentId}_${topic.topicId}`} className={`heatmap-cell ${cellTone(level)}`}>
                  {Math.round(level)}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
