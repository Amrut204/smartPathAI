import { useMemo, useState, type FormEvent } from "react";

import { Button, Card, Input } from "../../components/ui";
import { updateStudentProfile, useStudentProfile } from "../../hooks/use-student-profile";

export default function ProfilePage() {
  const { data, error, isLoading, mutate } = useStudentProfile();
  const [skillsText, setSkillsText] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  const skillList = useMemo(
    () =>
      skillsText
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    [skillsText],
  );

  if (isLoading) {
    return <Card>Loading profile...</Card>;
  }

  if (error || !data) {
    return <Card>Unable to load profile.</Card>;
  }

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    try {
      await updateStudentProfile({
        skills: skillList.length > 0 ? skillList : data.skills,
      });
      await mutate();
      setStatus("Profile updated");
    } catch (updateError) {
      setStatus(updateError instanceof Error ? updateError.message : "Update failed");
    }
  };

  return (
    <Card>
      <h1>Student Profile</h1>
      <p>Branch: {data.branch}</p>
      <p>Batch: {data.batch}</p>
      <p>Roll Number: {data.roll_number}</p>
      <p>CGPA: {data.cgpa ?? "N/A"}</p>
      <p>Backlogs: {data.backlogs}</p>
      <form className="form-grid" onSubmit={onSubmit}>
        <label>
          Skills (comma separated)
          <Input
            value={skillsText}
            onChange={(event) => setSkillsText(event.target.value)}
            placeholder={(data.skills ?? []).join(", ")}
          />
        </label>
        {status ? <p>{status}</p> : null}
        <Button type="submit">Save</Button>
      </form>
    </Card>
  );
}
