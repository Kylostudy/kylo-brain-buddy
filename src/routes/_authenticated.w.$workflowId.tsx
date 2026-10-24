import { createFileRoute } from "@tanstack/react-router";
import { ChatWindow } from "@/components/chat-window";

export const Route = createFileRoute("/_authenticated/w/$workflowId")({
  head: () => ({ meta: [
    { title: "Munkafolyamat — Kylo Brain" },
    { name: "description", content: "Kylo Brain munkafolyamat tanítása, futtatása és eredményei." },
    { property: "og:title", content: "Munkafolyamat — Kylo Brain" },
    { property: "og:description", content: "Munkafolyamat tanítása, futtatása és eredményei." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: WorkflowRoute,
});

function WorkflowRoute() {
  const { workflowId } = Route.useParams();
  // Key by workflowId so internal state resets per thread.
  return <ChatWindow key={workflowId} workflowId={workflowId} />;
}
