import { createFileRoute } from "@tanstack/react-router";
import { ChatWindow } from "@/components/chat-window";

export const Route = createFileRoute("/w/$workflowId")({
  component: WorkflowRoute,
});

function WorkflowRoute() {
  const { workflowId } = Route.useParams();
  // Key by workflowId so internal state resets per thread.
  return <ChatWindow key={workflowId} workflowId={workflowId} />;
}
