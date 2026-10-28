import { Link } from "react-router-dom";
import { EmptyState } from "../components/ui";

export default function NotFound() {
  return (
    <div className="page">
      <EmptyState title="This trail doesn't go anywhere" action={<Link to="/" className="btn-primary">Back to the start</Link>}>
        We couldn't find that page or mission.
      </EmptyState>
    </div>
  );
}
