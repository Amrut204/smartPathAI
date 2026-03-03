import { Link } from "react-router-dom";
import { useMemo, useState } from "react";

import { Button, Card, Input, Select, Table } from "../../components/ui";
import { useTpoStudents } from "../../hooks/use-tpo-students";

export default function TpoStudentsPage() {
  const [batch, setBatch] = useState("");
  const [branch, setBranch] = useState("");
  const [cgpaMin, setCgpaMin] = useState("");
  const [cgpaMax, setCgpaMax] = useState("");
  const [backlogsMax, setBacklogsMax] = useState("");
  const [sortBy, setSortBy] = useState<"cgpa" | "created_at">("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [searchText, setSearchText] = useState("");
  const [quickFilter, setQuickFilter] = useState("all");

  const { data, error, isLoading } = useTpoStudents({
    batch: batch || undefined,
    branch: branch || undefined,
    cgpaMin: cgpaMin ? Number(cgpaMin) : undefined,
    cgpaMax: cgpaMax ? Number(cgpaMax) : undefined,
    backlogsMax: backlogsMax ? Number(backlogsMax) : undefined,
    sortBy,
    sortDir,
  });

  const filteredItems = useMemo(() => {
    const items = data?.items ?? [];
    const normalizedSearch = searchText.trim().toLowerCase();

    return items.filter((student) => {
      const matchesSearch = !normalizedSearch
        || student.fullName.toLowerCase().includes(normalizedSearch)
        || student.email.toLowerCase().includes(normalizedSearch)
        || student.rollNumber.toLowerCase().includes(normalizedSearch);

      if (!matchesSearch) return false;

      if (quickFilter === "low_readiness") return student.readinessScore < 50;
      if (quickFilter === "ready") return student.readinessScore >= 70;
      if (quickFilter === "no_backlogs") return student.backlogs === 0;
      if (quickFilter === "high_cgpa") return student.cgpa >= 8;
      return true;
    });
  }, [data?.items, searchText, quickFilter]);

  return (
    <section className="dashboard-grid">
      <Card>
        <h1>Student Database</h1>
        <div className="form-grid">
          <label>
            Search (Name / Email / Roll)
            <Input value={searchText} onChange={(event) => setSearchText(event.target.value)} />
          </label>
          <label>
            Quick Filter
            <Select value={quickFilter} onChange={(event) => setQuickFilter(event.target.value)}>
              <option value="all">All</option>
              <option value="low_readiness">Low Readiness (&lt; 50)</option>
              <option value="ready">Ready (&gt;= 70)</option>
              <option value="no_backlogs">No Backlogs</option>
              <option value="high_cgpa">High CGPA (&gt;= 8)</option>
            </Select>
          </label>
          <label>
            Batch
            <Input value={batch} onChange={(event) => setBatch(event.target.value)} />
          </label>
          <label>
            Branch
            <Input value={branch} onChange={(event) => setBranch(event.target.value)} />
          </label>
          <label>
            CGPA Min
            <Input
              type="number"
              min="0"
              max="10"
              step="0.1"
              value={cgpaMin}
              onChange={(event) => setCgpaMin(event.target.value)}
            />
          </label>
          <label>
            CGPA Max
            <Input
              type="number"
              min="0"
              max="10"
              step="0.1"
              value={cgpaMax}
              onChange={(event) => setCgpaMax(event.target.value)}
            />
          </label>
          <label>
            Backlogs Max
            <Input
              type="number"
              min="0"
              value={backlogsMax}
              onChange={(event) => setBacklogsMax(event.target.value)}
            />
          </label>
          <label>
            Sort By
            <Select value={sortBy} onChange={(event) => setSortBy(event.target.value as "cgpa" | "created_at")}>
              <option value="created_at">Created At</option>
              <option value="cgpa">CGPA</option>
            </Select>
          </label>
          <label>
            Sort Direction
            <Select value={sortDir} onChange={(event) => setSortDir(event.target.value as "asc" | "desc")}>
              <option value="desc">Desc</option>
              <option value="asc">Asc</option>
            </Select>
          </label>
        </div>
        <div className="hero-actions">
          <Link to="/tpo/students/upload">
            <Button>CSV Upload</Button>
          </Link>
        </div>
      </Card>

      {isLoading ? <Card>Loading students...</Card> : null}
      {error ? <Card>Unable to load students.</Card> : null}

      {data ? (
        <Card>
          <p className="muted-text">Showing {filteredItems.length} of {data.items.length} students.</p>
          <Table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Roll</th>
                <th>Branch</th>
                <th>Batch</th>
                <th>CGPA</th>
                <th>Backlogs</th>
                <th>Readiness</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((student) => (
                <tr key={student.id}>
                  <td>{student.fullName}</td>
                  <td>{student.email}</td>
                  <td>{student.rollNumber}</td>
                  <td>{student.branch}</td>
                  <td>{student.batch}</td>
                  <td>{student.cgpa.toFixed(2)}</td>
                  <td>{student.backlogs}</td>
                  <td>{student.readinessScore.toFixed(1)}%</td>
                  <td>
                    <Link to={`/tpo/students/${student.id}`}>Open</Link>
                  </td>
                </tr>
              ))}
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={9}>No students matched the current search/filter.</td>
                </tr>
              ) : null}
            </tbody>
          </Table>
        </Card>
      ) : null}
    </section>
  );
}
